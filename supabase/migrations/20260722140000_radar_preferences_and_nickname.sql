begin;

create table public.radar_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  radar_enabled boolean not null default false,
  visible_to_nearby boolean not null default true,
  show_nickname boolean not null default false,
  public_nickname text,
  updated_at timestamptz not null default now(),
  constraint radar_preferences_nickname_format check (
    public_nickname is null
    or public_nickname ~ '^[A-Za-z0-9_-]{3,20}$'
  ),
  constraint radar_preferences_nickname_reserved check (
    public_nickname is null
    or lower(public_nickname) not in (
      'admin',
      'administrator',
      'emergenza',
      'guardian',
      'moderator',
      'safemelink',
      'sicurezza',
      'sos',
      'support',
      'system'
    )
  )
);

create unique index radar_preferences_nickname_unique_idx
  on public.radar_preferences (lower(public_nickname))
  where public_nickname is not null;

alter table public.radar_preferences enable row level security;

-- Preferences and nicknames are exposed only through scoped RPC functions.
revoke all on table public.radar_preferences from anon, authenticated;

create or replace function public.get_my_radar_preferences()
returns table (
  radar_enabled boolean,
  visible_to_nearby boolean,
  show_nickname boolean,
  public_nickname text,
  preferences_updated_at timestamptz
)
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

  insert into public.radar_preferences (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  return query
  select
    preferences.radar_enabled,
    preferences.visible_to_nearby,
    preferences.show_nickname,
    preferences.public_nickname,
    preferences.updated_at
  from public.radar_preferences preferences
  where preferences.user_id = current_user_id;
end;
$$;

create or replace function public.update_my_radar_preferences(
  next_radar_enabled boolean,
  next_visible_to_nearby boolean,
  next_show_nickname boolean,
  next_public_nickname text default null
)
returns table (
  radar_enabled boolean,
  visible_to_nearby boolean,
  show_nickname boolean,
  public_nickname text,
  preferences_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_nickname text := nullif(btrim(next_public_nickname), '');
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if next_radar_enabled is null
     or next_visible_to_nearby is null
     or next_show_nickname is null then
    raise exception 'Radar preferences are required.' using errcode = '22023';
  end if;

  if normalized_nickname is not null
     and normalized_nickname !~ '^[A-Za-z0-9_-]{3,20}$' then
    raise exception 'Invalid public nickname.' using errcode = '22023';
  end if;

  if normalized_nickname is not null
     and lower(normalized_nickname) in (
       'admin',
       'administrator',
       'emergenza',
       'guardian',
       'moderator',
       'safemelink',
       'sicurezza',
       'sos',
       'support',
       'system'
     ) then
    raise exception 'Reserved public nickname.' using errcode = '22023';
  end if;

  begin
    insert into public.radar_preferences (
      user_id,
      radar_enabled,
      visible_to_nearby,
      show_nickname,
      public_nickname,
      updated_at
    )
    values (
      current_user_id,
      next_radar_enabled,
      next_visible_to_nearby,
      next_show_nickname,
      normalized_nickname,
      now()
    )
    on conflict (user_id) do update
    set radar_enabled = excluded.radar_enabled,
        visible_to_nearby = excluded.visible_to_nearby,
        show_nickname = excluded.show_nickname,
        public_nickname = excluded.public_nickname,
        updated_at = now();
  exception
    when unique_violation then
      raise exception 'Public nickname already in use.' using errcode = '23505';
  end;

  if not next_radar_enabled or not next_visible_to_nearby then
    delete from public.radar_presence
    where user_id = current_user_id;
  end if;

  return query
  select
    preferences.radar_enabled,
    preferences.visible_to_nearby,
    preferences.show_nickname,
    preferences.public_nickname,
    preferences.updated_at
  from public.radar_preferences preferences
  where preferences.user_id = current_user_id;
end;
$$;

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

  if not exists (
    select 1
    from public.radar_preferences preferences
    where preferences.user_id = current_user_id
      and preferences.radar_enabled = true
      and preferences.visible_to_nearby = true
  ) then
    raise exception 'Radar participation is not enabled.' using errcode = '42501';
  end if;

  if position_latitude is null or position_latitude not between -90 and 90 then
    raise exception 'Invalid latitude.' using errcode = '22023';
  end if;

  if position_longitude is null or position_longitude not between -180 and 180 then
    raise exception 'Invalid longitude.' using errcode = '22023';
  end if;

  if position_accuracy is null
     or position_accuracy not between 0 and public.radar_max_accuracy_meters() then
    raise exception 'Insufficient location accuracy.' using errcode = '22023';
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

drop function public.find_nearby_users(double precision, integer);

create function public.find_nearby_users(
  search_radius_meters double precision default 1000,
  result_limit integer default 25
)
returns table (
  anonymous_id text,
  public_nickname text,
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

  if not exists (
    select 1
    from public.radar_preferences preferences
    where preferences.user_id = current_user_id
      and preferences.radar_enabled = true
      and preferences.visible_to_nearby = true
  ) then
    return;
  end if;

  return query
  with my_presence as (
    select presence.latitude, presence.longitude
    from public.radar_presence presence
    where presence.user_id = current_user_id
      and presence.is_active = true
      and presence.updated_at >= now() - public.radar_presence_ttl()
      and presence.accuracy is not null
      and presence.accuracy <= public.radar_max_accuracy_meters()
  ),
  candidate_distances as (
    select
      candidate.user_id,
      candidate_preferences.show_nickname,
      candidate_preferences.public_nickname,
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
    join public.radar_preferences candidate_preferences
      on candidate_preferences.user_id = candidate.user_id
     and candidate_preferences.radar_enabled = true
     and candidate_preferences.visible_to_nearby = true
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
    ),
    case
      when candidate.show_nickname then candidate.public_nickname
      else null
    end,
    greatest(50, round(candidate.exact_distance_meters / 50) * 50)::integer,
    case
      when exists (
        select 1
        from public.guardian guardian_link
        where guardian_link.user_id = current_user_id
          and guardian_link.guardian_id = candidate.user_id
          and guardian_link.status = 'accepted'
      ) then 'guardian'
      else 'user'
    end,
    true
  from candidate_distances candidate
  where candidate.exact_distance_meters <= search_radius_meters
  order by candidate.exact_distance_meters asc
  limit result_limit;
end;
$$;

revoke all on function public.get_my_radar_preferences() from public;
revoke all on function public.update_my_radar_preferences(boolean, boolean, boolean, text)
  from public;
revoke all on function public.find_nearby_users(double precision, integer) from public;

grant execute on function public.get_my_radar_preferences() to authenticated;
grant execute on function public.update_my_radar_preferences(boolean, boolean, boolean, text)
  to authenticated;
grant execute on function public.find_nearby_users(double precision, integer) to authenticated;

commit;
