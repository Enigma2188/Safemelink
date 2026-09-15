begin;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'safemelink-expire-network-reports';

select cron.schedule(
  'safemelink-expire-network-reports',
  '*/5 * * * *',
  'select public.expire_network_reports();'
);

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
  if (select count(*) from public.network_reports as hourly_report where hourly_report.author_user_id = actor and hourly_report.created_at >= now() - interval '1 hour') >= cfg.create_limit_hour
    or (select count(*) from public.network_reports as daily_report where daily_report.author_user_id = actor and daily_report.created_at >= now() - interval '1 day') >= cfg.create_limit_day
  then raise exception 'Network publishing rate limit reached.' using errcode = 'P0001'; end if;
  report_location := extensions.st_setsrid(extensions.st_makepoint(target_longitude, target_latitude), 4326)::extensions.geography;
  report_public_cell_id := public.network_public_cell_id(report_location, cfg.public_cell_size_meters);
  report_public_location := public.network_public_cell_center(report_public_cell_id, cfg.public_cell_size_meters);
  if exists (select 1 from public.network_reports r where r.author_user_id = actor and r.category = target_category
    and r.created_at >= now() - cfg.duplicate_window and r.status = 'ACTIVE' and r.expires_at > now()
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

revoke all on function public.create_network_report(public.network_report_category, text, double precision, double precision, double precision) from public, anon;
grant execute on function public.create_network_report(public.network_report_category, text, double precision, double precision, double precision) to authenticated;

commit;
