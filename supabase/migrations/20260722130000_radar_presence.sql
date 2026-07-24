begin;

create table public.radar_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint radar_presence_latitude_range check (latitude between -90 and 90),
  constraint radar_presence_longitude_range check (longitude between -180 and 180),
  constraint radar_presence_accuracy_range check (
    accuracy is null or accuracy between 0 and 10000
  )
);

comment on table public.radar_presence is
  'Private, short-lived positions used only by authenticated Radar RPC functions.';

create index radar_presence_recent_active_idx
  on public.radar_presence (updated_at desc)
  where is_active = true;

alter table public.radar_presence enable row level security;

-- No direct policies are intentionally created. Authenticated clients use only
-- the narrowly scoped SECURITY DEFINER functions below and cannot read positions.
revoke all on table public.radar_presence from anon, authenticated;

create or replace function public.radar_presence_ttl()
returns interval
language sql
immutable
set search_path = public, pg_temp
as $$
  select interval '5 minutes';
$$;

create or replace function public.radar_max_accuracy_meters()
returns double precision
language sql
immutable
set search_path = public, pg_temp
as $$
  select 100::double precision;
$$;

revoke all on function public.radar_presence_ttl() from public;
revoke all on function public.radar_max_accuracy_meters() from public;

create or replace function public.update_my_radar_presence(
  position_latitude double precision,
  position_longitude double precision,
  position_accuracy double precision default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  saved_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if position_latitude is null or position_latitude not between -90 and 90 then
    raise exception 'Invalid latitude.' using errcode = '22023';
  end if;

  if position_longitude is null or position_longitude not between -180 and 180 then
    raise exception 'Invalid longitude.' using errcode = '22023';
  end if;

  if position_accuracy is not null and position_accuracy not between 0 and 10000 then
    raise exception 'Invalid accuracy.' using errcode = '22023';
  end if;

  insert into public.radar_presence (
    user_id,
    latitude,
    longitude,
    accuracy,
    is_active,
    updated_at
  )
  values (
    current_user_id,
    position_latitude,
    position_longitude,
    position_accuracy,
    true,
    now()
  )
  on conflict (user_id) do update
  set latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy = excluded.accuracy,
      is_active = true,
      updated_at = now()
  returning updated_at into saved_at;

  return saved_at;
end;
$$;

create or replace function public.deactivate_my_radar_presence()
returns void
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

  delete from public.radar_presence
  where user_id = current_user_id;
end;
$$;

create or replace function public.find_nearby_users(
  search_radius_meters double precision default 1000,
  result_limit integer default 25
)
returns table (
  anonymous_id text,
  distance_meters integer,
  category text,
  recently_active boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if search_radius_meters is null
     or search_radius_meters <= 0
     or search_radius_meters > 5000 then
    raise exception 'Radius must be between 0 and 5000 meters.' using errcode = '22023';
  end if;

  if result_limit is null or result_limit < 1 or result_limit > 50 then
    raise exception 'Result limit must be between 1 and 50.' using errcode = '22023';
  end if;

  return query
  with my_presence as (
    select rp.latitude, rp.longitude
    from public.radar_presence rp
    where rp.user_id = current_user_id
      and rp.is_active = true
      and rp.updated_at >= now() - public.radar_presence_ttl()
      and rp.accuracy is not null
      and rp.accuracy <= public.radar_max_accuracy_meters()
  ),
  candidate_distances as (
    select
      candidate.user_id,
      2 * 6371000 * asin(
        sqrt(
          least(
            1::double precision,
            greatest(
              0::double precision,
              power(sin(radians(candidate.latitude - mine.latitude) / 2), 2)
              + cos(radians(mine.latitude))
                * cos(radians(candidate.latitude))
                * power(sin(radians(candidate.longitude - mine.longitude) / 2), 2)
            )
          )
        )
      ) as exact_distance_meters
    from public.radar_presence candidate
    cross join my_presence mine
    where candidate.user_id <> current_user_id
      and candidate.is_active = true
      and candidate.updated_at >= now() - public.radar_presence_ttl()
      and candidate.accuracy is not null
      and candidate.accuracy <= public.radar_max_accuracy_meters()
  )
  select
    substring(
      md5(
        candidate.user_id::text
        || ':' || current_user_id::text
        || ':' || (now() at time zone 'utc')::date::text
      ),
      1,
      20
    ) as anonymous_id,
    greatest(50, round(candidate.exact_distance_meters / 50) * 50)::integer
      as distance_meters,
    case
      when exists (
        select 1
        from public.guardian guardian_link
        where guardian_link.user_id = current_user_id
          and guardian_link.guardian_id = candidate.user_id
          and guardian_link.status = 'accepted'
      ) then 'guardian'
      else 'user'
    end as category,
    true as recently_active
  from candidate_distances candidate
  where candidate.exact_distance_meters <= search_radius_meters
  order by candidate.exact_distance_meters asc
  limit result_limit;
end;
$$;

revoke all on function public.update_my_radar_presence(double precision, double precision, double precision)
  from public;
revoke all on function public.deactivate_my_radar_presence() from public;
revoke all on function public.find_nearby_users(double precision, integer) from public;

grant execute on function public.update_my_radar_presence(double precision, double precision, double precision)
  to authenticated;
grant execute on function public.deactivate_my_radar_presence() to authenticated;
grant execute on function public.find_nearby_users(double precision, integer) to authenticated;

commit;
