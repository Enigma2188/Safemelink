begin;

-- PRE-APPLY CHECK (read-only): PostGIS must either be absent or installed in
-- the `extensions` schema. This migration deliberately does not relocate an
-- existing extension: select e.extname, n.nspname from pg_extension e
-- join pg_namespace n on n.oid = e.extnamespace where e.extname = 'postgis';
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create type public.network_report_category as enum (
  'SUSPICIOUS_ACTIVITY',
  'DISTURBANCE_OR_DANGER',
  'UNSAFE_AREA',
  'URBAN_HAZARD',
  'OTHER_SAFETY'
);
create type public.network_report_status as enum ('ACTIVE', 'RESOLVED', 'EXPIRED', 'HIDDEN');
create type public.network_moderation_state as enum ('VISIBLE', 'LIMITED', 'HIDDEN', 'REJECTED');
create type public.network_confirmation_kind as enum ('CONFIRMED', 'NO_LONGER_PRESENT');
create type public.network_content_report_reason as enum (
  'FALSE_INFORMATION', 'PERSONAL_ACCUSATION', 'PERSONAL_DATA',
  'OFFENSIVE_CONTENT', 'SPAM', 'IRRELEVANT', 'OTHER'
);
create type public.network_content_report_status as enum ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');
create type public.network_restriction_type as enum (
  'READ_ONLY', 'PUBLISH_BLOCKED', 'INTERACTIONS_BLOCKED', 'FULL_NETWORK_BLOCKED'
);
create type public.network_rate_limit_action as enum ('CONFIRMATION', 'FEED_READ');

create table public.network_config (
  singleton boolean primary key default true check (singleton),
  current_terms_version text not null default '1',
  default_feed_radius_meters integer not null default 1000 check (default_feed_radius_meters between 100 and 5000),
  max_feed_radius_meters integer not null default 5000 check (max_feed_radius_meters between default_feed_radius_meters and 5000),
  page_size_default integer not null default 20 check (page_size_default between 1 and 50),
  page_size_max integer not null default 50 check (page_size_max between page_size_default and 100),
  public_cell_size_meters integer not null default 250 check (public_cell_size_meters between 100 and 1000),
  max_location_accuracy_meters integer not null default 200 check (max_location_accuracy_meters between 20 and 1000),
  create_limit_hour integer not null default 3 check (create_limit_hour between 1 and 20),
  create_limit_day integer not null default 10 check (create_limit_day between create_limit_hour and 100),
  confirmation_limit_minute integer not null default 20 check (confirmation_limit_minute between 1 and 100),
  feed_read_limit_minute integer not null default 30 check (feed_read_limit_minute between 1 and 120),
  content_report_limit_hour integer not null default 10 check (content_report_limit_hour between 1 and 100),
  max_updates_per_report integer not null default 5 check (max_updates_per_report between 0 and 20),
  duplicate_window interval not null default interval '10 minutes' check (duplicate_window between interval '1 minute' and interval '1 hour'),
  duplicate_radius_meters integer not null default 250 check (duplicate_radius_meters between 25 and 2000),
  resolved_visibility interval not null default interval '60 minutes' check (resolved_visibility between interval '1 minute' and interval '24 hours'),
  visibility_grant_ttl interval not null default interval '15 minutes' check (visibility_grant_ttl between interval '1 minute' and interval '1 hour'),
  updated_at timestamptz not null default now()
);
insert into public.network_config (singleton) values (true);

create table public.network_category_config (
  category public.network_report_category primary key,
  ttl interval not null check (ttl between interval '30 minutes' and interval '7 days')
);
insert into public.network_category_config (category, ttl) values
  ('SUSPICIOUS_ACTIVITY', interval '3 hours'),
  ('DISTURBANCE_OR_DANGER', interval '3 hours'),
  ('UNSAFE_AREA', interval '12 hours'),
  ('URBAN_HAZARD', interval '24 hours'),
  ('OTHER_SAFETY', interval '6 hours');

