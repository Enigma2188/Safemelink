begin;

alter table public.sos
  add column if not exists location_updated_at timestamptz;

update public.sos
set location_updated_at = coalesce(device_time, created_at)
where location_updated_at is null;

alter table public.sos
  alter column location_updated_at set default now();

create index if not exists nearby_alerts_sos_recipient_idx
  on public.nearby_alerts (sos_id, nearby_user_id);

-- Resolve every eligible responder within 5 km in one authoritative transaction.
-- The three concentric bands are represented by distance: <=1 km, 1-3 km and
-- 3-5 km. The unique SOS/recipient constraint prevents re-notification if the
-- function is retried, while trusted recipients remain independent and cumulative.
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
    where presence.user_id <> target_sos.user_id
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

create or replace function public.update_my_active_sos_location(
  target_sos_id uuid,
  position_latitude double precision,
  position_longitude double precision,
  position_accuracy double precision,
  position_observed_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if target_sos_id is null
     or position_latitude is null or position_latitude not between -90 and 90
     or position_longitude is null or position_longitude not between -180 and 180
     or position_accuracy is null or position_accuracy < 0 or position_accuracy > 100
     or position_observed_at is null
     or position_observed_at < now() - interval '10 minutes'
     or position_observed_at > now() + interval '2 minutes' then
    raise exception 'Invalid SOS location.' using errcode = '22023';
  end if;

  update public.sos target
  set latitude = position_latitude,
      longitude = position_longitude,
      accuracy = position_accuracy,
      location_updated_at = position_observed_at,
      updated_at = now()
  where target.id = target_sos_id
    and target.user_id = current_user_id
    and target.status in ('open', 'accepted');

  return found;
end;
$$;

revoke all on function public.update_my_active_sos_location(
  uuid, double precision, double precision, double precision, timestamptz
) from public, anon;
grant execute on function public.update_my_active_sos_location(
  uuid, double precision, double precision, double precision, timestamptz
) to authenticated;

-- The return shape changes to expose freshness, so recreate this RPC explicitly.
drop function if exists public.get_received_sos(uuid);
create function public.get_received_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sender_display_name text,
  sos_status public.sos_status,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  event_time timestamptz,
  location_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recipient_access as (
    select
      exists (
        select 1
        from public.trusted_contacts trusted_contact
        where trusted_contact.user_id = target.user_id
          and trusted_contact.linked_profile_id = auth.uid()
      ) as trusted,
      exists (
        select 1
        from public.nearby_alerts nearby_alert
        where nearby_alert.sos_id = target.id
          and nearby_alert.source_user_id = target.user_id
          and nearby_alert.nearby_user_id = auth.uid()
          and nearby_alert.status in ('detected', 'acknowledged')
      ) as nearby
    from public.sos target
    where target.id = target_sos_id
  )
  select
    target.id,
    case
      when access.trusted then
        coalesce(nullif(trim(sender_profile.nickname), ''), 'Contatto SafeMeLink')
      when access.nearby
        and sender_preferences.show_nickname = true
        and nullif(trim(sender_preferences.public_nickname), '') is not null then
        trim(sender_preferences.public_nickname)
      else 'Utente SafeMeLink'
    end,
    target.status,
    target.latitude,
    target.longitude,
    target.accuracy,
    coalesce(target.device_time, target.created_at),
    coalesce(target.location_updated_at, target.device_time, target.created_at)
  from public.sos target
  join public.profiles sender_profile on sender_profile.id = target.user_id
  left join public.radar_preferences sender_preferences
    on sender_preferences.user_id = target.user_id
  cross join recipient_access access
  where target.id = target_sos_id
    and target.status in ('open', 'accepted')
    and auth.uid() is not null
    and (access.trusted or access.nearby);
$$;

revoke all on function public.get_received_sos(uuid) from public, anon;
grant execute on function public.get_received_sos(uuid) to authenticated;

commit;
