begin;

-- SOS network availability is intentionally distinct from the short-lived
-- visual Radar presence. Participation starts disabled and requires a new,
-- explicit consent because occasional background location is a distinct use.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'radar_preferences'
      and column_name = 'sos_network_enabled'
  ) then
    alter table public.radar_preferences
      add column sos_network_enabled boolean not null default false;

  end if;
end;
$$;

create table if not exists public.sos_network_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision not null,
  source text not null,
  observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  constraint sos_network_presence_latitude_range
    check (latitude between -90 and 90),
  constraint sos_network_presence_longitude_range
    check (longitude between -180 and 180),
  constraint sos_network_presence_accuracy_range
    check (accuracy between 0 and 1000),
  constraint sos_network_presence_source_check
    check (source in ('foreground', 'background'))
);

create index if not exists sos_network_presence_recent_active_idx
  on public.sos_network_presence (updated_at desc)
  where is_active = true;

create index if not exists sos_network_presence_candidate_idx
  on public.sos_network_presence (latitude, longitude, observed_at desc)
  where is_active = true;

alter table public.sos_network_presence enable row level security;
revoke all on table public.sos_network_presence from anon, authenticated;

create or replace function public.get_my_sos_network_preference()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select preferences.sos_network_enabled
    from public.radar_preferences preferences
    where preferences.user_id = auth.uid()
  ), false)
  where auth.uid() is not null;
$$;

create or replace function public.update_my_sos_network_preference(next_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  insert into public.radar_preferences (user_id, sos_network_enabled)
  values (current_user_id, coalesce(next_enabled, false))
  on conflict (user_id) do update
  set sos_network_enabled = excluded.sos_network_enabled,
      updated_at = now();

  if not coalesce(next_enabled, false) then
    update public.sos_network_presence presence
    set is_active = false,
        updated_at = now()
    where presence.user_id = current_user_id;
  end if;

  return coalesce(next_enabled, false);
end;
$$;

create or replace function public.update_my_sos_network_presence(
  position_latitude double precision,
  position_longitude double precision,
  position_accuracy double precision,
  position_observed_at timestamptz,
  update_source text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  effective_observed_at timestamptz;
  saved_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  perform 1
    from public.radar_preferences preferences
    where preferences.user_id = current_user_id
      and preferences.sos_network_enabled = true
    for update;

  if not found then
    raise exception 'SOS network participation is disabled.' using errcode = '42501';
  end if;

  if position_latitude is null or position_latitude not between -90 and 90
     or position_longitude is null or position_longitude not between -180 and 180
     or position_accuracy is null or position_accuracy < 0 or position_accuracy > 1000
     or update_source not in ('foreground', 'background') then
    raise exception 'Invalid SOS network position.' using errcode = '22023';
  end if;

  effective_observed_at := least(coalesce(position_observed_at, now()), now());
  if effective_observed_at < now() - interval '30 minutes' then
    raise exception 'SOS network position is too old.' using errcode = '22023';
  end if;

  insert into public.sos_network_presence (
    user_id,
    latitude,
    longitude,
    accuracy,
    source,
    observed_at,
    updated_at,
    is_active
  ) values (
    current_user_id,
    position_latitude,
    position_longitude,
    position_accuracy,
    update_source,
    effective_observed_at,
    now(),
    true
  )
  on conflict (user_id) do update
  set latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy = excluded.accuracy,
      source = excluded.source,
      observed_at = excluded.observed_at,
      updated_at = now(),
      is_active = true
  returning updated_at into saved_at;

  return saved_at;
end;
$$;

create or replace function public.deactivate_my_sos_network_presence()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  update public.sos_network_presence presence
  set is_active = false,
      updated_at = now()
  where presence.user_id = auth.uid();
end;
$$;

revoke all on function public.get_my_sos_network_preference() from public, anon;
revoke all on function public.update_my_sos_network_preference(boolean) from public, anon;
revoke all on function public.update_my_sos_network_presence(
  double precision,
  double precision,
  double precision,
  timestamptz,
  text
) from public, anon;
revoke all on function public.deactivate_my_sos_network_presence() from public, anon;

grant execute on function public.get_my_sos_network_preference() to authenticated;
grant execute on function public.update_my_sos_network_preference(boolean) to authenticated;
grant execute on function public.update_my_sos_network_presence(
  double precision,
  double precision,
  double precision,
  timestamptz,
  text
) to authenticated;
grant execute on function public.deactivate_my_sos_network_presence() to authenticated;

-- Trusted contacts remain direct recipients. Nearby recipients are selected
-- independently from the dedicated SOS network presence. The first radius
-- containing five eligible candidates wins; otherwise the search expands to
-- 5 km. Ranking balances distance, age and accuracy and remains deterministic.
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
  selected_radius_meters integer := 5000;
  desired_nearby_recipients constant integer := 5;
  maximum_nearby_recipients constant integer := 25;
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

  with eligible as (
      select
        presence.user_id,
        2 * 6371000 * asin(sqrt(least(1::double precision, greatest(
          0::double precision,
          power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
          + cos(radians(target_sos.latitude)) * cos(radians(presence.latitude))
          * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
        )))) as distance_meters
      from public.sos_network_presence presence
      join public.radar_preferences preferences
        on preferences.user_id = presence.user_id
       and preferences.sos_network_enabled = true
      where presence.user_id <> target_sos.user_id
        and presence.is_active = true
        and presence.observed_at >= now() - interval '30 minutes'
        and presence.updated_at >= now() - interval '30 minutes'
        and presence.accuracy <= 100
    )
    select case
      when count(*) filter (where distance_meters <= 1000) >= desired_nearby_recipients then 1000
      when count(*) filter (where distance_meters <= 3000) >= desired_nearby_recipients then 3000
      else 5000
    end
    into selected_radius_meters
    from eligible;

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
      ranked.user_id,
      ranked.distance_meters,
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
        )))))::integer as distance_meters,
        (2 * 6371000 * asin(sqrt(least(1::double precision, greatest(
          0::double precision,
          power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
          + cos(radians(target_sos.latitude)) * cos(radians(presence.latitude))
          * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
        )))))
          + case
              when presence.observed_at >= now() - interval '5 minutes' then 0
              when presence.observed_at >= now() - interval '15 minutes' then 1000
              else 3000
            end
          + extract(epoch from (now() - presence.observed_at)) * 2
          + presence.accuracy * 5 as reliability_score
      from public.sos_network_presence presence
      join public.radar_preferences preferences
        on preferences.user_id = presence.user_id
       and preferences.sos_network_enabled = true
      where presence.user_id <> target_sos.user_id
        and presence.is_active = true
        and presence.observed_at >= now() - interval '30 minutes'
        and presence.updated_at >= now() - interval '30 minutes'
        and presence.accuracy <= 100
    ) ranked
    where ranked.distance_meters <= selected_radius_meters
    order by ranked.reliability_score asc, ranked.distance_meters asc, ranked.user_id asc
    limit maximum_nearby_recipients
  on conflict (sos_id, nearby_user_id) do update
  set distance_meters = excluded.distance_meters,
      status = 'detected'::public.nearby_alert_status,
      created_at = excluded.created_at;

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

revoke all on function public.prepare_sos_delivery(uuid) from public, anon, authenticated;
grant execute on function public.prepare_sos_delivery(uuid) to service_role;

commit;
