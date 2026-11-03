-- DRAFT / NOT APPLIED. Additive, dormant; no territory, policy or member seeded.
-- Deployment and privacy approval are separate authorizations. No legacy RPC replaced.
begin;

create table public.network_map_territories_v2 (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  boundary extensions.geometry(MultiPolygon,4326) not null,
  geometry_source text not null,
  geometry_license text not null,
  geometry_version text not null,
  enabled boolean not null default false,
  policy_version text,
  controller_approval_ref text,
  retention_decision_ref text,
  privacy_review_ref text,
  min_reports integer check (min_reports >= 2),
  min_contributors integer check (min_contributors >= 2),
  low_max integer,
  medium_max integer,
  snapshot_ttl interval check (snapshot_ttl > interval '0'),
  -- One publication window per territory; no arbitrary dates/categories at read time.
  period_kind text check (period_kind in ('MONTH','QUARTER')),
  check (not extensions.st_isempty(boundary) and extensions.st_isvalid(boundary)),
  check (not enabled or (
    nullif(btrim(policy_version),'') is not null
    and nullif(btrim(controller_approval_ref),'') is not null
    and nullif(btrim(retention_decision_ref),'') is not null
    and nullif(btrim(privacy_review_ref),'') is not null
    and min_reports is not null and min_contributors is not null
    and low_max >= min_reports and medium_max > low_max
    and snapshot_ttl is not null and period_kind is not null
  ) is true)
);

create table public.network_map_zones_v2 (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.network_map_territories_v2 on delete cascade,
  level_code text not null default 'BASE' check (length(level_code) between 1 and 40),
  zone_code text not null,
  label text not null,
  geometry extensions.geometry(MultiPolygon,4326) not null,
  unique (territory_id,level_code,zone_code),
  unique (id,territory_id),
  check (not extensions.st_isempty(geometry) and extensions.st_isvalid(geometry))
);
create index network_map_zones_v2_geometry_idx on public.network_map_zones_v2 using gist(geometry);
create index network_map_zones_v2_geography_idx on public.network_map_zones_v2 using gist((geometry::extensions.geography));

create table public.network_map_members_v2 (
  territory_id uuid not null references public.network_map_territories_v2 on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  policy_version text not null,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  primary key (territory_id,user_id)
);

-- Explicit scope/basis review, NOT automatic import of legacy reports or expiry.
-- Only public_location is used by the new aggregation helper. No private GPS copy.
create table public.network_map_sources_v2 (
  report_id uuid primary key references public.network_reports on delete cascade,
  territory_id uuid not null references public.network_map_territories_v2 on delete cascade,
  policy_version text not null,
  inclusion_review_ref text not null check (length(btrim(inclusion_review_ref)) > 0),
  revoked_at timestamptz
);

create table public.network_map_publications_v2 (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.network_map_territories_v2 on delete cascade,
  zone_id uuid not null,
  policy_version text not null,
  period_start date not null,
  period_end date not null,
  report_count integer not null check (report_count >= 0),
  contributor_count integer not null check (contributor_count >= 0),
  state text not null default 'DRAFT' check (state in ('DRAFT','APPROVED','WITHDRAWN')),
  -- Per-release review must cover differencing, other windows, categories and legacy feed.
  disclosure_review_ref text,
  reviewed_at timestamptz,
  valid_until timestamptz not null,
  foreign key (zone_id,territory_id) references public.network_map_zones_v2(id,territory_id),
  check (period_end > period_start),
  check (state <> 'APPROVED' or (
    nullif(btrim(disclosure_review_ref),'') is not null
    and reviewed_at is not null and valid_until > reviewed_at
  ) is true)
);
create unique index network_map_one_approved_zone_v2 on public.network_map_publications_v2(territory_id,zone_id)
  where state = 'APPROVED';
create table public.network_map_publication_sources_v2 (
  publication_id uuid not null references public.network_map_publications_v2 on delete cascade,
  report_id uuid not null references public.network_map_sources_v2(report_id) on delete cascade,
  primary key (publication_id,report_id)
);

create table public.network_history_entries_v2 (
  id uuid primary key default gen_random_uuid(), -- new public identity, never original ID
  territory_id uuid not null references public.network_map_territories_v2 on delete cascade,
  zone_id uuid not null,
  source_report_id uuid not null references public.network_map_sources_v2(report_id) on delete cascade,
  policy_version text not null,
  category public.network_report_category not null,
  public_month date not null check (extract(day from public_month) = 1),
  summary text not null check (length(btrim(summary)) between 10 and 500),
  state text not null default 'DRAFT' check (state in ('DRAFT','APPROVED','WITHDRAWN')),
  revision integer not null default 1 check (revision > 0),
  disclosure_review_ref text,
  reviewed_at timestamptz,
  valid_until timestamptz not null,
  foreign key (zone_id,territory_id) references public.network_map_zones_v2(id,territory_id),
  check (state <> 'APPROVED' or (
    nullif(btrim(disclosure_review_ref),'') is not null
    and reviewed_at is not null and valid_until > reviewed_at
  ) is true)
);