create table public.account_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone_e164 text,
  phone_verified_at timestamptz,
  verification_source text,
  updated_at timestamptz not null default now(),
  constraint account_verifications_phone_state check (
    (phone_verified_at is null and phone_e164 is null and verification_source is null)
    or (phone_verified_at is not null and phone_e164 ~ '^\+[1-9][0-9]{7,14}$' and char_length(trim(verification_source)) between 2 and 40)
  ),
  constraint account_verifications_timestamp_sanity check (phone_verified_at is null or phone_verified_at <= updated_at + interval '5 minutes')
);

create table public.network_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  network_terms_version text,
  accepted_at timestamptz,
  notifications_enabled boolean not null default false,
  notification_radius_meters integer not null default 1000 check (notification_radius_meters between 100 and 5000),
  feed_radius_meters integer not null default 1000 check (feed_radius_meters between 100 and 5000),
  updated_at timestamptz not null default now(),
  constraint network_preferences_terms_state check (
    (network_terms_version is null and accepted_at is null)
    or (network_terms_version is not null and accepted_at is not null)
  ),
  constraint network_preferences_timestamp_sanity check (accepted_at is null or accepted_at <= updated_at + interval '5 minutes')
);

create table public.network_reports (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  author_nickname_snapshot text not null check (char_length(author_nickname_snapshot) between 2 and 40),
  category public.network_report_category not null,
  description text not null check (char_length(description) between 10 and 500),
  status public.network_report_status not null default 'ACTIVE',
  moderation_state public.network_moderation_state not null default 'VISIBLE',
  location extensions.geography(Point, 4326) not null,
  location_accuracy_meters double precision,
  public_cell_id text not null,
  public_location extensions.geography(Point, 4326) not null,
  public_area_label text not null default 'Area approssimativa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  hidden_at timestamptz,
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  no_longer_present_count integer not null default 0 check (no_longer_present_count >= 0),
  constraint network_reports_accuracy check (location_accuracy_meters is null or location_accuracy_meters between 0 and 1000),
  constraint network_reports_expiry check (expires_at > created_at),
  constraint network_reports_status_timestamps check (
    (status = 'RESOLVED') = (resolved_at is not null)
    and ((status = 'HIDDEN' or moderation_state = 'HIDDEN') = (hidden_at is not null))
  ),
  constraint network_reports_timestamp_order check (
    (resolved_at is null or resolved_at >= created_at)
    and (hidden_at is null or hidden_at >= created_at)
  )
);

create table public.network_report_confirmations (
  report_id uuid not null references public.network_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.network_confirmation_kind not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table public.network_report_updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.network_reports(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 2 and 300),
  moderation_state public.network_moderation_state not null default 'VISIBLE',
  created_at timestamptz not null default now()
);

create table public.network_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  report_id uuid references public.network_reports(id) on delete cascade,
  update_id uuid references public.network_report_updates(id) on delete cascade,
  reason public.network_content_report_reason not null,
  details text check (details is null or char_length(details) between 2 and 300),
  status public.network_content_report_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  constraint network_content_reports_one_target check ((report_id is null) <> (update_id is null))
);

create table public.network_user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  restriction_type public.network_restriction_type not null,
  reason_code text not null check (char_length(trim(reason_code)) between 2 and 80),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint network_restriction_window check (expires_at is null or expires_at > starts_at)
);

create table public.network_rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action public.network_rate_limit_action not null,
  created_at timestamptz not null default now()
);

create table public.network_report_visibility_grants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  report_id uuid not null references public.network_reports(id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, report_id),
  constraint network_visibility_grant_window check (expires_at > granted_at)
);

