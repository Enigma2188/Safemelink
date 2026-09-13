begin;

-- Avoid PL/pgSQL output-column ambiguity between the RETURNS TABLE report_id
-- variable and the visibility-grant conflict target / RETURNING column.
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
  if (select count(*) from public.network_rate_limit_events as feed_read_event where feed_read_event.user_id = actor and feed_read_event.action = 'FEED_READ' and feed_read_event.created_at >= now() - interval '1 minute') >= cfg.feed_read_limit_minute
  then raise exception 'NETWORK_FEED_RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into public.network_rate_limit_events (user_id, action) values (actor, 'FEED_READ');
  selected_radius := least(greatest(coalesce(radius_meters, cfg.default_feed_radius_meters), 100), cfg.max_feed_radius_meters);
  selected_size := least(greatest(coalesce(requested_page_size, cfg.page_size_default), 1), cfg.page_size_max);
  viewer_point := extensions.st_setsrid(extensions.st_makepoint(viewer_longitude, viewer_latitude), 4326)::extensions.geography;
  public_center := public.network_public_cell_center(public.network_public_cell_id(viewer_point, cfg.public_cell_size_meters), cfg.public_cell_size_meters);
  return query
  with candidates as materialized (
    select report.id, report.status, report.category, report.description, report.author_nickname_snapshot, report.public_area_label,
      (round(extensions.st_distance(report.public_location, public_center)
        / cfg.public_cell_size_meters) * cfg.public_cell_size_meters)::integer as distance_bucket_meters,
      report.created_at, report.expires_at, report.confirmation_count, report.no_longer_present_count, confirmation.kind
    from public.network_reports as report
    left join public.network_report_confirmations as confirmation
      on confirmation.report_id = report.id
      and confirmation.user_id = actor
    where report.moderation_state = 'VISIBLE'
      and ((report.status = 'ACTIVE' and report.expires_at > now())
        or (report.status = 'RESOLVED' and report.resolved_at > now() - cfg.resolved_visibility))
      and extensions.st_dwithin(report.public_location, public_center, selected_radius)
      and (cursor_status_bucket is null
        or case when report.status = 'ACTIVE' then 0 else 1 end > cursor_status_bucket
        or (case when report.status = 'ACTIVE' then 0 else 1 end = cursor_status_bucket
          and report.created_at < cursor_created_at)
        or (case when report.status = 'ACTIVE' then 0 else 1 end = cursor_status_bucket
          and report.created_at = cursor_created_at and report.id < cursor_report_id))
    order by case when report.status = 'ACTIVE' then 0 else 1 end,
      report.created_at desc, report.id desc
    limit selected_size
  ), granted as (
    insert into public.network_report_visibility_grants as visibility_grant (
      user_id,
      report_id,
      granted_at,
      expires_at
    )
    select actor, candidate.id, now(), now() + cfg.visibility_grant_ttl
    from candidates as candidate
    on conflict on constraint network_report_visibility_grants_pkey
    do update set
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at
    returning visibility_grant.report_id
  )
  select candidate.*
  from candidates as candidate,
    (select count(*) from granted) as grant_execution_guard;
end;
$$;

revoke all on function public.list_nearby_network_reports(double precision, double precision, integer, integer, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_nearby_network_reports(double precision, double precision, integer, integer, timestamptz, uuid, integer) to authenticated;

commit;
