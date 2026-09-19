begin;

-- Coordinate-less emergencies are valid. Keep ranges and all existing RLS.
alter table public.sos alter column latitude drop not null;
alter table public.sos alter column longitude drop not null;
do $migration$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.sos'::regclass and conname = 'sos_location_pair') then
    alter table public.sos add constraint sos_location_pair check ((latitude is null) = (longitude is null));
  end if;
end;
$migration$;

-- Durable tombstones deliberately have no cascading foreign keys: deleting an SOS
-- or an account must never release an operation identifier for reuse.
create table if not exists public.safety_sos_operations (
  operation_id uuid primary key,
  user_id uuid not null,
  sos_id uuid not null unique,
  created_at timestamptz not null default now(),
  constraint safety_sos_operations_same_id check (sos_id = operation_id)
);
alter table public.safety_sos_operations enable row level security;
revoke all on table public.safety_sos_operations from public, anon, authenticated;

-- Legacy DELETE remains available. A deleted safety SOS leaves a tombstone and
-- produces a deterministic error on retry, never a replacement emergency.
create or replace function public.create_my_safety_sos(
  operation_id uuid,
  expected_user_id uuid,
  position_latitude double precision,
  position_longitude double precision,
  position_accuracy double precision,
  event_time timestamptz,
  position_observed_at timestamptz
)
returns setof public.sos
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  current_user_id uuid := auth.uid();
  result public.sos%rowtype;
  existing_operation public.safety_sos_operations%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if expected_user_id is null or current_user_id <> expected_user_id then
    raise exception 'Safety SOS account changed.' using errcode = '42501';
  end if;
  if operation_id is null then
    raise exception 'Invalid safety SOS operation.' using errcode = '22023';
  end if;

  -- Transaction-scoped serialization, including first creation. Hash collisions
  -- only serialize unrelated operations; PK/UNIQUE remain authoritative.
  perform pg_advisory_xact_lock(hashtextextended(operation_id::text, 0));
  select mapping.* into existing_operation
  from public.safety_sos_operations mapping
  where mapping.operation_id = create_my_safety_sos.operation_id;
  if found then
    if existing_operation.user_id <> current_user_id then
      raise exception 'Safety SOS unavailable.' using errcode = '42501';
    end if;
    select target.* into result from public.sos target
    where target.id = existing_operation.sos_id and target.user_id = current_user_id;
    if not found then
      raise exception 'Safety SOS was removed.' using errcode = 'P0002';
    end if;
    return next result;
    return;
  end if;

  if (position_latitude is null) <> (position_longitude is null)
    or position_latitude not between -90 and 90
    or position_longitude not between -180 and 180
    or position_accuracy < 0
    or position_accuracy = 'NaN'::double precision
    or position_accuracy = 'Infinity'::double precision
    or (event_time is not null and not isfinite(event_time))
    or (position_observed_at is not null and not isfinite(position_observed_at)) then
    raise exception 'Invalid safety SOS.' using errcode = '22023';
  end if;
  -- An unrelated existing SOS cannot be adopted as a safety operation.
  if exists (select 1 from public.sos target where target.id = operation_id) then
    raise exception 'Safety SOS unavailable.' using errcode = '42501';
  end if;
  insert into public.sos(id, user_id, latitude, longitude, accuracy, device_time, location_updated_at)
  values (operation_id, current_user_id, position_latitude, position_longitude, position_accuracy, event_time,
    case when position_latitude is null then null else coalesce(position_observed_at, event_time, now()) end)
  returning * into result;
  insert into public.safety_sos_operations(operation_id, user_id, sos_id)
  values (operation_id, current_user_id, result.id);
  select target.* into result from public.sos target
  where target.id = operation_id and target.user_id = current_user_id;
  if not found then
    raise exception 'Safety SOS unavailable.' using errcode = '42501';
  end if;
  return next result;
end;
$function$;
revoke all on function public.create_my_safety_sos(uuid, uuid, double precision, double precision, double precision, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_my_safety_sos(uuid, uuid, double precision, double precision, double precision, timestamptz, timestamptz) to authenticated;

-- Null location MUST skip nearby distance arithmetic (LEAST/GREATEST null handling).
-- Trusted recipients remain independent of location.
create or replace function public.prepare_sos_delivery(target_sos_id uuid)
returns table (
  recipient_user_id uuid,
  is_trusted boolean,
  is_nearby boolean,
  distance_meters integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  target_sos public.sos%rowtype;
begin
  if target_sos_id is null then
    raise exception 'SOS identifier is required.' using errcode = '22023';
  end if;

  select target.*
  into target_sos
  from public.sos target
  where target.id = target_sos_id
    and target.status = 'open';

  if not found then
    raise exception 'Open SOS not found.' using errcode = 'P0002';
  end if;

  insert into public.nearby_alerts (
    sos_id,
    source_user_id,
    nearby_user_id,
    distance_meters,
    status,
    created_at
  )
  select
    target_sos.id,
    target_sos.user_id,
    eligible.user_id,
    eligible.distance_meters,
    'detected'::public.nearby_alert_status,
    now()
  from (
    select
      presence.user_id,
      round(2 * 6371000 * asin(sqrt(least(1::double precision, greatest(
        0::double precision,
        power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
        + cos(radians(target_sos.latitude)) * cos(radians(presence.latitude))
        * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
      )))))::integer as distance_meters
    from public.sos_network_presence presence
    join public.radar_preferences preferences
      on preferences.user_id = presence.user_id
     and preferences.sos_network_enabled = true
    where target_sos.latitude is not null
      and target_sos.longitude is not null
      and presence.user_id <> target_sos.user_id
      and presence.is_active = true
      and presence.observed_at >= now() - interval '30 minutes'
      and presence.updated_at >= now() - interval '30 minutes'
      and presence.accuracy <= 100
  ) eligible
  where eligible.distance_meters <= 5000
  order by
    case
      when eligible.distance_meters <= 1000 then 1
      when eligible.distance_meters <= 3000 then 2
      else 3
    end,
    eligible.distance_meters,
    eligible.user_id
  on conflict (sos_id, nearby_user_id) do nothing;

  return query
  with trusted_recipients as (
    select contact.linked_profile_id as user_id,
      true as trusted,
      false as nearby,
      null::integer as distance
    from public.trusted_contacts contact
    where contact.user_id = target_sos.user_id
      and contact.linked_profile_id is not null
      and contact.linked_profile_id <> target_sos.user_id
  ),
  nearby_recipients as (
    select alert.nearby_user_id,
      false,
      true,
      greatest(0, round(alert.distance_meters))::integer
    from public.nearby_alerts alert
    where alert.sos_id = target_sos.id
      and alert.source_user_id = target_sos.user_id
      and alert.nearby_user_id <> target_sos.user_id
      and alert.status in ('detected', 'acknowledged')
  ),
  combined_recipients as (
    select * from trusted_recipients
    union all
    select * from nearby_recipients
  )
  select combined.user_id,
    bool_or(combined.trusted),
    bool_or(combined.nearby),
    min(combined.distance)
  from combined_recipients combined
  group by combined.user_id;
end;
$$;

revoke all on function public.prepare_sos_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_sos_delivery(uuid) to service_role;


commit;