create index network_reports_location_idx on public.network_reports using gist (location);
create index network_reports_public_location_idx on public.network_reports using gist (public_location);
create index network_reports_feed_idx on public.network_reports (created_at desc, id desc) where status = 'ACTIVE' and moderation_state = 'VISIBLE';
create index network_reports_author_idx on public.network_reports (author_user_id, created_at desc);
create index network_reports_expiry_idx on public.network_reports (expires_at) where status = 'ACTIVE';
create index network_confirmations_user_rate_idx on public.network_report_confirmations (user_id, updated_at desc);
create index network_updates_report_idx on public.network_report_updates (report_id, created_at);
create index network_updates_author_rate_idx on public.network_report_updates (author_user_id, created_at desc);
create index network_content_reports_reporter_idx on public.network_content_reports (reporter_user_id, created_at desc);
create unique index network_content_reports_unique_report_target_idx on public.network_content_reports (reporter_user_id, report_id, reason) where report_id is not null;
create unique index network_content_reports_unique_update_target_idx on public.network_content_reports (reporter_user_id, update_id, reason) where update_id is not null;
create index network_restrictions_active_idx on public.network_user_restrictions (user_id, restriction_type, expires_at);
create index network_rate_limit_events_user_action_idx on public.network_rate_limit_events (user_id, action, created_at desc);
create index network_visibility_grants_expiry_idx on public.network_report_visibility_grants (expires_at);

alter table public.network_config enable row level security;
alter table public.network_category_config enable row level security;
alter table public.account_verifications enable row level security;
alter table public.network_preferences enable row level security;
alter table public.network_reports enable row level security;
alter table public.network_report_confirmations enable row level security;
alter table public.network_report_updates enable row level security;
alter table public.network_content_reports enable row level security;
alter table public.network_user_restrictions enable row level security;
alter table public.network_rate_limit_events enable row level security;
alter table public.network_report_visibility_grants enable row level security;

revoke all on table public.network_config, public.network_category_config,
  public.account_verifications, public.network_preferences, public.network_reports,
  public.network_report_confirmations, public.network_report_updates,
  public.network_content_reports, public.network_user_restrictions,
  public.network_rate_limit_events, public.network_report_visibility_grants
from public, anon, authenticated;

create or replace function public.network_user_is_restricted(target_user_id uuid, requested_action text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.network_user_restrictions r
    where r.user_id = target_user_id
      and r.starts_at <= now() and (r.expires_at is null or r.expires_at > now())
      and (r.restriction_type = 'FULL_NETWORK_BLOCKED'
        or (requested_action in ('publish', 'interact') and r.restriction_type = 'READ_ONLY')
        or (requested_action = 'publish' and r.restriction_type = 'PUBLISH_BLOCKED')
        or (requested_action = 'interact' and r.restriction_type = 'INTERACTIONS_BLOCKED'))
  );
$$;

create or replace function public.network_user_is_eligible(target_user_id uuid)
returns boolean language sql stable security definer set search_path = public, auth, pg_temp as $$
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    join public.account_verifications v on v.user_id = u.id and v.phone_verified_at is not null
    join public.network_preferences np on np.user_id = u.id
    join public.network_config c on c.singleton
    where u.id = target_user_id
      and u.email_confirmed_at is not null
      and nullif(btrim(p.nickname), '') is not null
      and np.accepted_at is not null
      and np.network_terms_version = c.current_terms_version
  );
$$;

create or replace function public.network_public_cell_id(point extensions.geography, cell_size_meters integer)
returns text language sql immutable set search_path = public, extensions, pg_temp as $$
  select concat(
    floor(extensions.st_x(extensions.st_transform(point::extensions.geometry, 3857)) / cell_size_meters)::bigint,
    ':',
    floor(extensions.st_y(extensions.st_transform(point::extensions.geometry, 3857)) / cell_size_meters)::bigint
  );
$$;