-- Foreign-key reverse lookups and the actual RPC access paths; no legacy indexes changed.
create index network_map_members_v2_user_idx on public.network_map_members_v2(user_id);
create index network_map_sources_v2_territory_idx on public.network_map_sources_v2(territory_id,policy_version);
create index network_map_publication_sources_v2_report_idx on public.network_map_publication_sources_v2(report_id);
create index network_map_publications_v2_zone_idx on public.network_map_publications_v2(zone_id) where state='APPROVED';
create index network_history_v2_source_idx on public.network_history_entries_v2(source_report_id);
create index network_history_v2_page_idx on public.network_history_entries_v2(territory_id,zone_id,public_month desc,id desc)
  where state='APPROVED';

-- Any public-content/scope/expiry edit requires a SECOND, explicit approval operation.
-- Invoker trigger, no dynamic SQL, transport or changes to operational NETWORK tables.
create function public.network_history_invalidate_review_v2()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.id is distinct from old.id then
    raise exception 'History identity is immutable' using errcode='22023';
  end if;
  if row(new.territory_id,new.zone_id,new.source_report_id,new.policy_version,
    new.category,new.public_month,new.summary,new.valid_until)
    is distinct from row(old.territory_id,old.zone_id,old.source_report_id,old.policy_version,
    old.category,old.public_month,old.summary,old.valid_until) then
    new.state := 'DRAFT';
    new.reviewed_at := null;
    new.disclosure_review_ref := null;
    new.revision := old.revision+1;
  else
    new.revision := old.revision;
  end if;
  return new;
end; $$;
create trigger network_history_invalidate_review_v2 before update on public.network_history_entries_v2
  for each row execute function public.network_history_invalidate_review_v2();

-- RLS without client policies: all table REST access denied. No client write RPCs.
alter table public.network_map_territories_v2 enable row level security;
alter table public.network_map_zones_v2 enable row level security;
alter table public.network_map_members_v2 enable row level security;
alter table public.network_map_sources_v2 enable row level security;
alter table public.network_map_publications_v2 enable row level security;
alter table public.network_map_publication_sources_v2 enable row level security;
alter table public.network_history_entries_v2 enable row level security;
revoke all on table public.network_map_territories_v2, public.network_map_zones_v2,
  public.network_map_members_v2, public.network_map_sources_v2,
  public.network_map_publications_v2, public.network_map_publication_sources_v2,
  public.network_history_entries_v2 from public, anon, authenticated;
grant select, insert, update, delete on table public.network_map_territories_v2,
  public.network_map_zones_v2, public.network_map_members_v2, public.network_map_sources_v2,
  public.network_map_publications_v2, public.network_map_publication_sources_v2,
  public.network_history_entries_v2 to service_role;

create function public.network_map_require_access_v2(target_territory uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.network_user_is_eligible(actor)
    or public.network_user_is_restricted(actor,'read') then
    raise exception 'NETWORK map access unavailable' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.network_map_territories_v2 t
    join public.network_map_members_v2 m on m.territory_id=t.id
    where t.id=target_territory and t.enabled and m.user_id=actor
      and m.policy_version=t.policy_version and m.revoked_at is null and m.valid_until>now()
  ) then raise exception 'NETWORK map access unavailable' using errcode='42501'; end if;
end; $$;

-- One canonical assignment per territory AND level, shared by every projection.
-- ST_Covers includes shared edges; lexical code + UUID break ties deterministically.
create function public.network_map_canonical_zone_v2(target_territory uuid, target_report uuid,
  target_level text default 'BASE')
returns uuid language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select z.id from public.network_map_zones_v2 z
  join public.network_map_territories_v2 t on t.id=z.territory_id
  join public.network_map_sources_v2 s on s.report_id=target_report and s.territory_id=t.id
  join public.network_reports r on r.id=s.report_id
  where t.id=target_territory and z.level_code=target_level
    and s.revoked_at is null and s.policy_version=t.policy_version
    and extensions.st_coveredby(z.geometry,t.boundary)
    and extensions.st_covers(t.boundary,r.public_location::extensions.geometry)
    and extensions.st_covers(z.geometry,r.public_location::extensions.geometry)
  order by z.zone_code collate "C",z.id limit 1;
$$;

-- Service-only candidate counts: NOT a publication decision, never callable by clients.
create function public.network_map_candidates_v2(target_territory uuid, target_month date,
  target_level text default 'BASE')
