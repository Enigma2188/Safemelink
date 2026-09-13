begin;

-- Avoid PL/pgSQL output-column ambiguity between the RETURNS TABLE
-- expires_at variable and neighborhood_invitations.expires_at.
create or replace function public.list_my_neighborhood_invitations()
returns table (
  invitation_id uuid,
  direction text,
  network_id uuid,
  network_name text,
  counterpart_nickname text,
  invitation_status text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  update public.neighborhood_invitations as expired_invitation
  set status = 'expired', responded_at = now()
  where expired_invitation.status = 'pending'
    and expired_invitation.expires_at <= now();

  return query
  select invitation.id,
    case when invitation.invited_user_id = auth.uid() then 'received' else 'sent' end,
    network.id,
    network.name,
    coalesce(nullif(btrim(counterpart.nickname), ''), 'Utente SafeMeLink'),
    invitation.status,
    invitation.created_at,
    invitation.expires_at
  from public.neighborhood_invitations as invitation
  join public.neighborhood_networks as network
    on network.id = invitation.network_id
    and network.status = 'active'
  join public.profiles as counterpart
    on counterpart.id = case
      when invitation.invited_user_id = auth.uid()
        then invitation.invited_by
      else invitation.invited_user_id
    end
  where invitation.status = 'pending'
    and (
      invitation.invited_user_id = auth.uid()
      or exists (
        select 1
        from public.neighborhood_members as membership
        where membership.network_id = invitation.network_id
          and membership.user_id = auth.uid()
          and membership.role = 'admin'
      )
    )
  order by invitation.created_at desc;
end;
$$;

revoke all on function public.list_my_neighborhood_invitations() from public, anon;
grant execute on function public.list_my_neighborhood_invitations() to authenticated;

-- Avoid PL/pgSQL output-column ambiguity between the RETURNS TABLE
-- created_at variable and network_reports.created_at in rate-limit checks.
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

revoke all on function public.create_network_report(public.network_report_category, text, double precision, double precision, double precision) from public, anon;
grant execute on function public.create_network_report(public.network_report_category, text, double precision, double precision, double precision) to authenticated;

commit;