create or replace function public.network_public_cell_center(cell_id text, cell_size_meters integer)
returns extensions.geography language sql immutable set search_path = public, extensions, pg_temp as $$
  select extensions.st_transform(
    extensions.st_setsrid(
      extensions.st_makepoint(
        split_part(cell_id, ':', 1)::bigint * cell_size_meters + cell_size_meters / 2.0,
        split_part(cell_id, ':', 2)::bigint * cell_size_meters + cell_size_meters / 2.0
      ),
      3857
    ),
    4326
  )::extensions.geography;
$$;

create or replace function public.accept_network_terms(target_terms_version text, target_feed_radius_meters integer default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); cfg public.network_config%rowtype; selected_radius integer;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select * into strict cfg from public.network_config where singleton;
  if target_terms_version is distinct from cfg.current_terms_version then raise exception 'Current Network rules must be accepted.' using errcode = '22023'; end if;
  selected_radius := least(coalesce(target_feed_radius_meters, cfg.default_feed_radius_meters), cfg.max_feed_radius_meters);
  if selected_radius < 100 then raise exception 'Invalid feed radius.' using errcode = '22023'; end if;
  insert into public.network_preferences (user_id, network_terms_version, accepted_at, feed_radius_meters)
  values (actor, cfg.current_terms_version, now(), selected_radius)
  on conflict (user_id) do update set network_terms_version = excluded.network_terms_version,
    accepted_at = excluded.accepted_at, feed_radius_meters = excluded.feed_radius_meters, updated_at = now();
end;
$$;

create or replace function public.create_network_report(
  target_category public.network_report_category,
  target_description text,
  target_latitude double precision,
  target_longitude double precision,
  target_accuracy double precision default null
) returns table (
  report_id uuid, category public.network_report_category, description text,
  author_nickname text, public_area text, created_at timestamptz,
  expires_at timestamptz, confirmation_count integer, no_longer_present_count integer
) language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  actor uuid := auth.uid(); cfg public.network_config%rowtype; category_ttl interval;
  clean_description text := btrim(target_description); nickname text; report_location extensions.geography(Point,4326); report_public_cell_id text; report_public_location extensions.geography(Point,4326);
  inserted public.network_reports%rowtype;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('network-create:' || actor::text, 0));
  if not public.network_user_is_eligible(actor) then raise exception 'Network interaction eligibility required.' using errcode = '42501'; end if;
  if public.network_user_is_restricted(actor, 'publish') then raise exception 'Network publishing unavailable.' using errcode = '42501'; end if;
  if target_category is null or target_description is null or target_latitude is null or target_longitude is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  if target_latitude not between -90 and 90 or target_longitude not between -180 and 180 then raise exception 'NETWORK_INVALID_LOCATION' using errcode = '22023'; end if;
  select * into strict cfg from public.network_config where singleton;
  if target_accuracy is not null and (target_accuracy < 0 or target_accuracy > cfg.max_location_accuracy_meters) then raise exception 'Location accuracy is insufficient.' using errcode = '22023'; end if;
  if char_length(clean_description) not between 10 and 500 then raise exception 'Description length is invalid.' using errcode = '22023'; end if;
  if (select count(*) from public.network_reports where author_user_id = actor and created_at >= now() - interval '1 hour') >= cfg.create_limit_hour
    or (select count(*) from public.network_reports where author_user_id = actor and created_at >= now() - interval '1 day') >= cfg.create_limit_day
  then raise exception 'Network publishing rate limit reached.' using errcode = 'P0001'; end if;
  report_location := extensions.st_setsrid(extensions.st_makepoint(target_longitude, target_latitude), 4326)::extensions.geography;
  report_public_cell_id := public.network_public_cell_id(report_location, cfg.public_cell_size_meters);
  report_public_location := public.network_public_cell_center(report_public_cell_id, cfg.public_cell_size_meters);
  if exists (select 1 from public.network_reports r where r.author_user_id = actor and r.category = target_category
    and r.created_at >= now() - cfg.duplicate_window and r.status = 'ACTIVE'
    and extensions.st_dwithin(r.location, report_location, cfg.duplicate_radius_meters))
  then raise exception 'A similar recent report already exists.' using errcode = '23505'; end if;
  select p.nickname into nickname from public.profiles p where p.id = actor;
  select cc.ttl into strict category_ttl from public.network_category_config cc where cc.category = target_category;
  insert into public.network_reports (
    author_user_id, author_nickname_snapshot, category, description, location,
    location_accuracy_meters, public_cell_id, public_location, expires_at
  ) values (
    actor, btrim(nickname), target_category, clean_description, report_location,
    target_accuracy, report_public_cell_id, report_public_location, now() + category_ttl
  ) returning * into inserted;
  return query select inserted.id, inserted.category, inserted.description, inserted.author_nickname_snapshot,
    inserted.public_area_label, inserted.created_at, inserted.expires_at,
    inserted.confirmation_count, inserted.no_longer_present_count;