returns table(zone_id uuid, report_count bigint, contributor_count bigint)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select z.id, count(*), count(distinct r.author_user_id)
  from public.network_map_sources_v2 s
  join public.network_reports r on r.id=s.report_id
  join public.network_map_territories_v2 t on t.id=s.territory_id
  join public.network_map_zones_v2 z
    on z.id=public.network_map_canonical_zone_v2(t.id,r.id,target_level)
  where t.id=target_territory and s.revoked_at is null and s.policy_version=t.policy_version
    and target_month=date_trunc('month',target_month)::date
    and r.created_at >= target_month::timestamp at time zone 'UTC'
    and r.created_at < (target_month + interval '1 month')::timestamp at time zone 'UTC'
    and r.moderation_state='VISIBLE' and r.status in ('ACTIVE','RESOLVED','EXPIRED')
  group by z.id;
$$;

-- Revalidate source links on EVERY read; deletion/revocation suppresses the whole release.
create function public.network_map_publication_safe_v2(target_publication uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from public.network_map_publications_v2 p
    join public.network_map_territories_v2 t on t.id=p.territory_id
    where p.id=target_publication and t.enabled and p.state='APPROVED'
      and p.policy_version=t.policy_version and p.valid_until>now()
      and p.reviewed_at<=now() and p.valid_until<=p.reviewed_at+t.snapshot_ttl
      and p.report_count>=t.min_reports and p.contributor_count>=t.min_contributors
      and p.period_end<= (now() at time zone 'UTC')::date
      and p.period_start=date_trunc(case t.period_kind when 'MONTH' then 'month' else 'quarter' end,p.period_start)::date
      and p.period_end=(p.period_start+case t.period_kind when 'MONTH' then interval '1 month' else interval '3 months' end)::date
      and not exists (select 1 from public.network_map_publications_v2 other
        where other.territory_id=t.id and other.state='APPROVED'
          and (other.period_start<>p.period_start or other.period_end<>p.period_end))
      and (select count(*)=p.report_count and count(distinct r.author_user_id)=p.contributor_count
        from public.network_map_publication_sources_v2 link
        join public.network_map_sources_v2 s on s.report_id=link.report_id
        join public.network_reports r on r.id=s.report_id
        join public.network_map_zones_v2 z on z.id=p.zone_id
        where link.publication_id=p.id and s.territory_id=t.id
          and s.policy_version=t.policy_version and s.revoked_at is null
          and r.moderation_state='VISIBLE' and r.status in ('ACTIVE','RESOLVED','EXPIRED')
          and r.created_at >= p.period_start::timestamp at time zone 'UTC'
          and r.created_at < p.period_end::timestamp at time zone 'UTC'
          and z.id=public.network_map_canonical_zone_v2(t.id,r.id,z.level_code)
      ) is true
      and (select count(*) from public.network_map_publication_sources_v2 link
        where link.publication_id=p.id)=p.report_count
  );
$$;

create function public.get_network_territory_context_v2(target_territory uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform public.network_map_require_access_v2(target_territory);
  return (select jsonb_build_object('territoryId',t.id,'label',t.label,
    'boundary',extensions.st_asgeojson(t.boundary)::jsonb,'geometryVersion',t.geometry_version,
    'policyVersion',t.policy_version,'periodKind',t.period_kind,
    'radiiMeters',jsonb_build_array(1000,2500,5000,10000))
    from public.network_map_territories_v2 t where t.id=target_territory);
end; $$;

create function public.list_network_map_cells_v2(target_territory uuid,
  radius_meters integer default null, viewer_latitude double precision default null,
  viewer_longitude double precision default null, target_level text default 'BASE')
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform public.network_map_require_access_v2(target_territory);
  if target_level is null or length(target_level) not between 1 and 40 then
    raise exception 'Invalid map level' using errcode='22023'; end if;
  if (radius_meters is null and (viewer_latitude is not null or viewer_longitude is not null))
    or (radius_meters is not null and (
      radius_meters not in (1000,2500,5000,10000)
      or (viewer_latitude between -90 and 90) is not true
      or (viewer_longitude between -180 and 180) is not true
    )) then raise exception 'Invalid map radius/coordinates' using errcode='22023'; end if;
  -- Whole-zone selection only. A changed radius never recalculates population/counts.
  return (select jsonb_build_object('zones',coalesce(jsonb_agg(jsonb_build_object(
    'zoneId',z.id,'level',z.level_code,'label',z.label,'geometry',extensions.st_asgeojson(z.geometry)::jsonb,
    'availability',case when p.id is null then 'INSUFFICIENT_DATA' else 'PUBLISHED' end,
    'activityBand',case when p.id is null then null when p.report_count<=t.low_max then 'LOW'
      when p.report_count<=t.medium_max then 'MEDIUM' else 'HIGH' end,
    'periodStart',p.period_start,'periodEnd',p.period_end,'validUntil',p.valid_until,
    'policyVersion',t.policy_version) order by z.zone_code),'[]'::jsonb))
    from public.network_map_zones_v2 z
    join public.network_map_territories_v2 t on t.id=z.territory_id
    left join public.network_map_publications_v2 p on p.zone_id=z.id and p.state='APPROVED'
      and public.network_map_publication_safe_v2(p.id)
    where z.territory_id=target_territory and z.level_code=target_level
    and extensions.st_coveredby(z.geometry,t.boundary)
    and (radius_meters is null or extensions.st_dwithin(
      z.geometry::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(viewer_longitude,viewer_latitude),4326)::extensions.geography,
      radius_meters)));