end;
$$;

create or replace function public.list_nearby_network_reports(
  viewer_latitude double precision,
  viewer_longitude double precision,
  radius_meters integer default null,
  cursor_status_bucket integer default null,
  cursor_created_at timestamptz default null,
  cursor_report_id uuid default null,
  requested_page_size integer default null
) returns table (
  report_id uuid, report_status public.network_report_status, category public.network_report_category, description text,
  author_nickname text, public_area text, distance_bucket_meters integer,
  report_created_at timestamptz, report_expires_at timestamptz,
  confirmation_count integer, no_longer_present_count integer,
  my_confirmation public.network_confirmation_kind
) language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare actor uuid := auth.uid(); cfg public.network_config%rowtype; viewer_point extensions.geography(Point,4326); public_center extensions.geography(Point,4326); selected_radius integer; selected_size integer;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if public.network_user_is_restricted(actor, 'read') then raise exception 'Network access unavailable.' using errcode = '42501'; end if;
  if viewer_latitude is null or viewer_longitude is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  if viewer_latitude not between -90 and 90 or viewer_longitude not between -180 and 180 then raise exception 'NETWORK_INVALID_LOCATION' using errcode = '22023'; end if;
  if num_nulls(cursor_status_bucket, cursor_created_at, cursor_report_id) not in (0, 3) or (cursor_status_bucket is not null and cursor_status_bucket not in (0, 1)) then raise exception 'NETWORK_INVALID_CURSOR' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('network-feed-read:' || actor::text, 0));
  select * into strict cfg from public.network_config where singleton;
  if (select count(*) from public.network_rate_limit_events where user_id = actor and action = 'FEED_READ' and created_at >= now() - interval '1 minute') >= cfg.feed_read_limit_minute
  then raise exception 'NETWORK_FEED_RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into public.network_rate_limit_events (user_id, action) values (actor, 'FEED_READ');
  selected_radius := least(greatest(coalesce(radius_meters, cfg.default_feed_radius_meters), 100), cfg.max_feed_radius_meters);
  selected_size := least(greatest(coalesce(requested_page_size, cfg.page_size_default), 1), cfg.page_size_max);
  viewer_point := extensions.st_setsrid(extensions.st_makepoint(viewer_longitude, viewer_latitude), 4326)::extensions.geography;
  public_center := public.network_public_cell_center(public.network_public_cell_id(viewer_point, cfg.public_cell_size_meters), cfg.public_cell_size_meters);
  return query
  with candidates as materialized (
    select r.id, r.status, r.category, r.description, r.author_nickname_snapshot, r.public_area_label,
      (round(extensions.st_distance(r.public_location, public_center)
        / cfg.public_cell_size_meters) * cfg.public_cell_size_meters)::integer as distance_bucket_meters,
      r.created_at, r.expires_at, r.confirmation_count, r.no_longer_present_count, c.kind
    from public.network_reports r
    left join public.network_report_confirmations c on c.report_id = r.id and c.user_id = actor
    where r.moderation_state = 'VISIBLE'
      and ((r.status = 'ACTIVE' and r.expires_at > now())
        or (r.status = 'RESOLVED' and r.resolved_at > now() - cfg.resolved_visibility))
      and extensions.st_dwithin(r.public_location, public_center, selected_radius)
      and (cursor_status_bucket is null
        or case when r.status = 'ACTIVE' then 0 else 1 end > cursor_status_bucket
        or (case when r.status = 'ACTIVE' then 0 else 1 end = cursor_status_bucket
          and r.created_at < cursor_created_at)
        or (case when r.status = 'ACTIVE' then 0 else 1 end = cursor_status_bucket
          and r.created_at = cursor_created_at and r.id < cursor_report_id))
    order by case when r.status = 'ACTIVE' then 0 else 1 end,
      r.created_at desc, r.id desc
    limit selected_size
  ), granted as (
    insert into public.network_report_visibility_grants (user_id, report_id, granted_at, expires_at)
    select actor, candidates.id, now(), now() + cfg.visibility_grant_ttl from candidates
    on conflict (user_id, report_id) do update set granted_at = excluded.granted_at, expires_at = excluded.expires_at
    returning report_id
  )
  select candidates.* from candidates, (select count(*) from granted) grant_execution_guard;
end;
$$;

create or replace function public.get_network_report(
  target_report_id uuid
)
returns table (
  report_id uuid, category public.network_report_category, description text,
  author_nickname text, public_area text, report_status public.network_report_status,
  report_created_at timestamptz, report_expires_at timestamptz,
  confirmation_count integer, no_longer_present_count integer,
  my_confirmation public.network_confirmation_kind, updates jsonb
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); cfg public.network_config%rowtype;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if public.network_user_is_restricted(actor, 'read') then raise exception 'Network access unavailable.' using errcode = '42501'; end if;
  if target_report_id is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  select * into strict cfg from public.network_config where singleton;
  return query select r.id, r.category, r.description, r.author_nickname_snapshot, r.public_area_label,
    r.status, r.created_at, r.expires_at, r.confirmation_count, r.no_longer_present_count, c.kind,
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'createdAt', u.created_at) order by u.created_at)
      from public.network_report_updates u where u.report_id = r.id and u.moderation_state = 'VISIBLE'), '[]'::jsonb)
  from public.network_reports r
  left join public.network_report_confirmations c on c.report_id = r.id and c.user_id = actor
  where r.id = target_report_id and r.moderation_state = 'VISIBLE'
    and exists (select 1 from public.network_report_visibility_grants g
      where g.user_id = actor and g.report_id = r.id and g.expires_at > now())
    and ((r.status = 'ACTIVE' and r.expires_at > now())
      or (r.status = 'RESOLVED' and r.resolved_at > now() - cfg.resolved_visibility));
end;
$$;

create or replace function public.respond_to_network_report(target_report_id uuid, target_kind public.network_confirmation_kind)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); cfg public.network_config%rowtype; target public.network_reports%rowtype;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if target_report_id is null or target_kind is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('network-response:' || actor::text, 0));
  if not public.network_user_is_eligible(actor) or public.network_user_is_restricted(actor, 'interact') then raise exception 'Network interaction unavailable.' using errcode = '42501'; end if;
  select * into strict cfg from public.network_config where singleton;
  select * into target from public.network_reports where id = target_report_id for update;
  if not found or target.status <> 'ACTIVE' or target.expires_at <= now() or target.moderation_state <> 'VISIBLE' then raise exception 'Report is not active.' using errcode = 'P0002'; end if;
  if target.author_user_id = actor then raise exception 'Authors cannot confirm their own report.' using errcode = '42501'; end if;
  if exists (select 1 from public.network_report_confirmations where report_id = target_report_id and user_id = actor and kind = target_kind) then return; end if;
  if (select count(*) from public.network_rate_limit_events where user_id = actor and action = 'CONFIRMATION' and created_at >= now() - interval '1 minute') >= cfg.confirmation_limit_minute
  then raise exception 'NETWORK_CONFIRMATION_RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into public.network_rate_limit_events (user_id, action) values (actor, 'CONFIRMATION');
  insert into public.network_report_confirmations (report_id, user_id, kind) values (target_report_id, actor, target_kind)
  on conflict (report_id, user_id) do update set kind = excluded.kind, updated_at = now();
  update public.network_reports r set
    confirmation_count = (select count(*) from public.network_report_confirmations c where c.report_id = r.id and c.kind = 'CONFIRMED'),
    no_longer_present_count = (select count(*) from public.network_report_confirmations c where c.report_id = r.id and c.kind = 'NO_LONGER_PRESENT'),
    last_activity_at = now(), updated_at = now()
  where r.id = target_report_id;