end; $$;

create function public.list_network_zone_history_v2(target_territory uuid, target_zone uuid,
  page_size integer default 20, cursor_month date default null, cursor_entry uuid default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform public.network_map_require_access_v2(target_territory);
  if page_size is null or page_size not between 1 and 50
    or (cursor_month is null) <> (cursor_entry is null) then
    raise exception 'Invalid history page/cursor' using errcode='22023'; end if;
  -- ALL visibility/cohort filters precede keyset ordering and limit.
  return (with eligible as materialized (
    select h.* from public.network_history_entries_v2 h
    join public.network_map_territories_v2 t on t.id=h.territory_id
    join public.network_map_zones_v2 z on z.id=h.zone_id and z.territory_id=t.id
    join public.network_map_sources_v2 s on s.report_id=h.source_report_id
    join public.network_reports r on r.id=s.report_id
    where h.territory_id=target_territory and h.zone_id=target_zone
      and h.state='APPROVED' and h.policy_version=t.policy_version
      and h.reviewed_at<=now() and h.valid_until>now()
      and s.territory_id=t.id and s.policy_version=t.policy_version and s.revoked_at is null
      and r.status in ('RESOLVED','EXPIRED') and r.moderation_state='VISIBLE'
      and h.category=r.category
      and h.public_month=date_trunc('month',r.created_at at time zone 'UTC')::date
      and z.id=public.network_map_canonical_zone_v2(t.id,r.id,z.level_code)
      and (cursor_month is null or (h.public_month,h.id)<(cursor_month,cursor_entry))
      and exists (select 1 from public.network_map_publications_v2 p
        join public.network_map_publication_sources_v2 link on link.publication_id=p.id
          and link.report_id=h.source_report_id
        where p.territory_id=h.territory_id and p.zone_id=h.zone_id
          and p.state='APPROVED' and public.network_map_publication_safe_v2(p.id)
          and r.created_at>=p.period_start::timestamp at time zone 'UTC'
          and r.created_at<p.period_end::timestamp at time zone 'UTC')
    order by h.public_month desc,h.id desc limit (page_size+1)
  ), page as (select * from eligible order by public_month desc,id desc limit page_size)
  select jsonb_build_object('entries',coalesce(jsonb_agg(jsonb_build_object(
    'entryId',h.id,'zoneId',h.zone_id,'month',h.public_month,'category',h.category,
    'summary',h.summary,'state','CONCLUDED','revision',h.revision,'validUntil',h.valid_until)
    order by h.public_month desc,h.id desc),'[]'::jsonb),'availability',
      case when count(*)=0 then 'INSUFFICIENT_DATA' else 'REVIEWED_HISTORY' end,
    'nextCursor',case when (select count(*) from eligible)>page_size then
      (select jsonb_build_object('month',last.public_month,'entryId',last.id)
        from page last order by last.public_month,last.id limit 1) else null end)
    from page h);
end; $$;

revoke all on function public.network_map_require_access_v2(uuid),
  public.network_history_invalidate_review_v2(),
  public.network_map_canonical_zone_v2(uuid,uuid,text),
  public.network_map_candidates_v2(uuid,date,text), public.network_map_publication_safe_v2(uuid),
  public.get_network_territory_context_v2(uuid),
  public.list_network_map_cells_v2(uuid,integer,double precision,double precision,text),
  public.list_network_zone_history_v2(uuid,uuid,integer,date,uuid) from public, anon, authenticated;
grant execute on function public.network_map_candidates_v2(uuid,date,text) to service_role;
grant execute on function public.get_network_territory_context_v2(uuid),
  public.list_network_map_cells_v2(uuid,integer,double precision,double precision,text),
  public.list_network_zone_history_v2(uuid,uuid,integer,date,uuid) to authenticated;

-- No scheduler, HTTP, notification, legacy-table trigger, automatic archiving or activation.
commit;