end;
$$;

create or replace function public.add_network_report_update(target_report_id uuid, target_body text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); cfg public.network_config%rowtype; target public.network_reports%rowtype; clean_body text := btrim(target_body); update_id uuid;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if target_report_id is null or target_body is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('network-update:' || target_report_id::text, 0));
  if not public.network_user_is_eligible(actor) or public.network_user_is_restricted(actor, 'publish') then raise exception 'Network publishing unavailable.' using errcode = '42501'; end if;
  if char_length(clean_body) not between 2 and 300 then raise exception 'Update length is invalid.' using errcode = '22023'; end if;
  select * into target from public.network_reports where id = target_report_id for update;
  if not found or target.author_user_id <> actor then raise exception 'Report ownership required.' using errcode = '42501'; end if;
  if target.status <> 'ACTIVE' or target.expires_at <= now() or target.moderation_state <> 'VISIBLE' then raise exception 'Report is not active.' using errcode = 'P0002'; end if;
  select * into strict cfg from public.network_config where singleton;
  if (select count(*) from public.network_report_updates where report_id = target_report_id) >= cfg.max_updates_per_report then raise exception 'Report update limit reached.' using errcode = 'P0001'; end if;
  insert into public.network_report_updates (report_id, author_user_id, body) values (target_report_id, actor, clean_body) returning id into update_id;
  update public.network_reports set last_activity_at = now(), updated_at = now() where id = target_report_id;
  return update_id;
end;
$$;

create or replace function public.resolve_my_network_report(target_report_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); current_status public.network_report_status;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if target_report_id is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  select status into current_status from public.network_reports where id = target_report_id and author_user_id = actor for update;
  if not found then raise exception 'NETWORK_OWNED_REPORT_NOT_FOUND' using errcode = 'P0002'; end if;
  if current_status = 'RESOLVED' then return; end if;
  if current_status <> 'ACTIVE' then raise exception 'NETWORK_REPORT_NOT_RESOLVABLE' using errcode = 'P0002'; end if;
  update public.network_reports set status = 'RESOLVED', resolved_at = now(), updated_at = now(), last_activity_at = now()
  where id = target_report_id and author_user_id = actor and status = 'ACTIVE';
end;
$$;

create or replace function public.report_network_content(
  target_report_id uuid default null,
  target_update_id uuid default null,
  target_reason public.network_content_report_reason default null,
  target_details text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); cfg public.network_config%rowtype; inserted_id uuid; clean_details text := nullif(btrim(target_details), ''); target public.network_reports%rowtype;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('network-content-report:' || actor::text, 0));
  if not public.network_user_is_eligible(actor) or public.network_user_is_restricted(actor, 'content_report') then raise exception 'Network interaction unavailable.' using errcode = '42501'; end if;
  if (target_report_id is null) = (target_update_id is null) or target_reason is null then raise exception 'NETWORK_INVALID_REQUIRED_INPUT' using errcode = '22023'; end if;
  if clean_details is not null and char_length(clean_details) not between 2 and 300 then raise exception 'Details length is invalid.' using errcode = '22023'; end if;
  select * into strict cfg from public.network_config where singleton;
  if target_report_id is not null then
    select * into target from public.network_reports where id = target_report_id;
  else
    select r.* into target from public.network_report_updates u join public.network_reports r on r.id = u.report_id
      where u.id = target_update_id and u.moderation_state = 'VISIBLE';
  end if;
  if not found or target.moderation_state <> 'VISIBLE'
    or not exists (select 1 from public.network_report_visibility_grants g
      where g.user_id = actor and g.report_id = target.id and g.expires_at > now())
    or not ((target.status = 'ACTIVE' and target.expires_at > now()) or (target.status = 'RESOLVED' and target.resolved_at > now() - cfg.resolved_visibility))
  then raise exception 'NETWORK_CONTENT_NOT_VISIBLE' using errcode = 'P0002'; end if;
  if target.author_user_id = actor then raise exception 'NETWORK_SELF_REPORT_NOT_ALLOWED' using errcode = '42501'; end if;
  if (select count(*) from public.network_content_reports where reporter_user_id = actor and created_at >= now() - interval '1 hour') >= cfg.content_report_limit_hour
  then raise exception 'Content reporting rate limit reached.' using errcode = 'P0001'; end if;
  insert into public.network_content_reports (reporter_user_id, report_id, update_id, reason, details)
  values (actor, target_report_id, target_update_id, target_reason, clean_details)
  on conflict do nothing returning id into inserted_id;
  if inserted_id is null then raise exception 'Content was already reported.' using errcode = '23505'; end if;
  return inserted_id;
end;
$$;

create or replace function public.expire_network_reports()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare affected integer;
begin
  update public.network_reports set status = 'EXPIRED', updated_at = now()
  where status = 'ACTIVE' and expires_at <= now();
  get diagnostics affected = row_count;
  delete from public.network_rate_limit_events where created_at < now() - interval '1 day';
  delete from public.network_report_visibility_grants where expires_at <= now();
  return affected;
end;
$$;

revoke all on function public.network_user_is_restricted(uuid, text) from public, anon, authenticated;
revoke all on function public.network_user_is_eligible(uuid) from public, anon, authenticated;
revoke all on function public.network_public_cell_id(extensions.geography, integer) from public, anon, authenticated;
revoke all on function public.network_public_cell_center(text, integer) from public, anon, authenticated;
revoke all on function public.accept_network_terms(text, integer) from public, anon;
revoke all on function public.create_network_report(public.network_report_category, text, double precision, double precision, double precision) from public, anon;
revoke all on function public.list_nearby_network_reports(double precision, double precision, integer, integer, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_network_report(uuid) from public, anon;
revoke all on function public.respond_to_network_report(uuid, public.network_confirmation_kind) from public, anon;
revoke all on function public.add_network_report_update(uuid, text) from public, anon;
revoke all on function public.resolve_my_network_report(uuid) from public, anon;
revoke all on function public.report_network_content(uuid, uuid, public.network_content_report_reason, text) from public, anon;
revoke all on function public.expire_network_reports() from public, anon, authenticated;

grant execute on function public.accept_network_terms(text, integer) to authenticated;
grant execute on function public.create_network_report(public.network_report_category, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.list_nearby_network_reports(double precision, double precision, integer, integer, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_network_report(uuid) to authenticated;
grant execute on function public.respond_to_network_report(uuid, public.network_confirmation_kind) to authenticated;
grant execute on function public.add_network_report_update(uuid, text) to authenticated;
grant execute on function public.resolve_my_network_report(uuid) to authenticated;
grant execute on function public.report_network_content(uuid, uuid, public.network_content_report_reason, text) to authenticated;
grant execute on function public.expire_network_reports() to service_role;

commit;
