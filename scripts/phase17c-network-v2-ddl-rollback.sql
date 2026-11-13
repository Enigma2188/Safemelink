-- PHASE 17C VARIANT. Original Phase 17 file and three migrations are unchanged.
-- Approval status: PENDING_EVIDENCE. Never auto-approve observed hashes.
-- Official reference candidate 17.6.1.166; target identity/build/incident require independent review.
-- NETWORK V2 PHASE 17: DDL-only validation, NOT a deployment migration.
-- Expected Development: lwkxufnbjrpsehdkfmgy. Identity MUST be checked outside SQL.
-- No Auth users, fixture rows, application RPC calls, transports or activation.
-- Default blocked. Change only the acknowledgement after separate authorization.
-- A rollback does NOT erase logs or external effects. Only EXACT approved event triggers can pass; pending evidence and health block execution.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local transaction_timeout='90s'; -- PostgreSQL 17+, cancels the entire transaction
set local idle_in_transaction_session_timeout='30s';
set local check_function_bodies=on;
set local search_path=pg_catalog,pg_temp;
set local safemelink.phase17_target_review='UNCONFIRMED';
set local safemelink.phase17c_health_review='UNCONFIRMED';
set local safemelink.phase17c_execution_review='UNCONFIRMED';
do $phase17_guard$
declare item text; approved record;
begin
  if current_user<>'postgres' or current_setting('server_version_num')::integer<170000
    or current_setting('safemelink.phase17_target_review',true) is distinct from 'AUTHORIZED_DEVELOPMENT_lwkxufnbjrpsehdkfmgy' then
    raise exception 'STOP: explicit Development authorization / role / PG17 required'; end if;

  if 'PENDING_EVIDENCE' is distinct from 'APPROVED'
    or null::text is null or 'NOT_VERIFIED' is distinct from 'REVIEWED_FOR_TARGET'
    or current_setting('safemelink.phase17c_health_review',true) is distinct from 'SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER'
    or current_setting('safemelink.phase17c_execution_review',true) is distinct from 'AUTHORIZED_DDL_ONLY_QUIET_WINDOW'
    or current_setting('session_replication_role') is distinct from 'origin' then
    raise exception 'STOP: exact trigger approval, service health and execution window not confirmed'; end if;
  if (select count(*) from pg_event_trigger)<>6 then raise exception 'STOP: unexpected event trigger inventory'; end if;
  for approved in select * from (values ('issue_graphql_placeholder','sql_drop','["DROP EXTENSION"]'::jsonb,'set_graphql_placeholder','19e858a99cf5698c4730343fb43cdad4ab2f0717a8ded8a691a0e2786b859708',null::text,null::text,null::text),
('issue_pg_cron_access','ddl_command_end','["CREATE EXTENSION"]'::jsonb,'grant_pg_cron_access','00db212b76cecd4b0794b2f20c414ab4988d675959747cd12d3eb4c6d6736f38',null::text,null::text,null::text),
('issue_pg_graphql_access','ddl_command_end','["CREATE EXTENSION"]'::jsonb,'grant_pg_graphql_access','fb5a80e6d30734718db960270a5f0eac0d655e238e8128ba56803b74a052bc1e',null::text,null::text,null::text),
('issue_pg_net_access','ddl_command_end','["CREATE EXTENSION"]'::jsonb,'grant_pg_net_access','55abda380efd46b37b26d3c6e4f3b514e28b7c7c1df44f5ae0315ece4052370d',null::text,null::text,null::text),
('pgrst_ddl_watch','ddl_command_end','null'::jsonb,'pgrst_ddl_watch','de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0',null::text,null::text,null::text),
('pgrst_drop_watch','sql_drop','null'::jsonb,'pgrst_drop_watch','791b41f0632fc86e0fc86a303ec0fd710c4e2ecf947a23422dae2b7a2c122f1d',null::text,null::text,null::text)) v(name,event,tags,function_name,source_hash,definition_hash,function_metadata_hash,trigger_metadata_hash) loop
    if approved.definition_hash is null or approved.function_metadata_hash is null or approved.trigger_metadata_hash is null
      or not exists(select 1 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
        join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where e.evtname=approved.name and e.evtevent=approved.event and e.evtenabled='O'
          and coalesce(to_jsonb(e.evttags),'null'::jsonb)=approved.tags
          and n.nspname='extensions' and p.proname=approved.function_name and p.pronargs=0
          and p.prokind='f' and p.prorettype='pg_catalog.event_trigger'::regtype
          and encode(sha256(convert_to((p.prosrc)::text,'UTF8')),'hex')=approved.source_hash and encode(sha256(convert_to((pg_get_functiondef(p.oid))::text,'UTF8')),'hex')=approved.definition_hash
          and encode(sha256(convert_to((jsonb_build_object('schema',n.nspname,'name',p.proname,
 'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile::text,'strict',p.proisstrict,'leakproof',p.proleakproof,
 'parallel',p.proparallel::text,'returnsSet',p.proretset,'acl',p.proacl::text,
 'configHash',encode(sha256(convert_to((coalesce(p.proconfig::text,'<NULL>'))::text,'UTF8')),'hex'),
 'searchPath',(select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1)))::text,'UTF8')),'hex')=approved.function_metadata_hash and encode(sha256(convert_to((jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled::text,
 'tags',to_jsonb(e.evttags),'owner',pg_get_userbyid(e.evtowner),
 'functionSchema',n.nspname,'functionName',p.proname,'arguments',pg_get_function_identity_arguments(p.oid)))::text,'UTF8')),'hex')=approved.trigger_metadata_hash) then
      raise exception 'STOP: unapproved event trigger definition or metadata: %',approved.name; end if;
  end loop;

  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis' and n.nspname='extensions') then
    raise exception 'STOP: PostGIS in extensions required'; end if;
  foreach item in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=item) then raise exception 'STOP: missing required role'; end if;
  end loop;
  foreach item in array array['public.profiles','public.network_reports','public.network_preferences','public.network_config','public.network_user_restrictions'] loop
    if to_regclass(item) is null then raise exception 'STOP: base table missing: %',item; end if;
  end loop;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('public.network_user_is_eligible(uuid)') is null
    or to_regprocedure('public.network_user_is_restricted(uuid,text)') is null then raise exception 'STOP: base function missing'; end if;
  if has_schema_privilege('anon','public','CREATE') is distinct from false or has_schema_privilege('authenticated','public','CREATE') is distinct from false
    or has_schema_privilege('anon','extensions','CREATE') is distinct from false or has_schema_privilege('authenticated','extensions','CREATE') is distinct from false then
    raise exception 'STOP: untrusted schema CREATE'; end if;
  foreach item in array array['network_map_territories_v2','network_map_zones_v2','network_map_members_v2','network_map_sources_v2','network_map_publications_v2','network_map_publication_sources_v2','network_history_entries_v2','network_event_policies_v2','network_event_members_v2','network_events_v2','network_event_read_buckets_v2','network_event_write_buckets_v2','network_social_policies_v2','network_social_votes_v2','network_social_follows_v2','network_social_comments_v2','network_social_operations_v2','network_map_zones_v2_geometry_idx','network_map_zones_v2_geography_idx','network_map_one_approved_zone_v2','network_map_members_v2_user_idx','network_map_sources_v2_territory_idx','network_map_publication_sources_v2_report_idx','network_map_publications_v2_zone_idx','network_history_v2_source_idx','network_history_v2_page_idx','network_events_v2_author_time_idx','network_events_v2_public_geo_idx','network_events_v2_feed_idx','network_events_v2_purge_idx','network_events_v2_review_idx','network_event_members_v2_user_idx','network_event_territory_discovery_idx','network_social_operations_actor_time_idx','network_social_comments_page_idx','network_social_comments_queue_idx','network_social_comments_activity_idx','network_social_follows_owner_idx'] loop
    if to_regclass('public.'||item) is not null or to_regtype('public.'||item) is not null then raise exception 'STOP: occupied relation/type name: %',item; end if;
  end loop;
  foreach item in array array['network_map_territories_v2','network_map_zones_v2','network_map_members_v2','network_map_sources_v2','network_map_publications_v2','network_map_publication_sources_v2','network_history_entries_v2','network_event_policies_v2','network_event_members_v2','network_events_v2','network_event_read_buckets_v2','network_event_write_buckets_v2','network_social_policies_v2','network_social_votes_v2','network_social_follows_v2','network_social_comments_v2','network_social_operations_v2'] loop
    if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and left(c.relname::text,length(item)+1)=item||'_') then raise exception 'STOP: occupied generated-object prefix: %',item; end if;
  end loop;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('network_history_invalidate_review_v2','network_map_require_access_v2','network_map_canonical_zone_v2','network_map_candidates_v2','network_map_publication_safe_v2','get_network_territory_context_v2','list_network_map_cells_v2','list_network_zone_history_v2','network_event_require_access_v2','network_event_take_read_v2','network_event_take_write_v2','network_event_guard_update_v2','create_network_event_v2','network_event_is_public_v2','network_event_marker_json_v2','list_network_event_markers_v2','get_network_event_detail_v2','list_network_event_territories_v2','list_network_event_review_queue_v2','review_network_event_v2','finish_my_network_event_v2','network_social_actor_allowed_v2','network_social_require_v2','get_network_social_v2','mutate_network_social_v2','get_my_network_social_operation_v2','remove_my_network_social_v2','review_network_comment_v2','list_network_comment_review_v2','list_network_social_activity_v2')) then
    raise exception 'STOP: occupied V2 function name or overload'; end if;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and t.tgname in ('network_history_invalidate_review_v2','network_event_guard_update_v2')) then raise exception 'STOP: occupied V2 trigger name'; end if;
end $phase17_guard$;
do $phase17_baseline$ declare h text; begin
  select md5(jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,p.proconfig::text,md5(pg_get_functiondef(p.oid))) order by p.oid),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname in ('public','auth') and p.proname not in ('network_history_invalidate_review_v2','network_map_require_access_v2','network_map_canonical_zone_v2','network_map_candidates_v2','network_map_publication_safe_v2','get_network_territory_context_v2','list_network_map_cells_v2','list_network_zone_history_v2','network_event_require_access_v2','network_event_take_read_v2','network_event_take_write_v2','network_event_guard_update_v2','create_network_event_v2','network_event_is_public_v2','network_event_marker_json_v2','list_network_event_markers_v2','get_network_event_detail_v2','list_network_event_territories_v2','list_network_event_review_queue_v2','review_network_event_v2','finish_my_network_event_v2','network_social_actor_allowed_v2','network_social_require_v2','get_network_social_v2','mutate_network_social_v2','get_my_network_social_operation_v2','remove_my_network_social_v2','review_network_comment_v2','list_network_comment_review_v2','list_network_social_activity_v2')),
    'tables',(select coalesce(jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
      (select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      (select jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid))) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
      (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by i.indexrelid) from pg_index i where i.indrelid=c.oid)) order by c.oid),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth') and c.relname not in ('network_map_territories_v2','network_map_zones_v2','network_map_members_v2','network_map_sources_v2','network_map_publications_v2','network_map_publication_sources_v2','network_history_entries_v2','network_event_policies_v2','network_event_members_v2','network_events_v2','network_event_read_buckets_v2','network_event_write_buckets_v2','network_social_policies_v2','network_social_votes_v2','network_social_follows_v2','network_social_comments_v2','network_social_operations_v2'))
  )::text) into h;
  perform set_config('safemelink.phase17_catalog_fingerprint',h,true);
end $phase17_baseline$;
-- BEGIN EXACT MIGRATION BODY 20261103120000_network_territorial_map_history.sql SHA256 729d45bfc1854fa48a74fe1f2f1e398e27db1d7fc3151f4e9e8a31ee8277d50d


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
  public.network_history_entries_v2 from public, anon, authenticated, service_role;
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
  public.list_network_zone_history_v2(uuid,uuid,integer,date,uuid) from public, anon, authenticated, service_role;
grant execute on function public.network_map_candidates_v2(uuid,date,text) to service_role;
grant execute on function public.get_network_territory_context_v2(uuid),
  public.list_network_map_cells_v2(uuid,integer,double precision,double precision,text),
  public.list_network_zone_history_v2(uuid,uuid,integer,date,uuid) to authenticated;
-- END EXACT MIGRATION BODY 20261103120000_network_territorial_map_history.sql
-- BEGIN EXACT MIGRATION BODY 20261107120000_network_event_markers_v2.sql SHA256 4cb5effe0d9db9d15e720a1f6f8dd345c84da09a28b323aaee16412eb8c2daa2

do $$ begin
  if current_user <> 'postgres' then raise exception 'Controlled postgres migration role required'; end if;
  if to_regclass('public.network_map_zones_v2') is null
    or to_regprocedure('public.network_user_is_eligible(uuid)') is null
    or to_regprocedure('public.network_user_is_restricted(uuid,text)') is null then
    raise exception 'Missing territorial/NETWORK dependencies';
  end if;
  if has_schema_privilege('anon','public','CREATE') is distinct from false
    or has_schema_privilege('authenticated','public','CREATE') is distinct from false
    or has_schema_privilege('anon','extensions','CREATE') is distinct from false
    or has_schema_privilege('authenticated','extensions','CREATE') is distinct from false then
    raise exception 'Untrusted schema CREATE requires separate remediation';
  end if;
end $$;

-- Independent event policy: no dependency on aggregate publication gates or municipal agreements.
-- No privacy/retention/precision values are chosen for real territories by this migration.
create table public.network_event_policies_v2 (
  territory_id uuid primary key references public.network_map_territories_v2(id),
  enabled boolean not null default false,
  access_mode text not null default 'NETWORK' check (access_mode in ('NETWORK','PILOT')),
  policy_version text,
  required_terms_version text,
  metric_srid integer check (metric_srid between 1 and 998999), -- validated against PostGIS registry at publication
  precision_meters integer check (precision_meters between 1 and 100000),
  min_cell_area_m2 double precision check (min_cell_area_m2 > 0 and min_cell_area_m2 < 'Infinity'::double precision),
  event_ttl interval check (event_ttl > interval '0' and event_ttl <= interval '30 days'),
  resolved_ttl interval check (resolved_ttl > interval '0' and resolved_ttl <= interval '30 days'),
  record_retention interval check (record_retention > interval '0'),
  create_limit_hour integer check (create_limit_hour between 1 and 20),
  create_limit_day integer check (create_limit_day between 1 and 100),
  read_limit_minute integer check (read_limit_minute between 1 and 120),
  privacy_approval_ref text,
  retention_decision_ref text,
  moderation_plan_ref text,
  check (not enabled or (
    nullif(btrim(policy_version),'') is not null
    and nullif(btrim(required_terms_version),'') is not null
    and metric_srid is not null and metric_srid <> 4326
    and precision_meters is not null and min_cell_area_m2 is not null
    and event_ttl is not null and resolved_ttl is not null
    and record_retention >= event_ttl and record_retention >= resolved_ttl
    and create_limit_hour is not null and create_limit_day >= create_limit_hour
    and read_limit_minute is not null
    and nullif(btrim(privacy_approval_ref),'') is not null
    and nullif(btrim(retention_decision_ref),'') is not null
    and nullif(btrim(moderation_plan_ref),'') is not null
  ) is true)
);
create table public.network_event_members_v2 (
  territory_id uuid not null references public.network_event_policies_v2(territory_id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_version text not null,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  primary key (territory_id,user_id)
);
create table public.network_events_v2 (
  public_id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  request_payload jsonb not null, -- canonical PUBLIC-cell payload; never original point
  territory_id uuid not null references public.network_event_policies_v2(territory_id),
  zone_id uuid not null,
  category_id text not null check (category_id in
    ('CIVIC_SAFETY','ROADS_TRAFFIC','LIGHTING','ENVIRONMENT_DECORUM','COMMUNITY_INFORMATION')),
  author_nickname_snapshot text not null check (char_length(btrim(author_nickname_snapshot)) between 2 and 40),
  description text not null check (char_length(btrim(description)) between 10 and 500),
  public_position extensions.geometry(Point,4326) not null,
  cell_key text not null,
  generalization_meters integer not null check (generalization_meters > 0),
  location_policy_version text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RESOLVED')),
  moderation_state text not null default 'PENDING' check (moderation_state in ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  review_ref text,
  reviewed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  expires_at timestamptz not null,
  purge_after timestamptz not null,
  unique (author_user_id,operation_id),
  foreign key (zone_id,territory_id) references public.network_map_zones_v2(id,territory_id),
  check (expires_at > created_at and purge_after >= expires_at),
  check ((status='RESOLVED') = (resolved_at is not null)),
  check (updated_at >= created_at and (resolved_at is null or (resolved_at >= created_at and resolved_at <= updated_at))),
  check (moderation_state <> 'APPROVED' or (nullif(btrim(review_ref),'') is not null and reviewed_at is not null) is true)
);
create table public.network_event_read_buckets_v2 (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bucket_start timestamptz not null,
  requests integer not null check (requests between 1 and 120)
);
-- Bounded counters, not a per-request history; independent of event retention/purging.
create table public.network_event_write_buckets_v2 (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hour_start timestamptz not null,
  hour_count integer not null check (hour_count between 1 and 20),
  day_start timestamptz not null,
  day_count integer not null check (day_count between 1 and 100)
);
create index network_events_v2_author_time_idx on public.network_events_v2(author_user_id,created_at desc);
create index network_events_v2_public_geo_idx on public.network_events_v2 using gist ((public_position::extensions.geography));
create index network_events_v2_feed_idx on public.network_events_v2(territory_id,status,category_id,created_at desc,public_id) where moderation_state='APPROVED';
create index network_events_v2_purge_idx on public.network_events_v2(purge_after);
create index network_events_v2_review_idx on public.network_events_v2(territory_id,created_at,public_id) where moderation_state='PENDING';
create index network_event_members_v2_user_idx on public.network_event_members_v2(user_id);
create index network_event_territory_discovery_idx on public.network_map_territories_v2 using gist ((boundary::extensions.geography));

alter table public.network_event_policies_v2 enable row level security;
alter table public.network_event_members_v2 enable row level security;
alter table public.network_events_v2 enable row level security;
alter table public.network_event_read_buckets_v2 enable row level security;
alter table public.network_event_write_buckets_v2 enable row level security;
revoke all on table public.network_event_policies_v2, public.network_event_members_v2,
  public.network_events_v2, public.network_event_read_buckets_v2, public.network_event_write_buckets_v2 from public, anon, authenticated, service_role;
grant select,insert,update on table public.network_event_policies_v2, public.network_event_members_v2 to service_role;
-- No client policies/direct grants. Only controlled RPCs access event identity/content.

create function public.network_event_require_access_v2(target_territory uuid, requested_action text)
returns public.network_event_policies_v2 language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid := auth.uid(); policy public.network_event_policies_v2%rowtype;
begin
  if actor is null or requested_action not in ('read','publish') or requested_action is null
    or public.network_user_is_eligible(actor) is distinct from true
    or public.network_user_is_restricted(actor,requested_action) is distinct from false then
    raise exception 'NETWORK event access unavailable' using errcode='42501';
  end if;
  select * into policy from public.network_event_policies_v2 where territory_id=target_territory and enabled;
  if not found then raise exception 'NETWORK event access unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.network_preferences p where p.user_id=actor
    and p.accepted_at is not null and p.network_terms_version=policy.required_terms_version) then
    raise exception 'Current event terms required' using errcode='42501'; end if;
  if policy.access_mode='PILOT' and not exists (
    select 1 from public.network_event_members_v2 m where m.territory_id=target_territory and m.user_id=actor
      and m.policy_version=policy.policy_version and m.revoked_at is null and m.valid_until>statement_timestamp()
  ) then raise exception 'NETWORK event access unavailable' using errcode='42501'; end if;
  return policy;
end; $$;

create function public.network_event_take_read_v2(max_reads integer)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare accepted integer;
begin
  if auth.uid() is null or max_reads is null or max_reads not between 1 and 120 then
    raise exception 'Read unavailable' using errcode='42501'; end if;
  insert into public.network_event_read_buckets_v2 as b(user_id,bucket_start,requests)
    values(auth.uid(),date_trunc('minute',statement_timestamp()),1)
    on conflict(user_id) do update set bucket_start=greatest(b.bucket_start,excluded.bucket_start),
      requests=case when b.bucket_start<excluded.bucket_start then 1 else b.requests+1 end
      where b.bucket_start<excluded.bucket_start or b.requests<max_reads
    returning requests into accepted;
  if accepted is null then raise exception 'NETWORK read limit reached' using errcode='54000'; end if;
end; $$;

create function public.network_event_take_write_v2(max_hour integer,max_day integer)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare accepted integer;
begin
  if auth.uid() is null or max_hour is null or max_hour not between 1 and 20
    or max_day is null or max_day not between max_hour and 100 then raise exception 'Publication unavailable' using errcode='42501'; end if;
  insert into public.network_event_write_buckets_v2 as b(user_id,hour_start,hour_count,day_start,day_count)
    values(auth.uid(),date_trunc('hour',statement_timestamp() at time zone 'UTC') at time zone 'UTC',1,
      date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC',1)
    on conflict(user_id) do update set
      hour_start=greatest(b.hour_start,excluded.hour_start),day_start=greatest(b.day_start,excluded.day_start),
      hour_count=case when b.hour_start<excluded.hour_start then 1 else b.hour_count+1 end,
      day_count=case when b.day_start<excluded.day_start then 1 else b.day_count+1 end
    where (b.hour_start<excluded.hour_start or b.hour_count<max_hour)
      and (b.day_start<excluded.day_start or b.day_count<max_day) returning day_count into accepted;
  if accepted is null then raise exception 'Publication limit reached' using errcode='54000'; end if;
end; $$;

create function public.network_event_guard_update_v2()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if row(new.public_id,new.author_user_id,new.operation_id,new.request_payload,new.territory_id,new.zone_id,
      extensions.st_asewkb(new.public_position),new.cell_key,new.generalization_meters,new.location_policy_version,new.created_at,new.purge_after)
    is distinct from row(old.public_id,old.author_user_id,old.operation_id,old.request_payload,old.territory_id,old.zone_id,
      extensions.st_asewkb(old.public_position),old.cell_key,old.generalization_meters,old.location_policy_version,old.created_at,old.purge_after) then
    raise exception 'Immutable event provenance' using errcode='22023'; end if;
  if row(new.description,new.category_id,new.author_nickname_snapshot) is distinct from
    row(old.description,old.category_id,old.author_nickname_snapshot) then
    new.moderation_state:='PENDING'; new.review_ref:=null; new.reviewed_at:=null;
  end if;
  if (old.status='RESOLVED' and new.status<>'RESOLVED') or
    (old.moderation_state='WITHDRAWN' and new.moderation_state<>'WITHDRAWN') or new.expires_at>old.expires_at then
    raise exception 'Terminal event cannot reactivate or extend' using errcode='22023'; end if;
  new.revision:=old.revision+1; new.updated_at:=greatest(old.updated_at,clock_timestamp()); return new;
end; $$;
create trigger network_event_guard_update_v2 before update on public.network_events_v2
  for each row execute function public.network_event_guard_update_v2();

create function public.create_network_event_v2(target_operation uuid,target_territory uuid,
  event_latitude double precision,event_longitude double precision,location_selection text,
  target_category text,target_description text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare actor uuid := auth.uid(); policy public.network_event_policies_v2%rowtype;
  territory public.network_map_territories_v2%rowtype; zone public.network_map_zones_v2%rowtype;
  chosen extensions.geometry; projected extensions.geometry; footprint extensions.geometry; public_point extensions.geometry;
  x bigint; y bigint; payload jsonb; old_event public.network_events_v2%rowtype; event public.network_events_v2%rowtype;
  nickname text; created timestamptz := statement_timestamp(); body text := btrim(target_description);
begin
  policy:=public.network_event_require_access_v2(target_territory,'publish');
  if target_operation is null or location_selection is distinct from 'EXPLICIT_EVENT_POINT'
    or (event_latitude between -85 and 85) is not true or (event_longitude between -180 and 180) is not true
    or target_category is null or target_category not in
      ('CIVIC_SAFETY','ROADS_TRAFFIC','LIGHTING','ENVIRONMENT_DECORUM','COMMUNITY_INFORMATION')
    or (char_length(body) between 10 and 500) is not true then
    raise exception 'Invalid event input' using errcode='22023'; end if;
  -- Same actor lock across all territories: quota and operation replay are serialized.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  select * into policy from public.network_event_policies_v2 where territory_id=target_territory for share;
  policy:=public.network_event_require_access_v2(target_territory,'publish');
  select * into strict territory from public.network_map_territories_v2 where id=target_territory for share;
  -- Projection must be a reviewed metre-based projected CRS; never infer ground accuracy.
  if not exists(select 1 from extensions.spatial_ref_sys s where s.srid=policy.metric_srid and s.proj4text like '%+units=m%') then
    raise exception 'Reviewed metric projection required' using errcode='22023'; end if;
  chosen:=extensions.st_setsrid(extensions.st_makepoint(event_longitude,event_latitude),4326);
  if not extensions.st_covers(territory.boundary,chosen) then raise exception 'Event outside territory' using errcode='22023'; end if;
  select * into zone from public.network_map_zones_v2 z where z.territory_id=target_territory and z.level_code='BASE'
    and extensions.st_covers(z.geometry,chosen) order by z.zone_code,z.id limit 1 for share;
  if not found then raise exception 'Event zone unavailable' using errcode='22023'; end if;
  projected:=extensions.st_transform(chosen,policy.metric_srid);
  x:=floor(extensions.st_x(projected)/policy.precision_meters)::bigint;
  y:=floor(extensions.st_y(projected)/policy.precision_meters)::bigint;
  footprint:=extensions.st_collectionextract(extensions.st_intersection(extensions.st_makeenvelope(x*policy.precision_meters::double precision,
      y*policy.precision_meters::double precision,(x+1)*policy.precision_meters::double precision,
      (y+1)*policy.precision_meters::double precision,policy.metric_srid),
    extensions.st_transform(extensions.st_intersection(zone.geometry,territory.boundary),policy.metric_srid)),3);
  if extensions.st_isempty(footprint) or extensions.st_area(footprint)<policy.min_cell_area_m2 then
    raise exception 'Insufficient publishable area' using errcode='22023'; end if;
  public_point:=extensions.st_transform(extensions.st_pointonsurface(footprint),4326);
  if not extensions.st_covers(zone.geometry,public_point) or not extensions.st_covers(territory.boundary,public_point) then
    raise exception 'Public point unavailable' using errcode='22023'; end if;
  -- Only the generalized cell payload is retained, not chosen/raw location or GPS accuracy.
  payload:=jsonb_build_object('territory',target_territory,'zone',zone.id,'policy',policy.policy_version,
    'cell',concat(policy.metric_srid,':',x,':',y),'category',target_category,'description',body);
  select * into old_event from public.network_events_v2 where author_user_id=actor and operation_id=target_operation;
  if found then
    if old_event.request_payload is distinct from payload then raise exception 'Operation payload conflict' using errcode='22023'; end if;
    return jsonb_build_object('publicId',old_event.public_id,'status',old_event.status,'publicationState',old_event.moderation_state,'replayed',true);
  end if;
  if exists(select 1 from public.network_events_v2 where author_user_id=actor and territory_id=target_territory
    and cell_key=payload->>'cell' and category_id=target_category and lower(description)=lower(body)
    and created_at>created-interval '10 minutes') then raise exception 'Duplicate publication' using errcode='23505'; end if;
  perform public.network_event_take_write_v2(policy.create_limit_hour,policy.create_limit_day);
  select btrim(p.nickname) into strict nickname from public.profiles p where p.id=actor;
  insert into public.network_events_v2(author_user_id,operation_id,request_payload,territory_id,zone_id,category_id,
    author_nickname_snapshot,description,public_position,cell_key,generalization_meters,location_policy_version,expires_at,purge_after)
  values(actor,target_operation,payload,target_territory,zone.id,target_category,nickname,body,public_point,payload->>'cell',
    policy.precision_meters,policy.policy_version,created+policy.event_ttl,created+policy.record_retention) returning * into event;
  return jsonb_build_object('publicId',event.public_id,'status',event.status,'publicationState',event.moderation_state,'replayed',false);
end; $$;

-- Internal predicate: only the selected event location is ever projected publicly.
create function public.network_event_is_public_v2(event public.network_events_v2,policy public.network_event_policies_v2)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select (policy.enabled and event.territory_id=policy.territory_id and event.moderation_state='APPROVED'
    and event.location_policy_version=policy.policy_version and event.generalization_meters=policy.precision_meters
    and event.expires_at>statement_timestamp() and event.purge_after>statement_timestamp()
    and public.network_user_is_eligible(event.author_user_id) is true
    and public.network_user_is_restricted(event.author_user_id,'read') is false
    and public.network_user_is_restricted(event.author_user_id,'publish') is false
    -- Recheck live reader/policy in the SAME final statement, not a saved earlier gate.
    and auth.uid() is not null and public.network_user_is_eligible(auth.uid()) is true
    and public.network_user_is_restricted(auth.uid(),'read') is false
    and exists(select 1 from public.network_event_policies_v2 p
      join public.network_preferences np on np.user_id=auth.uid() and np.accepted_at is not null
        and np.network_terms_version=p.required_terms_version
      where p.territory_id=event.territory_id and p.enabled and p.policy_version=event.location_policy_version
        and p.precision_meters=event.generalization_meters
        and exists(select 1 from public.network_preferences author_terms where author_terms.user_id=event.author_user_id
          and author_terms.accepted_at is not null and author_terms.network_terms_version=p.required_terms_version)
        and (p.access_mode='NETWORK' or exists(select 1 from public.network_event_members_v2 author_member
          where author_member.territory_id=p.territory_id and author_member.user_id=event.author_user_id
            and author_member.policy_version=p.policy_version and author_member.revoked_at is null
            and author_member.valid_until>statement_timestamp()))
        and (p.access_mode='NETWORK' or exists(select 1 from public.network_event_members_v2 m
          where m.territory_id=p.territory_id and m.user_id=auth.uid() and m.policy_version=p.policy_version
            and m.revoked_at is null and m.valid_until>statement_timestamp())))
    and exists(select 1 from public.network_map_zones_v2 z join public.network_map_territories_v2 t on t.id=z.territory_id
      where z.id=event.zone_id and z.territory_id=event.territory_id and z.level_code='BASE'
        and extensions.st_covers(z.geometry,event.public_position) and extensions.st_covers(t.boundary,event.public_position))) is true;
$$;
create function public.network_event_marker_json_v2(event public.network_events_v2)
returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('schemaVersion',2,'publicId',event.public_id,'territoryId',event.territory_id,'zoneId',event.zone_id,
    'kind','OPERATIONAL_EVENT','categoryId',event.category_id,'status',event.status,
    'publicPosition',jsonb_build_object('latitude',extensions.st_y(event.public_position),'longitude',extensions.st_x(event.public_position),
      'generalizationMeters',event.generalization_meters,'representation','GENERALIZED_EVENT_POINT'),
    'locationPolicyVersion',event.location_policy_version,'revision',event.revision,
    'validUntil',to_char(least(event.expires_at,event.purge_after) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt',to_char(event.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(event.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'resolvedAt',case when event.resolved_at is null then null else to_char(event.resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
$$;

create function public.list_network_event_markers_v2(target_territory uuid,center_latitude double precision,
  center_longitude double precision,radius_meters integer,target_status text default 'ACTIVE',target_category text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare policy public.network_event_policies_v2%rowtype; result jsonb;
begin
  policy:=public.network_event_require_access_v2(target_territory,'read');
  if (center_latitude between -85 and 85) is not true or (center_longitude between -180 and 180) is not true
    or radius_meters is null or radius_meters not in (1000,2500,5000,10000) or target_status is null or target_status not in ('ACTIVE','RESOLVED')
    or (target_category is not null and target_category not in
      ('CIVIC_SAFETY','ROADS_TRAFFIC','LIGHTING','ENVIRONMENT_DECORUM','COMMUNITY_INFORMATION')) then
    raise exception 'Invalid map query' using errcode='22023'; end if;
  perform public.network_event_take_read_v2(policy.read_limit_minute);
  select coalesce(jsonb_agg(public.network_event_marker_json_v2(e::public.network_events_v2) order by e.created_at desc,e.public_id),'[]'::jsonb) into result
    from (select n.* from public.network_events_v2 n where n.territory_id=target_territory and n.status=target_status
      and (target_category is null or n.category_id=target_category) and public.network_event_is_public_v2(n,policy)
      and extensions.st_dwithin(n.public_position::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(center_longitude,center_latitude),4326)::extensions.geography,radius_meters)
      order by n.created_at desc,n.public_id limit 2001) e;
  if jsonb_array_length(result)>2000 then raise exception 'Narrow query; complete snapshot exceeds budget' using errcode='54000'; end if;
  return result;
end; $$;
create function public.get_network_event_detail_v2(target_public_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare event public.network_events_v2%rowtype; policy public.network_event_policies_v2%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception 'Event detail unavailable' using errcode='42501'; end if;
  select * into event from public.network_events_v2 where public_id=target_public_id;
  if not found then raise exception 'Event detail unavailable' using errcode='42501'; end if;
  policy:=public.network_event_require_access_v2(event.territory_id,'read');
  perform public.network_event_take_read_v2(policy.read_limit_minute);
  select jsonb_build_object('marker',public.network_event_marker_json_v2(e),'description',e.description,
    'authorNickname',e.author_nickname_snapshot,'confirmations',jsonb_build_object('confirmedCount',0,'noLongerPresentCount',0,'myConfirmation',null),'updates','[]'::jsonb)
    into result from public.network_events_v2 e where e.public_id=target_public_id and public.network_event_is_public_v2(e,policy);
  if result is null then raise exception 'Event detail unavailable' using errcode='42501'; end if;
  return result;
end; $$;

-- Discover actual authorized territories without a client-side municipal/account list.
create function public.list_network_event_territories_v2(center_latitude double precision,center_longitude double precision,
  radius_meters integer default 10000,page_size integer default 50,after_code text default null,after_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null or public.network_user_is_eligible(auth.uid()) is distinct from true
    or public.network_user_is_restricted(auth.uid(),'read') is distinct from false then
    raise exception 'Territory access unavailable' using errcode='42501'; end if;
  if (center_latitude between -85 and 85) is not true or (center_longitude between -180 and 180) is not true
    or radius_meters is null or radius_meters not in (1000,2500,5000,10000)
    or page_size is null or page_size not between 1 and 100 or ((after_code is null) <> (after_id is null)) then
    raise exception 'Invalid territory query' using errcode='22023'; end if;
  perform public.network_event_take_read_v2(120);
  return (select coalesce(jsonb_agg(jsonb_build_object('territoryId',t.id,'code',t.code,'label',t.label,
    'publicCenter',jsonb_build_object('latitude',extensions.st_y(extensions.st_pointonsurface(t.boundary)),
      'longitude',extensions.st_x(extensions.st_pointonsurface(t.boundary))),
    'locationPolicyVersion',t.policy_version,'geometrySource',t.geometry_source,'geometryLicense',t.geometry_license,
    'geometryVersion',t.geometry_version) order by t.code,t.id),'[]'::jsonb)
    from (select n.id,n.code,n.label,n.boundary,n.geometry_source,n.geometry_license,n.geometry_version,p.policy_version
      from public.network_map_territories_v2 n join public.network_event_policies_v2 p on p.territory_id=n.id
      join public.network_preferences np on np.user_id=auth.uid() and np.accepted_at is not null
        and np.network_terms_version=p.required_terms_version
      where p.enabled and (p.access_mode='NETWORK' or exists(select 1 from public.network_event_members_v2 m
        where m.territory_id=p.territory_id and m.user_id=auth.uid() and m.policy_version=p.policy_version
          and m.revoked_at is null and m.valid_until>statement_timestamp()))
      and extensions.st_dwithin(n.boundary::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(center_longitude,center_latitude),4326)::extensions.geography,radius_meters)
      and (after_code is null or (n.code,n.id)>(after_code,after_id)) order by n.code,n.id limit page_size) t);
end; $$;

-- Private moderation queue; no service key or moderation authority belongs in the app.
create function public.list_network_event_review_queue_v2(target_territory uuid,page_size integer default 50,
  before_created timestamptz default null,before_public_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if target_territory is null or page_size is null or page_size not between 1 and 100
    or ((before_created is null) <> (before_public_id is null)) then raise exception 'Invalid review query' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('marker',public.network_event_marker_json_v2(e::public.network_events_v2),
    'description',e.description,'authorNickname',e.author_nickname_snapshot,'publicationState',e.moderation_state,
    'cursor',jsonb_build_object('createdAt',e.created_at,'publicId',e.public_id))
    order by e.created_at desc,e.public_id desc),'[]'::jsonb) from
    (select n.* from public.network_events_v2 n where n.territory_id=target_territory and n.moderation_state='PENDING'
      and n.expires_at>statement_timestamp() and n.purge_after>statement_timestamp()
      and (before_created is null or (n.created_at,n.public_id)<(before_created,before_public_id))
      order by n.created_at desc,n.public_id desc limit page_size) e);
end; $$;

-- Service-only moderation. It never extends expiry or reactivates withdrawn events.
create function public.review_network_event_v2(target_public_id uuid,expected_revision integer,decision text,review_reference text)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare event public.network_events_v2%rowtype; policy public.network_event_policies_v2%rowtype;
begin
  if expected_revision is null or expected_revision<1 or decision is null or decision not in ('APPROVED','REJECTED','WITHDRAWN') or nullif(btrim(review_reference),'') is null then
    raise exception 'Invalid review' using errcode='22023'; end if;
  select p.* into policy from public.network_event_policies_v2 p join public.network_events_v2 e on e.territory_id=p.territory_id
    where e.public_id=target_public_id for share of p;
  select * into event from public.network_events_v2 where public_id=target_public_id for update;
  if not found then raise exception 'Event unavailable' using errcode='22023'; end if;
  if event.revision<>expected_revision then raise exception 'Review revision changed' using errcode='40001'; end if;
  if decision='APPROVED' and (not policy.enabled or event.location_policy_version is distinct from policy.policy_version
    or event.expires_at<=statement_timestamp() or event.purge_after<=statement_timestamp() or event.moderation_state='WITHDRAWN') then
    raise exception 'Approval unavailable' using errcode='22023'; end if;
  update public.network_events_v2 set moderation_state=decision,review_ref=btrim(review_reference),reviewed_at=clock_timestamp()
    where public_id=target_public_id;
end; $$;
create function public.finish_my_network_event_v2(target_public_id uuid,finish_kind text)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare actor uuid := auth.uid(); event public.network_events_v2%rowtype; policy public.network_event_policies_v2%rowtype;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if finish_kind is null or finish_kind not in ('RESOLVED','WITHDRAWN') then raise exception 'Invalid finish' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  select p.* into policy from public.network_event_policies_v2 p join public.network_events_v2 e on e.territory_id=p.territory_id
    where e.public_id=target_public_id and e.author_user_id=actor for share of p;
  select * into event from public.network_events_v2 where public_id=target_public_id and author_user_id=actor for update;
  if not found then raise exception 'Event unavailable' using errcode='42501'; end if;
  -- Owner may resolve/withdraw even if reading/publishing has been restricted or gate disabled.
  if finish_kind='WITHDRAWN' then
    if event.moderation_state<>'WITHDRAWN' then update public.network_events_v2 set moderation_state='WITHDRAWN' where public_id=target_public_id; end if;
  elsif event.status='ACTIVE' then
    update public.network_events_v2 set status='RESOLVED',resolved_at=greatest(event.updated_at,clock_timestamp()),
      expires_at=least(expires_at,clock_timestamp()+policy.resolved_ttl) where public_id=target_public_id;
  end if;
end; $$;

revoke all on function public.network_event_require_access_v2(uuid,text),public.network_event_take_read_v2(integer),
  public.network_event_take_write_v2(integer,integer),
  public.network_event_guard_update_v2(),public.create_network_event_v2(uuid,uuid,double precision,double precision,text,text,text),
  public.network_event_is_public_v2(public.network_events_v2,public.network_event_policies_v2),public.network_event_marker_json_v2(public.network_events_v2),
  public.list_network_event_markers_v2(uuid,double precision,double precision,integer,text,text),public.get_network_event_detail_v2(uuid),
  public.list_network_event_territories_v2(double precision,double precision,integer,integer,text,uuid),
  public.list_network_event_review_queue_v2(uuid,integer,timestamptz,uuid),
  public.review_network_event_v2(uuid,integer,text,text),public.finish_my_network_event_v2(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_network_event_v2(uuid,uuid,double precision,double precision,text,text,text),
  public.list_network_event_markers_v2(uuid,double precision,double precision,integer,text,text),public.get_network_event_detail_v2(uuid),
  public.list_network_event_territories_v2(double precision,double precision,integer,integer,text,uuid),
  public.finish_my_network_event_v2(uuid,text) to authenticated;
grant execute on function public.review_network_event_v2(uuid,integer,text,text),
  public.list_network_event_review_queue_v2(uuid,integer,timestamptz,uuid) to service_role;
-- END EXACT MIGRATION BODY 20261107120000_network_event_markers_v2.sql
-- BEGIN EXACT MIGRATION BODY 20261108120000_network_social_v2.sql SHA256 1d21e5b32dc39287a9ac16562ac476f29850a610f794a6b5f0a7c1a4d7f464f0

do $$ begin
  if current_user<>'postgres' or to_regclass('public.network_events_v2') is null then
    raise exception 'Controlled postgres role and event V2 schema required'; end if;
  if has_schema_privilege('anon','public','CREATE') is distinct from false
    or has_schema_privilege('authenticated','public','CREATE') is distinct from false
    or has_schema_privilege('anon','extensions','CREATE') is distinct from false
    or has_schema_privilege('authenticated','extensions','CREATE') is distinct from false then
    raise exception 'Untrusted schema CREATE requires separate review'; end if;
end $$;

-- No production precision, moderation SLA or retention is selected here.
create table public.network_social_policies_v2 (
  territory_id uuid primary key references public.network_event_policies_v2(territory_id),
  enabled boolean not null default false,
  policy_version text, approval_ref text, moderation_ref text, retention_ref text,
  retain_for interval check (retain_for>interval '0'),
  writes_hour integer check (writes_hour between 1 and 100),
  writes_day integer check (writes_day between 1 and 1000),
  check (not enabled or (nullif(btrim(policy_version),'') is not null
    and nullif(btrim(approval_ref),'') is not null and nullif(btrim(moderation_ref),'') is not null
    and nullif(btrim(retention_ref),'') is not null and retain_for is not null
    and writes_hour is not null and writes_day>=writes_hour) is true)
);
create table public.network_social_votes_v2 (
  event_id uuid not null references public.network_events_v2(public_id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('CONFIRMED','NO_LONGER_PRESENT')),
  policy_version text not null, valid_until timestamptz not null,
  primary key(event_id,user_id)
);
create table public.network_social_follows_v2 (
  event_id uuid not null references public.network_events_v2(public_id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_version text not null, valid_until timestamptz not null,
  primary key(event_id,user_id)
);
create table public.network_social_comments_v2 (
  public_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.network_events_v2(public_id),
  author_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check(char_length(btrim(nickname)) between 2 and 40),
  body text not null check(char_length(btrim(body)) between 2 and 1000),
  policy_version text not null,
  moderation_state text not null default 'PENDING' check(moderation_state in ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  revision integer not null default 1 check(revision>0), review_ref text,
  created_at timestamptz not null default clock_timestamp(), valid_until timestamptz not null,
  check (moderation_state<>'APPROVED' or nullif(btrim(review_ref),'') is not null)
);
-- Immutable receipts, not a second copy of comment bodies. Replay never reapplies an older action.
create table public.network_social_operations_v2 (
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null, event_id uuid not null references public.network_events_v2(public_id),
  action text not null check(action in ('VOTE','FOLLOW','COMMENT')),
  value text, comment_id uuid references public.network_social_comments_v2(public_id),
  created_at timestamptz not null default clock_timestamp(), primary key(user_id,operation_id)
);
create index network_social_operations_actor_time_idx on public.network_social_operations_v2(user_id,created_at desc);
create index network_social_comments_page_idx on public.network_social_comments_v2(event_id,created_at desc,public_id desc);
create index network_social_comments_queue_idx on public.network_social_comments_v2(created_at,public_id) where moderation_state='PENDING';
create index network_social_comments_activity_idx on public.network_social_comments_v2(created_at desc,public_id desc) where moderation_state='APPROVED';
create index network_social_follows_owner_idx on public.network_social_follows_v2(user_id,event_id);

alter table public.network_social_policies_v2 enable row level security;
alter table public.network_social_votes_v2 enable row level security;
alter table public.network_social_follows_v2 enable row level security;
alter table public.network_social_comments_v2 enable row level security;
alter table public.network_social_operations_v2 enable row level security;
revoke all on public.network_social_policies_v2,public.network_social_votes_v2,public.network_social_follows_v2,
  public.network_social_comments_v2,public.network_social_operations_v2 from public,anon,authenticated,service_role;
grant select,insert,update on public.network_social_policies_v2 to service_role;

create function public.network_social_actor_allowed_v2(actor uuid,territory uuid)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select (actor is not null and public.network_user_is_eligible(actor) is true
    and public.network_user_is_restricted(actor,'read') is false
    and public.network_user_is_restricted(actor,'publish') is false
    and exists(select 1 from public.network_event_policies_v2 p
      join public.network_preferences n on n.user_id=actor and n.accepted_at is not null
        and n.network_terms_version=p.required_terms_version
      where p.territory_id=territory and p.enabled and (p.access_mode='NETWORK' or exists(
        select 1 from public.network_event_members_v2 m where m.user_id=actor and m.territory_id=territory
          and m.policy_version=p.policy_version and m.revoked_at is null and m.valid_until>statement_timestamp())))) is true;
$$;
create function public.network_social_require_v2(target_event uuid)
returns public.network_events_v2 language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare e public.network_events_v2%rowtype; p public.network_event_policies_v2%rowtype;
begin
  if auth.uid() is null then raise exception 'Social unavailable' using errcode='42501'; end if;
  select * into e from public.network_events_v2 where public_id=target_event;
  if not found then raise exception 'Social unavailable' using errcode='42501'; end if;
  p:=public.network_event_require_access_v2(e.territory_id,'read');
  if public.network_event_is_public_v2(e,p) is distinct from true or not exists(
    select 1 from public.network_social_policies_v2 s where s.territory_id=e.territory_id and s.enabled) then
    raise exception 'Social unavailable' using errcode='42501'; end if;
  return e;
end $$;

-- Every row is rechecked for current reader, parent, policy and contributor access.
create function public.get_network_social_v2(target_event uuid,before_created timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare evt public.network_events_v2%rowtype; pol public.network_event_policies_v2%rowtype; result jsonb;
begin
  evt:=public.network_social_require_v2(target_event);
  if (before_created is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  pol:=public.network_event_require_access_v2(evt.territory_id,'read');
  perform public.network_event_take_read_v2(pol.read_limit_minute);
  select jsonb_build_object('eventId',e.public_id,'validUntil',to_char(least(e.expires_at,e.purge_after,
    (select min(x.valid_until) from (
      select v.valid_until from public.network_social_votes_v2 v where v.event_id=e.public_id and v.policy_version=s.policy_version
        and v.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(v.user_id,e.territory_id)
      union all select f.valid_until from public.network_social_follows_v2 f where f.event_id=e.public_id and f.user_id=auth.uid()
        and f.policy_version=s.policy_version and f.valid_until>statement_timestamp()
      union all select c.valid_until from public.network_social_comments_v2 c where c.event_id=e.public_id and c.policy_version=s.policy_version
        and c.moderation_state='APPROVED' and c.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(c.author_id,e.territory_id)
    ) x)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmedCount',(select count(*) from public.network_social_votes_v2 v where v.event_id=e.public_id and v.kind='CONFIRMED'
      and v.policy_version=s.policy_version and v.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(v.user_id,e.territory_id)),
    'noLongerPresentCount',(select count(*) from public.network_social_votes_v2 v where v.event_id=e.public_id and v.kind='NO_LONGER_PRESENT'
      and v.policy_version=s.policy_version and v.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(v.user_id,e.territory_id)),
    'myVote',(select v.kind from public.network_social_votes_v2 v where v.event_id=e.public_id and v.user_id=auth.uid()
      and v.policy_version=s.policy_version and v.valid_until>statement_timestamp()),
    'following',exists(select 1 from public.network_social_follows_v2 f where f.event_id=e.public_id and f.user_id=auth.uid()
      and f.policy_version=s.policy_version and f.valid_until>statement_timestamp()),
    'comments',coalesce((select jsonb_agg(jsonb_build_object('publicId',c.public_id,'nickname',c.nickname,'body',c.body,
      'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'canWithdraw',c.author_id=auth.uid()) order by c.created_at desc,c.public_id desc)
      from (select c.* from public.network_social_comments_v2 c where c.event_id=e.public_id and c.moderation_state='APPROVED'
        and c.policy_version=s.policy_version and c.valid_until>statement_timestamp()
        and public.network_social_actor_allowed_v2(c.author_id,e.territory_id)
        and (before_created is null or (c.created_at,c.public_id)<(before_created,before_id))
        order by c.created_at desc,c.public_id desc limit 50) c),'[]'::jsonb)) into result
    from public.network_events_v2 e join public.network_event_policies_v2 p on p.territory_id=e.territory_id
    join public.network_social_policies_v2 s on s.territory_id=e.territory_id and s.enabled
    where e.public_id=target_event and public.network_event_is_public_v2(e,p);
  if result is null then raise exception 'Social unavailable' using errcode='42501'; end if;
  return result;
end $$;

create function public.mutate_network_social_v2(target_event uuid,target_operation uuid,action_kind text,action_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare actor uuid:=auth.uid(); e public.network_events_v2%rowtype; s public.network_social_policies_v2%rowtype;
  op public.network_social_operations_v2%rowtype; cid uuid; nick text; cutoff timestamptz:=clock_timestamp();
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if target_operation is null or action_kind is null or action_kind not in ('VOTE','FOLLOW','COMMENT')
    or (action_kind='VOTE' and (action_value is null or action_value not in ('CONFIRMED','NO_LONGER_PRESENT','NONE')))
    or (action_kind='FOLLOW' and (action_value is null or action_value not in ('ON','OFF')))
    or (action_kind='COMMENT' and (action_value is null or char_length(btrim(action_value)) not between 2 and 1000)) then
    raise exception 'Invalid social action' using errcode='22023'; end if;
  if action_kind='COMMENT' then action_value:=btrim(action_value); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  e:=public.network_social_require_v2(target_event);
  select * into s from public.network_social_policies_v2 where territory_id=e.territory_id and enabled for share;
  perform 1 from public.network_event_policies_v2 where territory_id=e.territory_id for share;
  select * into e from public.network_events_v2 where public_id=target_event for update;
  -- Recheck after each lock wait; never trust the earlier composite event.
  if s.territory_id is null or public.network_social_actor_allowed_v2(actor,e.territory_id) is distinct from true then
    raise exception 'Social unavailable' using errcode='42501'; end if;
  e:=public.network_social_require_v2(target_event);
  select * into op from public.network_social_operations_v2 where user_id=actor and operation_id=target_operation;
  if found then
    if op.event_id is distinct from target_event or op.action is distinct from action_kind
      or (action_kind<>'COMMENT' and op.value is distinct from action_value)
      or (action_kind='COMMENT' and not exists(select 1 from public.network_social_comments_v2 c
        where c.public_id=op.comment_id and c.author_id=actor and c.body=action_value)) then
      raise exception 'Operation conflict' using errcode='22023'; end if;
    return jsonb_build_object('operationId',target_operation,'eventId',target_event,'action',action_kind,
      'commentId',op.comment_id,'replayed',true);
  end if;
  cutoff:=clock_timestamp();
  if (e.status<>'ACTIVE' and not (action_kind='FOLLOW' and action_value='OFF') and not (action_kind='VOTE' and action_value='NONE'))
    or e.expires_at<=cutoff or e.purge_after<=cutoff then
    raise exception 'Event no longer active' using errcode='42501'; end if;
  if (select count(*) from public.network_social_operations_v2 where user_id=actor and created_at>cutoff-interval '1 hour')>=s.writes_hour
    or (select count(*) from public.network_social_operations_v2 where user_id=actor and created_at>cutoff-interval '24 hours')>=s.writes_day then
    raise exception 'Social rate limit' using errcode='54000'; end if;
  if action_kind='VOTE' then
    if action_value='NONE' then delete from public.network_social_votes_v2 where event_id=target_event and user_id=actor;
    else insert into public.network_social_votes_v2(event_id,user_id,kind,policy_version,valid_until)
      values(target_event,actor,action_value,s.policy_version,least(e.purge_after,cutoff+s.retain_for))
      on conflict(event_id,user_id) do update set kind=excluded.kind,policy_version=excluded.policy_version,valid_until=excluded.valid_until;
    end if;
  elsif action_kind='FOLLOW' then
    if action_value='OFF' then delete from public.network_social_follows_v2 where event_id=target_event and user_id=actor;
    else insert into public.network_social_follows_v2(event_id,user_id,policy_version,valid_until)
      values(target_event,actor,s.policy_version,least(e.purge_after,cutoff+s.retain_for))
      on conflict(event_id,user_id) do update set policy_version=excluded.policy_version,valid_until=excluded.valid_until;
    end if;
  else
    if exists(select 1 from public.network_social_comments_v2 where author_id=actor and event_id=target_event
      and body=action_value and created_at>cutoff-interval '10 minutes') then
      raise exception 'Duplicate comment' using errcode='23505'; end if;
    select nickname into nick from public.profiles where id=actor;
    insert into public.network_social_comments_v2(event_id,author_id,nickname,body,policy_version,valid_until)
      values(target_event,actor,nick,action_value,s.policy_version,least(e.purge_after,cutoff+s.retain_for)) returning public_id into cid;
  end if;
  insert into public.network_social_operations_v2(user_id,operation_id,event_id,action,value,comment_id)
    values(actor,target_operation,target_event,action_kind,case when action_kind='COMMENT' then null else action_value end,cid);
  return jsonb_build_object('operationId',target_operation,'eventId',target_event,'action',action_kind,'commentId',cid,'replayed',false);
end $$;

-- Privacy cleanup remains possible after gates/access loss; no read of hidden parent data.
create function public.get_my_network_social_operation_v2(target_operation uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.network_event_take_read_v2(120);
  return (select jsonb_build_object('operationId',o.operation_id,'eventId',o.event_id,'action',o.action,
    'commentId',o.comment_id,'replayed',true) from public.network_social_operations_v2 o
    where o.user_id=auth.uid() and o.operation_id=target_operation);
  -- NULL is not proof of failure: the original request may still be pending.
end $$;

create function public.remove_my_network_social_v2(target_event uuid,target_comment uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7011));
  if target_comment is null then
    delete from public.network_social_follows_v2 where event_id=target_event and user_id=auth.uid();
    delete from public.network_social_votes_v2 where event_id=target_event and user_id=auth.uid();
  else update public.network_social_comments_v2 set moderation_state='WITHDRAWN',revision=revision+1,review_ref=null
    where public_id=target_comment and event_id=target_event and author_id=auth.uid() and moderation_state<>'WITHDRAWN';
  end if;
end $$;

create function public.review_network_comment_v2(target_comment uuid,expected_revision integer,decision text,review_reference text)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare c public.network_social_comments_v2%rowtype; evt public.network_events_v2%rowtype;
begin
  if decision is null or decision not in ('APPROVED','REJECTED','WITHDRAWN') or nullif(btrim(review_reference),'') is null then
    raise exception 'Invalid review' using errcode='22023'; end if;
  select * into c from public.network_social_comments_v2 where public_id=target_comment;
  if not found then raise exception 'Comment unavailable' using errcode='42501'; end if;
  perform 1 from public.network_social_policies_v2 s join public.network_events_v2 e on e.territory_id=s.territory_id
    where e.public_id=c.event_id for share of s;
  perform 1 from public.network_event_policies_v2 p join public.network_events_v2 e on e.territory_id=p.territory_id
    where e.public_id=c.event_id for share of p;
  select * into evt from public.network_events_v2 where public_id=c.event_id for update;
  select * into c from public.network_social_comments_v2 where public_id=target_comment for update;
  if c.revision is distinct from expected_revision then raise exception 'Stale review' using errcode='40001'; end if;
  if c.moderation_state='WITHDRAWN' then raise exception 'Terminal comment' using errcode='22023'; end if;
  if decision='APPROVED' and (c.valid_until<=clock_timestamp() or evt.expires_at<=clock_timestamp() or evt.purge_after<=clock_timestamp()
    or evt.moderation_state<>'APPROVED' or not exists(select 1 from public.network_social_policies_v2 s
      join public.network_event_policies_v2 p on p.territory_id=s.territory_id
      where s.territory_id=evt.territory_id and s.enabled and p.enabled and s.policy_version=c.policy_version
        and p.policy_version=evt.location_policy_version)
    or public.network_social_actor_allowed_v2(c.author_id,evt.territory_id) is distinct from true) then
    raise exception 'Comment not publishable' using errcode='42501'; end if;
  update public.network_social_comments_v2 set moderation_state=decision,review_ref=btrim(review_reference),revision=revision+1
    where public_id=target_comment;
end $$;

create function public.list_network_comment_review_v2(before_created timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if (before_created is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('publicId',c.public_id,'eventId',c.event_id,'body',c.body,'nickname',c.nickname,
    'revision',c.revision,'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    order by c.created_at desc,c.public_id desc),'[]'::jsonb) from (
      select c.* from public.network_social_comments_v2 c join public.network_events_v2 e on e.public_id=c.event_id
      join public.network_social_policies_v2 s on s.territory_id=e.territory_id and s.enabled
      where c.moderation_state='PENDING' and c.valid_until>statement_timestamp() and e.expires_at>statement_timestamp()
        and c.policy_version=s.policy_version and (before_created is null or (c.created_at,c.public_id)<(before_created,before_id))
      order by c.created_at desc,c.public_id desc limit 50) c);
end $$;

-- Activity is derived from currently readable comments, not a permanent copy of withdrawn content.
create function public.list_network_social_activity_v2(target_territory uuid,followed_only boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pol public.network_event_policies_v2%rowtype;
begin
  pol:=public.network_event_require_access_v2(target_territory,'read');
  if followed_only is null then raise exception 'Invalid activity filter' using errcode='22023'; end if;
  perform public.network_event_take_read_v2(pol.read_limit_minute);
  return (select coalesce(jsonb_agg(jsonb_build_object('publicId',a.public_id,'eventId',a.event_id,
    'kind','COMMENT_APPROVED','createdAt',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(a.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    order by a.created_at desc,a.public_id desc),'[]'::jsonb) from (
      select c.public_id,c.event_id,c.created_at,least(c.valid_until,e.expires_at,e.purge_after) as valid_until from public.network_social_comments_v2 c
      join public.network_events_v2 e on e.public_id=c.event_id
      join public.network_event_policies_v2 p on p.territory_id=e.territory_id
      join public.network_social_policies_v2 s on s.territory_id=e.territory_id and s.enabled
      where e.territory_id=target_territory and public.network_event_is_public_v2(e,p)
        and c.moderation_state='APPROVED' and c.policy_version=s.policy_version and c.valid_until>statement_timestamp()
        and public.network_social_actor_allowed_v2(c.author_id,e.territory_id)
        and (not followed_only or exists(select 1 from public.network_social_follows_v2 f where f.user_id=auth.uid()
          and f.event_id=e.public_id and f.policy_version=s.policy_version and f.valid_until>statement_timestamp()))
      order by c.created_at desc,c.public_id desc limit 50) a);
end $$;

revoke all on function public.network_social_actor_allowed_v2(uuid,uuid),public.network_social_require_v2(uuid),
  public.get_network_social_v2(uuid,timestamptz,uuid),public.mutate_network_social_v2(uuid,uuid,text,text),
  public.get_my_network_social_operation_v2(uuid),
  public.remove_my_network_social_v2(uuid,uuid),public.review_network_comment_v2(uuid,integer,text,text),
  public.list_network_comment_review_v2(timestamptz,uuid),public.list_network_social_activity_v2(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_network_social_v2(uuid,timestamptz,uuid),public.mutate_network_social_v2(uuid,uuid,text,text),
  public.get_my_network_social_operation_v2(uuid),
  public.remove_my_network_social_v2(uuid,uuid),public.list_network_social_activity_v2(uuid,boolean) to authenticated;
grant execute on function public.review_network_comment_v2(uuid,integer,text,text),public.list_network_comment_review_v2(timestamptz,uuid) to service_role;
-- END EXACT MIGRATION BODY 20261108120000_network_social_v2.sql
do $phase17c_recheck$ declare approved record; begin
  if 'PENDING_EVIDENCE' is distinct from 'APPROVED'
    or null::text is null or 'NOT_VERIFIED' is distinct from 'REVIEWED_FOR_TARGET'
    or current_setting('safemelink.phase17c_health_review',true) is distinct from 'SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER'
    or current_setting('safemelink.phase17c_execution_review',true) is distinct from 'AUTHORIZED_DDL_ONLY_QUIET_WINDOW'
    or current_setting('session_replication_role') is distinct from 'origin' then
    raise exception 'STOP: exact trigger approval, service health and execution window not confirmed'; end if;
  if (select count(*) from pg_event_trigger)<>6 then raise exception 'STOP: unexpected event trigger inventory'; end if;
  for approved in select * from (values ('issue_graphql_placeholder','sql_drop','["DROP EXTENSION"]'::jsonb,'set_graphql_placeholder','19e858a99cf5698c4730343fb43cdad4ab2f0717a8ded8a691a0e2786b859708',null::text,null::text,null::text),
('issue_pg_cron_access','ddl_command_end','["CREATE EXTENSION"]'::jsonb,'grant_pg_cron_access','00db212b76cecd4b0794b2f20c414ab4988d675959747cd12d3eb4c6d6736f38',null::text,null::text,null::text),
('issue_pg_graphql_access','ddl_command_end','["CREATE EXTENSION"]'::jsonb,'grant_pg_graphql_access','fb5a80e6d30734718db960270a5f0eac0d655e238e8128ba56803b74a052bc1e',null::text,null::text,null::text),
('issue_pg_net_access','ddl_command_end','["CREATE EXTENSION"]'::jsonb,'grant_pg_net_access','55abda380efd46b37b26d3c6e4f3b514e28b7c7c1df44f5ae0315ece4052370d',null::text,null::text,null::text),
('pgrst_ddl_watch','ddl_command_end','null'::jsonb,'pgrst_ddl_watch','de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0',null::text,null::text,null::text),
('pgrst_drop_watch','sql_drop','null'::jsonb,'pgrst_drop_watch','791b41f0632fc86e0fc86a303ec0fd710c4e2ecf947a23422dae2b7a2c122f1d',null::text,null::text,null::text)) v(name,event,tags,function_name,source_hash,definition_hash,function_metadata_hash,trigger_metadata_hash) loop
    if approved.definition_hash is null or approved.function_metadata_hash is null or approved.trigger_metadata_hash is null
      or not exists(select 1 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
        join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where e.evtname=approved.name and e.evtevent=approved.event and e.evtenabled='O'
          and coalesce(to_jsonb(e.evttags),'null'::jsonb)=approved.tags
          and n.nspname='extensions' and p.proname=approved.function_name and p.pronargs=0
          and p.prokind='f' and p.prorettype='pg_catalog.event_trigger'::regtype
          and encode(sha256(convert_to((p.prosrc)::text,'UTF8')),'hex')=approved.source_hash and encode(sha256(convert_to((pg_get_functiondef(p.oid))::text,'UTF8')),'hex')=approved.definition_hash
          and encode(sha256(convert_to((jsonb_build_object('schema',n.nspname,'name',p.proname,
 'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile::text,'strict',p.proisstrict,'leakproof',p.proleakproof,
 'parallel',p.proparallel::text,'returnsSet',p.proretset,'acl',p.proacl::text,
 'configHash',encode(sha256(convert_to((coalesce(p.proconfig::text,'<NULL>'))::text,'UTF8')),'hex'),
 'searchPath',(select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1)))::text,'UTF8')),'hex')=approved.function_metadata_hash and encode(sha256(convert_to((jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled::text,
 'tags',to_jsonb(e.evttags),'owner',pg_get_userbyid(e.evtowner),
 'functionSchema',n.nspname,'functionName',p.proname,'arguments',pg_get_function_identity_arguments(p.oid)))::text,'UTF8')),'hex')=approved.trigger_metadata_hash) then
      raise exception 'STOP: unapproved event trigger definition or metadata: %',approved.name; end if;
  end loop;
 end $phase17c_recheck$;
do $phase17_assertions$
declare r record; oid_now oid; h text;
begin
  for r in select * from (values ('network_map_territories_v2',18),('network_map_zones_v2',6),('network_map_members_v2',5),('network_map_sources_v2',5),('network_map_publications_v2',12),('network_map_publication_sources_v2',2),('network_history_entries_v2',13),('network_event_policies_v2',17),('network_event_members_v2',5),('network_events_v2',23),('network_event_read_buckets_v2',3),('network_event_write_buckets_v2',5),('network_social_policies_v2',9),('network_social_votes_v2',5),('network_social_follows_v2',4),('network_social_comments_v2',11),('network_social_operations_v2',7)) v(name,column_count) loop
    select c.oid into oid_now from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=r.name and c.relkind='r' and c.relrowsecurity
        and not c.relforcerowsecurity and pg_get_userbyid(c.relowner)='postgres';
    if oid_now is null then raise exception 'Table/RLS/owner mismatch: %',r.name; end if;
    if exists(select 1 from pg_policy where polrelid=oid_now) then raise exception 'Unexpected client policy: %',r.name; end if;
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      left join pg_roles gr on gr.oid=a.grantee where c.oid=oid_now and a.grantee<>c.relowner
      and (a.is_grantable or (gr.rolname='service_role' and a.privilege_type=any(case r.name
        when 'network_map_territories_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_map_zones_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_map_members_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_map_sources_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_map_publications_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_map_publication_sources_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_history_entries_v2' then array['SELECT','INSERT','UPDATE','DELETE']
when 'network_event_policies_v2' then array['SELECT','INSERT','UPDATE']
when 'network_event_members_v2' then array['SELECT','INSERT','UPDATE']
when 'network_social_policies_v2' then array['SELECT','INSERT','UPDATE']
        else array[]::text[] end)) is not true)) then
      raise exception 'Unexpected table grantee/grant option: %',r.name; end if;
    if (select count(*) from pg_attribute where attrelid=oid_now and attnum>0 and not attisdropped)<>r.column_count then
      raise exception 'Column count mismatch: %',r.name; end if;
  end loop;
  for r in select * from (values ('network_map_territories_v2','id','uuid',true),
('network_map_territories_v2','code','text',true),
('network_map_territories_v2','label','text',true),
('network_map_territories_v2','boundary','extensions.geometry(multipolygon,4326)',true),
('network_map_territories_v2','geometry_source','text',true),
('network_map_territories_v2','geometry_license','text',true),
('network_map_territories_v2','geometry_version','text',true),
('network_map_territories_v2','enabled','boolean',true),
('network_map_territories_v2','policy_version','text',false),
('network_map_territories_v2','controller_approval_ref','text',false),
('network_map_territories_v2','retention_decision_ref','text',false),
('network_map_territories_v2','privacy_review_ref','text',false),
('network_map_territories_v2','min_reports','integer',false),
('network_map_territories_v2','min_contributors','integer',false),
('network_map_territories_v2','low_max','integer',false),
('network_map_territories_v2','medium_max','integer',false),
('network_map_territories_v2','snapshot_ttl','interval',false),
('network_map_territories_v2','period_kind','text',false),
('network_map_zones_v2','id','uuid',true),
('network_map_zones_v2','territory_id','uuid',true),
('network_map_zones_v2','level_code','text',true),
('network_map_zones_v2','zone_code','text',true),
('network_map_zones_v2','label','text',true),
('network_map_zones_v2','geometry','extensions.geometry(multipolygon,4326)',true),
('network_map_members_v2','territory_id','uuid',true),
('network_map_members_v2','user_id','uuid',true),
('network_map_members_v2','policy_version','text',true),
('network_map_members_v2','valid_until','timestampwithtimezone',true),
('network_map_members_v2','revoked_at','timestampwithtimezone',false),
('network_map_sources_v2','report_id','uuid',true),
('network_map_sources_v2','territory_id','uuid',true),
('network_map_sources_v2','policy_version','text',true),
('network_map_sources_v2','inclusion_review_ref','text',true),
('network_map_sources_v2','revoked_at','timestampwithtimezone',false),
('network_map_publications_v2','id','uuid',true),
('network_map_publications_v2','territory_id','uuid',true),
('network_map_publications_v2','zone_id','uuid',true),
('network_map_publications_v2','policy_version','text',true),
('network_map_publications_v2','period_start','date',true),
('network_map_publications_v2','period_end','date',true),
('network_map_publications_v2','report_count','integer',true),
('network_map_publications_v2','contributor_count','integer',true),
('network_map_publications_v2','state','text',true),
('network_map_publications_v2','disclosure_review_ref','text',false),
('network_map_publications_v2','reviewed_at','timestampwithtimezone',false),
('network_map_publications_v2','valid_until','timestampwithtimezone',true),
('network_map_publication_sources_v2','publication_id','uuid',true),
('network_map_publication_sources_v2','report_id','uuid',true),
('network_history_entries_v2','id','uuid',true),
('network_history_entries_v2','territory_id','uuid',true),
('network_history_entries_v2','zone_id','uuid',true),
('network_history_entries_v2','source_report_id','uuid',true),
('network_history_entries_v2','policy_version','text',true),
('network_history_entries_v2','category','public.network_report_category',true),
('network_history_entries_v2','public_month','date',true),
('network_history_entries_v2','summary','text',true),
('network_history_entries_v2','state','text',true),
('network_history_entries_v2','revision','integer',true),
('network_history_entries_v2','disclosure_review_ref','text',false),
('network_history_entries_v2','reviewed_at','timestampwithtimezone',false),
('network_history_entries_v2','valid_until','timestampwithtimezone',true),
('network_event_policies_v2','territory_id','uuid',true),
('network_event_policies_v2','enabled','boolean',true),
('network_event_policies_v2','access_mode','text',true),
('network_event_policies_v2','policy_version','text',false),
('network_event_policies_v2','required_terms_version','text',false),
('network_event_policies_v2','metric_srid','integer',false),
('network_event_policies_v2','precision_meters','integer',false),
('network_event_policies_v2','min_cell_area_m2','doubleprecision',false),
('network_event_policies_v2','event_ttl','interval',false),
('network_event_policies_v2','resolved_ttl','interval',false),
('network_event_policies_v2','record_retention','interval',false),
('network_event_policies_v2','create_limit_hour','integer',false),
('network_event_policies_v2','create_limit_day','integer',false),
('network_event_policies_v2','read_limit_minute','integer',false),
('network_event_policies_v2','privacy_approval_ref','text',false),
('network_event_policies_v2','retention_decision_ref','text',false),
('network_event_policies_v2','moderation_plan_ref','text',false),
('network_event_members_v2','territory_id','uuid',true),
('network_event_members_v2','user_id','uuid',true),
('network_event_members_v2','policy_version','text',true),
('network_event_members_v2','valid_until','timestampwithtimezone',true),
('network_event_members_v2','revoked_at','timestampwithtimezone',false),
('network_events_v2','public_id','uuid',true),
('network_events_v2','author_user_id','uuid',true),
('network_events_v2','operation_id','uuid',true),
('network_events_v2','request_payload','jsonb',true),
('network_events_v2','territory_id','uuid',true),
('network_events_v2','zone_id','uuid',true),
('network_events_v2','category_id','text',true),
('network_events_v2','author_nickname_snapshot','text',true),
('network_events_v2','description','text',true),
('network_events_v2','public_position','extensions.geometry(point,4326)',true),
('network_events_v2','cell_key','text',true),
('network_events_v2','generalization_meters','integer',true),
('network_events_v2','location_policy_version','text',true),
('network_events_v2','status','text',true),
('network_events_v2','moderation_state','text',true),
('network_events_v2','review_ref','text',false),
('network_events_v2','reviewed_at','timestampwithtimezone',false),
('network_events_v2','revision','integer',true),
('network_events_v2','created_at','timestampwithtimezone',true),
('network_events_v2','updated_at','timestampwithtimezone',true),
('network_events_v2','resolved_at','timestampwithtimezone',false),
('network_events_v2','expires_at','timestampwithtimezone',true),
('network_events_v2','purge_after','timestampwithtimezone',true),
('network_event_read_buckets_v2','user_id','uuid',true),
('network_event_read_buckets_v2','bucket_start','timestampwithtimezone',true),
('network_event_read_buckets_v2','requests','integer',true),
('network_event_write_buckets_v2','user_id','uuid',true),
('network_event_write_buckets_v2','hour_start','timestampwithtimezone',true),
('network_event_write_buckets_v2','hour_count','integer',true),
('network_event_write_buckets_v2','day_start','timestampwithtimezone',true),
('network_event_write_buckets_v2','day_count','integer',true),
('network_social_policies_v2','territory_id','uuid',true),
('network_social_policies_v2','enabled','boolean',true),
('network_social_policies_v2','policy_version','text',false),
('network_social_policies_v2','approval_ref','text',false),
('network_social_policies_v2','moderation_ref','text',false),
('network_social_policies_v2','retention_ref','text',false),
('network_social_policies_v2','retain_for','interval',false),
('network_social_policies_v2','writes_hour','integer',false),
('network_social_policies_v2','writes_day','integer',false),
('network_social_votes_v2','event_id','uuid',true),
('network_social_votes_v2','user_id','uuid',true),
('network_social_votes_v2','kind','text',true),
('network_social_votes_v2','policy_version','text',true),
('network_social_votes_v2','valid_until','timestampwithtimezone',true),
('network_social_follows_v2','event_id','uuid',true),
('network_social_follows_v2','user_id','uuid',true),
('network_social_follows_v2','policy_version','text',true),
('network_social_follows_v2','valid_until','timestampwithtimezone',true),
('network_social_comments_v2','public_id','uuid',true),
('network_social_comments_v2','event_id','uuid',true),
('network_social_comments_v2','author_id','uuid',true),
('network_social_comments_v2','nickname','text',true),
('network_social_comments_v2','body','text',true),
('network_social_comments_v2','policy_version','text',true),
('network_social_comments_v2','moderation_state','text',true),
('network_social_comments_v2','revision','integer',true),
('network_social_comments_v2','review_ref','text',false),
('network_social_comments_v2','created_at','timestampwithtimezone',true),
('network_social_comments_v2','valid_until','timestampwithtimezone',true),
('network_social_operations_v2','user_id','uuid',true),
('network_social_operations_v2','operation_id','uuid',true),
('network_social_operations_v2','event_id','uuid',true),
('network_social_operations_v2','action','text',true),
('network_social_operations_v2','value','text',false),
('network_social_operations_v2','comment_id','uuid',false),
('network_social_operations_v2','created_at','timestampwithtimezone',true)) v(table_name,column_name,type_name,not_null) loop
    if not exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||r.table_name) and a.attname=r.column_name and a.attnum>0 and not a.attisdropped
      and regexp_replace(lower(format_type(a.atttypid,a.atttypmod)),'\s','','g')=r.type_name and a.attnotnull=r.not_null and a.attacl is null) then
      raise exception 'Column/type/nullability mismatch: %.%',r.table_name,r.column_name; end if;
  end loop;
  for r in select * from (values ('network_map_territories_v2','p',1),('network_map_territories_v2','u',1),('network_map_territories_v2','f',0),('network_map_territories_v2','c',6),('network_map_zones_v2','p',1),('network_map_zones_v2','u',2),('network_map_zones_v2','f',1),('network_map_zones_v2','c',2),('network_map_members_v2','p',1),('network_map_members_v2','u',0),('network_map_members_v2','f',2),('network_map_members_v2','c',0),('network_map_sources_v2','p',1),('network_map_sources_v2','u',0),('network_map_sources_v2','f',2),('network_map_sources_v2','c',1),('network_map_publications_v2','p',1),('network_map_publications_v2','u',0),('network_map_publications_v2','f',2),('network_map_publications_v2','c',5),('network_map_publication_sources_v2','p',1),('network_map_publication_sources_v2','u',0),('network_map_publication_sources_v2','f',2),('network_map_publication_sources_v2','c',0),('network_history_entries_v2','p',1),('network_history_entries_v2','u',0),('network_history_entries_v2','f',3),('network_history_entries_v2','c',5),('network_event_policies_v2','p',1),('network_event_policies_v2','u',0),('network_event_policies_v2','f',1),('network_event_policies_v2','c',11),('network_event_members_v2','p',1),('network_event_members_v2','u',0),('network_event_members_v2','f',2),('network_event_members_v2','c',0),('network_events_v2','p',1),('network_events_v2','u',1),('network_events_v2','f',3),('network_events_v2','c',11),('network_event_read_buckets_v2','p',1),('network_event_read_buckets_v2','u',0),('network_event_read_buckets_v2','f',1),('network_event_read_buckets_v2','c',1),('network_event_write_buckets_v2','p',1),('network_event_write_buckets_v2','u',0),('network_event_write_buckets_v2','f',1),('network_event_write_buckets_v2','c',2),('network_social_policies_v2','p',1),('network_social_policies_v2','u',0),('network_social_policies_v2','f',1),('network_social_policies_v2','c',4),('network_social_votes_v2','p',1),('network_social_votes_v2','u',0),('network_social_votes_v2','f',2),('network_social_votes_v2','c',1),('network_social_follows_v2','p',1),('network_social_follows_v2','u',0),('network_social_follows_v2','f',2),('network_social_follows_v2','c',0),('network_social_comments_v2','p',1),('network_social_comments_v2','u',0),('network_social_comments_v2','f',2),('network_social_comments_v2','c',5),('network_social_operations_v2','p',1),('network_social_operations_v2','u',0),('network_social_operations_v2','f',3),('network_social_operations_v2','c',1)) v(name,kind,expected) loop
    if (select count(*) from pg_constraint k where k.conrelid=to_regclass('public.'||r.name) and k.contype::text=r.kind and k.convalidated)<>r.expected then
      raise exception 'Constraint mismatch: % / %',r.name,r.kind; end if;
  end loop;
  for r in select * from (values ('network_map_zones_v2_geometry_idx','network_map_zones_v2'),('network_map_zones_v2_geography_idx','network_map_zones_v2'),('network_map_one_approved_zone_v2','network_map_publications_v2'),('network_map_members_v2_user_idx','network_map_members_v2'),('network_map_sources_v2_territory_idx','network_map_sources_v2'),('network_map_publication_sources_v2_report_idx','network_map_publication_sources_v2'),('network_map_publications_v2_zone_idx','network_map_publications_v2'),('network_history_v2_source_idx','network_history_entries_v2'),('network_history_v2_page_idx','network_history_entries_v2'),('network_events_v2_author_time_idx','network_events_v2'),('network_events_v2_public_geo_idx','network_events_v2'),('network_events_v2_feed_idx','network_events_v2'),('network_events_v2_purge_idx','network_events_v2'),('network_events_v2_review_idx','network_events_v2'),('network_event_members_v2_user_idx','network_event_members_v2'),('network_event_territory_discovery_idx','network_map_territories_v2'),('network_social_operations_actor_time_idx','network_social_operations_v2'),('network_social_comments_page_idx','network_social_comments_v2'),('network_social_comments_queue_idx','network_social_comments_v2'),('network_social_comments_activity_idx','network_social_comments_v2'),('network_social_follows_owner_idx','network_social_follows_v2')) v(name,table_name) loop
    if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.'||r.name) and i.indrelid=to_regclass('public.'||r.table_name) and i.indisvalid and i.indisready) then
      raise exception 'Index mismatch: %',r.name; end if;
  end loop;
  for r in select * from (values ('network_history_invalidate_review_v2','public.network_history_invalidate_review_v2()','trigger',false,'plpgsql','v',false,false),
('network_map_require_access_v2','public.network_map_require_access_v2(uuid)','void',true,'plpgsql','s',false,false),
('network_map_canonical_zone_v2','public.network_map_canonical_zone_v2(uuid,uuid,text)','uuid',true,'sql','s',false,false),
('network_map_candidates_v2','public.network_map_candidates_v2(uuid,date,text)','table(zone_iduuid,report_countbigint,contributor_countbigint)',true,'sql','s',false,true),
('network_map_publication_safe_v2','public.network_map_publication_safe_v2(uuid)','boolean',true,'sql','s',false,false),
('get_network_territory_context_v2','public.get_network_territory_context_v2(uuid)','jsonb',true,'plpgsql','s',true,false),
('list_network_map_cells_v2','public.list_network_map_cells_v2(uuid,integer,double precision,double precision,text)','jsonb',true,'plpgsql','s',true,false),
('list_network_zone_history_v2','public.list_network_zone_history_v2(uuid,uuid,integer,date,uuid)','jsonb',true,'plpgsql','s',true,false),
('network_event_require_access_v2','public.network_event_require_access_v2(uuid,text)','public.network_event_policies_v2',true,'plpgsql','s',false,false),
('network_event_take_read_v2','public.network_event_take_read_v2(integer)','void',true,'plpgsql','v',false,false),
('network_event_take_write_v2','public.network_event_take_write_v2(integer,integer)','void',true,'plpgsql','v',false,false),
('network_event_guard_update_v2','public.network_event_guard_update_v2()','trigger',false,'plpgsql','v',false,false),
('create_network_event_v2','public.create_network_event_v2(uuid,uuid,double precision,double precision,text,text,text)','jsonb',true,'plpgsql','v',true,false),
('network_event_is_public_v2','public.network_event_is_public_v2(public.network_events_v2,public.network_event_policies_v2)','boolean',false,'sql','s',false,false),
('network_event_marker_json_v2','public.network_event_marker_json_v2(public.network_events_v2)','jsonb',false,'sql','s',false,false),
('list_network_event_markers_v2','public.list_network_event_markers_v2(uuid,double precision,double precision,integer,text,text)','jsonb',true,'plpgsql','v',true,false),
('get_network_event_detail_v2','public.get_network_event_detail_v2(uuid)','jsonb',true,'plpgsql','v',true,false),
('list_network_event_territories_v2','public.list_network_event_territories_v2(double precision,double precision,integer,integer,text,uuid)','jsonb',true,'plpgsql','v',true,false),
('list_network_event_review_queue_v2','public.list_network_event_review_queue_v2(uuid,integer,timestamptz,uuid)','jsonb',true,'plpgsql','v',false,true),
('review_network_event_v2','public.review_network_event_v2(uuid,integer,text,text)','void',true,'plpgsql','v',false,true),
('finish_my_network_event_v2','public.finish_my_network_event_v2(uuid,text)','void',true,'plpgsql','v',true,false),
('network_social_actor_allowed_v2','public.network_social_actor_allowed_v2(uuid,uuid)','boolean',false,'sql','s',false,false),
('network_social_require_v2','public.network_social_require_v2(uuid)','public.network_events_v2',true,'plpgsql','v',false,false),
('get_network_social_v2','public.get_network_social_v2(uuid,timestamptz,uuid)','jsonb',true,'plpgsql','v',true,false),
('mutate_network_social_v2','public.mutate_network_social_v2(uuid,uuid,text,text)','jsonb',true,'plpgsql','v',true,false),
('get_my_network_social_operation_v2','public.get_my_network_social_operation_v2(uuid)','jsonb',true,'plpgsql','v',true,false),
('remove_my_network_social_v2','public.remove_my_network_social_v2(uuid,uuid)','void',true,'plpgsql','v',true,false),
('review_network_comment_v2','public.review_network_comment_v2(uuid,integer,text,text)','void',true,'plpgsql','v',false,true),
('list_network_comment_review_v2','public.list_network_comment_review_v2(timestamptz,uuid)','jsonb',true,'plpgsql','v',false,true),
('list_network_social_activity_v2','public.list_network_social_activity_v2(uuid,boolean)','jsonb',true,'plpgsql','v',true,false)) v(name,signature,result_type,definer,language,volatility,client_execute,service_execute) loop
    oid_now:=to_regprocedure(r.signature);
    if oid_now is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=oid_now
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef=r.definer and l.lanname=r.language and p.provolatile::text=r.volatility
      and regexp_replace(lower(pg_get_function_result(p.oid)),'\s','','g')=r.result_type
      and exists(select 1 from unnest(p.proconfig) s where regexp_replace(s,'\s','','g')='search_path=pg_catalog,pg_temp')) then
      raise exception 'Function signature/owner/definer/path mismatch: %',r.name; end if;
    if has_function_privilege('anon',oid_now,'EXECUTE') is distinct from false
      or has_function_privilege('authenticated',oid_now,'EXECUTE') is distinct from r.client_execute
      or has_function_privilege('service_role',oid_now,'EXECUTE') is distinct from r.service_execute
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=oid_now and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Function ACL mismatch: %',r.name; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      left join pg_roles gr on gr.oid=a.grantee where p.oid=oid_now and a.grantee<>p.proowner
      and (a.is_grantable or a.privilege_type<>'EXECUTE' or
        ((gr.rolname='authenticated' and r.client_execute) or (gr.rolname='service_role' and r.service_execute)) is not true)) then
      raise exception 'Unexpected function grantee/grant option: %',r.name; end if;
  end loop;
  for r in select * from (values ('network_map_territories_v2','anon','SELECT',false),
('network_map_territories_v2','anon','INSERT',false),
('network_map_territories_v2','anon','UPDATE',false),
('network_map_territories_v2','anon','DELETE',false),
('network_map_territories_v2','anon','TRUNCATE',false),
('network_map_territories_v2','anon','REFERENCES',false),
('network_map_territories_v2','anon','TRIGGER',false),
('network_map_territories_v2','anon','MAINTAIN',false),
('network_map_territories_v2','authenticated','SELECT',false),
('network_map_territories_v2','authenticated','INSERT',false),
('network_map_territories_v2','authenticated','UPDATE',false),
('network_map_territories_v2','authenticated','DELETE',false),
('network_map_territories_v2','authenticated','TRUNCATE',false),
('network_map_territories_v2','authenticated','REFERENCES',false),
('network_map_territories_v2','authenticated','TRIGGER',false),
('network_map_territories_v2','authenticated','MAINTAIN',false),
('network_map_territories_v2','service_role','SELECT',true),
('network_map_territories_v2','service_role','INSERT',true),
('network_map_territories_v2','service_role','UPDATE',true),
('network_map_territories_v2','service_role','DELETE',true),
('network_map_territories_v2','service_role','TRUNCATE',false),
('network_map_territories_v2','service_role','REFERENCES',false),
('network_map_territories_v2','service_role','TRIGGER',false),
('network_map_territories_v2','service_role','MAINTAIN',false),
('network_map_zones_v2','anon','SELECT',false),
('network_map_zones_v2','anon','INSERT',false),
('network_map_zones_v2','anon','UPDATE',false),
('network_map_zones_v2','anon','DELETE',false),
('network_map_zones_v2','anon','TRUNCATE',false),
('network_map_zones_v2','anon','REFERENCES',false),
('network_map_zones_v2','anon','TRIGGER',false),
('network_map_zones_v2','anon','MAINTAIN',false),
('network_map_zones_v2','authenticated','SELECT',false),
('network_map_zones_v2','authenticated','INSERT',false),
('network_map_zones_v2','authenticated','UPDATE',false),
('network_map_zones_v2','authenticated','DELETE',false),
('network_map_zones_v2','authenticated','TRUNCATE',false),
('network_map_zones_v2','authenticated','REFERENCES',false),
('network_map_zones_v2','authenticated','TRIGGER',false),
('network_map_zones_v2','authenticated','MAINTAIN',false),
('network_map_zones_v2','service_role','SELECT',true),
('network_map_zones_v2','service_role','INSERT',true),
('network_map_zones_v2','service_role','UPDATE',true),
('network_map_zones_v2','service_role','DELETE',true),
('network_map_zones_v2','service_role','TRUNCATE',false),
('network_map_zones_v2','service_role','REFERENCES',false),
('network_map_zones_v2','service_role','TRIGGER',false),
('network_map_zones_v2','service_role','MAINTAIN',false),
('network_map_members_v2','anon','SELECT',false),
('network_map_members_v2','anon','INSERT',false),
('network_map_members_v2','anon','UPDATE',false),
('network_map_members_v2','anon','DELETE',false),
('network_map_members_v2','anon','TRUNCATE',false),
('network_map_members_v2','anon','REFERENCES',false),
('network_map_members_v2','anon','TRIGGER',false),
('network_map_members_v2','anon','MAINTAIN',false),
('network_map_members_v2','authenticated','SELECT',false),
('network_map_members_v2','authenticated','INSERT',false),
('network_map_members_v2','authenticated','UPDATE',false),
('network_map_members_v2','authenticated','DELETE',false),
('network_map_members_v2','authenticated','TRUNCATE',false),
('network_map_members_v2','authenticated','REFERENCES',false),
('network_map_members_v2','authenticated','TRIGGER',false),
('network_map_members_v2','authenticated','MAINTAIN',false),
('network_map_members_v2','service_role','SELECT',true),
('network_map_members_v2','service_role','INSERT',true),
('network_map_members_v2','service_role','UPDATE',true),
('network_map_members_v2','service_role','DELETE',true),
('network_map_members_v2','service_role','TRUNCATE',false),
('network_map_members_v2','service_role','REFERENCES',false),
('network_map_members_v2','service_role','TRIGGER',false),
('network_map_members_v2','service_role','MAINTAIN',false),
('network_map_sources_v2','anon','SELECT',false),
('network_map_sources_v2','anon','INSERT',false),
('network_map_sources_v2','anon','UPDATE',false),
('network_map_sources_v2','anon','DELETE',false),
('network_map_sources_v2','anon','TRUNCATE',false),
('network_map_sources_v2','anon','REFERENCES',false),
('network_map_sources_v2','anon','TRIGGER',false),
('network_map_sources_v2','anon','MAINTAIN',false),
('network_map_sources_v2','authenticated','SELECT',false),
('network_map_sources_v2','authenticated','INSERT',false),
('network_map_sources_v2','authenticated','UPDATE',false),
('network_map_sources_v2','authenticated','DELETE',false),
('network_map_sources_v2','authenticated','TRUNCATE',false),
('network_map_sources_v2','authenticated','REFERENCES',false),
('network_map_sources_v2','authenticated','TRIGGER',false),
('network_map_sources_v2','authenticated','MAINTAIN',false),
('network_map_sources_v2','service_role','SELECT',true),
('network_map_sources_v2','service_role','INSERT',true),
('network_map_sources_v2','service_role','UPDATE',true),
('network_map_sources_v2','service_role','DELETE',true),
('network_map_sources_v2','service_role','TRUNCATE',false),
('network_map_sources_v2','service_role','REFERENCES',false),
('network_map_sources_v2','service_role','TRIGGER',false),
('network_map_sources_v2','service_role','MAINTAIN',false),
('network_map_publications_v2','anon','SELECT',false),
('network_map_publications_v2','anon','INSERT',false),
('network_map_publications_v2','anon','UPDATE',false),
('network_map_publications_v2','anon','DELETE',false),
('network_map_publications_v2','anon','TRUNCATE',false),
('network_map_publications_v2','anon','REFERENCES',false),
('network_map_publications_v2','anon','TRIGGER',false),
('network_map_publications_v2','anon','MAINTAIN',false),
('network_map_publications_v2','authenticated','SELECT',false),
('network_map_publications_v2','authenticated','INSERT',false),
('network_map_publications_v2','authenticated','UPDATE',false),
('network_map_publications_v2','authenticated','DELETE',false),
('network_map_publications_v2','authenticated','TRUNCATE',false),
('network_map_publications_v2','authenticated','REFERENCES',false),
('network_map_publications_v2','authenticated','TRIGGER',false),
('network_map_publications_v2','authenticated','MAINTAIN',false),
('network_map_publications_v2','service_role','SELECT',true),
('network_map_publications_v2','service_role','INSERT',true),
('network_map_publications_v2','service_role','UPDATE',true),
('network_map_publications_v2','service_role','DELETE',true),
('network_map_publications_v2','service_role','TRUNCATE',false),
('network_map_publications_v2','service_role','REFERENCES',false),
('network_map_publications_v2','service_role','TRIGGER',false),
('network_map_publications_v2','service_role','MAINTAIN',false),
('network_map_publication_sources_v2','anon','SELECT',false),
('network_map_publication_sources_v2','anon','INSERT',false),
('network_map_publication_sources_v2','anon','UPDATE',false),
('network_map_publication_sources_v2','anon','DELETE',false),
('network_map_publication_sources_v2','anon','TRUNCATE',false),
('network_map_publication_sources_v2','anon','REFERENCES',false),
('network_map_publication_sources_v2','anon','TRIGGER',false),
('network_map_publication_sources_v2','anon','MAINTAIN',false),
('network_map_publication_sources_v2','authenticated','SELECT',false),
('network_map_publication_sources_v2','authenticated','INSERT',false),
('network_map_publication_sources_v2','authenticated','UPDATE',false),
('network_map_publication_sources_v2','authenticated','DELETE',false),
('network_map_publication_sources_v2','authenticated','TRUNCATE',false),
('network_map_publication_sources_v2','authenticated','REFERENCES',false),
('network_map_publication_sources_v2','authenticated','TRIGGER',false),
('network_map_publication_sources_v2','authenticated','MAINTAIN',false),
('network_map_publication_sources_v2','service_role','SELECT',true),
('network_map_publication_sources_v2','service_role','INSERT',true),
('network_map_publication_sources_v2','service_role','UPDATE',true),
('network_map_publication_sources_v2','service_role','DELETE',true),
('network_map_publication_sources_v2','service_role','TRUNCATE',false),
('network_map_publication_sources_v2','service_role','REFERENCES',false),
('network_map_publication_sources_v2','service_role','TRIGGER',false),
('network_map_publication_sources_v2','service_role','MAINTAIN',false),
('network_history_entries_v2','anon','SELECT',false),
('network_history_entries_v2','anon','INSERT',false),
('network_history_entries_v2','anon','UPDATE',false),
('network_history_entries_v2','anon','DELETE',false),
('network_history_entries_v2','anon','TRUNCATE',false),
('network_history_entries_v2','anon','REFERENCES',false),
('network_history_entries_v2','anon','TRIGGER',false),
('network_history_entries_v2','anon','MAINTAIN',false),
('network_history_entries_v2','authenticated','SELECT',false),
('network_history_entries_v2','authenticated','INSERT',false),
('network_history_entries_v2','authenticated','UPDATE',false),
('network_history_entries_v2','authenticated','DELETE',false),
('network_history_entries_v2','authenticated','TRUNCATE',false),
('network_history_entries_v2','authenticated','REFERENCES',false),
('network_history_entries_v2','authenticated','TRIGGER',false),
('network_history_entries_v2','authenticated','MAINTAIN',false),
('network_history_entries_v2','service_role','SELECT',true),
('network_history_entries_v2','service_role','INSERT',true),
('network_history_entries_v2','service_role','UPDATE',true),
('network_history_entries_v2','service_role','DELETE',true),
('network_history_entries_v2','service_role','TRUNCATE',false),
('network_history_entries_v2','service_role','REFERENCES',false),
('network_history_entries_v2','service_role','TRIGGER',false),
('network_history_entries_v2','service_role','MAINTAIN',false),
('network_event_policies_v2','anon','SELECT',false),
('network_event_policies_v2','anon','INSERT',false),
('network_event_policies_v2','anon','UPDATE',false),
('network_event_policies_v2','anon','DELETE',false),
('network_event_policies_v2','anon','TRUNCATE',false),
('network_event_policies_v2','anon','REFERENCES',false),
('network_event_policies_v2','anon','TRIGGER',false),
('network_event_policies_v2','anon','MAINTAIN',false),
('network_event_policies_v2','authenticated','SELECT',false),
('network_event_policies_v2','authenticated','INSERT',false),
('network_event_policies_v2','authenticated','UPDATE',false),
('network_event_policies_v2','authenticated','DELETE',false),
('network_event_policies_v2','authenticated','TRUNCATE',false),
('network_event_policies_v2','authenticated','REFERENCES',false),
('network_event_policies_v2','authenticated','TRIGGER',false),
('network_event_policies_v2','authenticated','MAINTAIN',false),
('network_event_policies_v2','service_role','SELECT',true),
('network_event_policies_v2','service_role','INSERT',true),
('network_event_policies_v2','service_role','UPDATE',true),
('network_event_policies_v2','service_role','DELETE',false),
('network_event_policies_v2','service_role','TRUNCATE',false),
('network_event_policies_v2','service_role','REFERENCES',false),
('network_event_policies_v2','service_role','TRIGGER',false),
('network_event_policies_v2','service_role','MAINTAIN',false),
('network_event_members_v2','anon','SELECT',false),
('network_event_members_v2','anon','INSERT',false),
('network_event_members_v2','anon','UPDATE',false),
('network_event_members_v2','anon','DELETE',false),
('network_event_members_v2','anon','TRUNCATE',false),
('network_event_members_v2','anon','REFERENCES',false),
('network_event_members_v2','anon','TRIGGER',false),
('network_event_members_v2','anon','MAINTAIN',false),
('network_event_members_v2','authenticated','SELECT',false),
('network_event_members_v2','authenticated','INSERT',false),
('network_event_members_v2','authenticated','UPDATE',false),
('network_event_members_v2','authenticated','DELETE',false),
('network_event_members_v2','authenticated','TRUNCATE',false),
('network_event_members_v2','authenticated','REFERENCES',false),
('network_event_members_v2','authenticated','TRIGGER',false),
('network_event_members_v2','authenticated','MAINTAIN',false),
('network_event_members_v2','service_role','SELECT',true),
('network_event_members_v2','service_role','INSERT',true),
('network_event_members_v2','service_role','UPDATE',true),
('network_event_members_v2','service_role','DELETE',false),
('network_event_members_v2','service_role','TRUNCATE',false),
('network_event_members_v2','service_role','REFERENCES',false),
('network_event_members_v2','service_role','TRIGGER',false),
('network_event_members_v2','service_role','MAINTAIN',false),
('network_events_v2','anon','SELECT',false),
('network_events_v2','anon','INSERT',false),
('network_events_v2','anon','UPDATE',false),
('network_events_v2','anon','DELETE',false),
('network_events_v2','anon','TRUNCATE',false),
('network_events_v2','anon','REFERENCES',false),
('network_events_v2','anon','TRIGGER',false),
('network_events_v2','anon','MAINTAIN',false),
('network_events_v2','authenticated','SELECT',false),
('network_events_v2','authenticated','INSERT',false),
('network_events_v2','authenticated','UPDATE',false),
('network_events_v2','authenticated','DELETE',false),
('network_events_v2','authenticated','TRUNCATE',false),
('network_events_v2','authenticated','REFERENCES',false),
('network_events_v2','authenticated','TRIGGER',false),
('network_events_v2','authenticated','MAINTAIN',false),
('network_events_v2','service_role','SELECT',false),
('network_events_v2','service_role','INSERT',false),
('network_events_v2','service_role','UPDATE',false),
('network_events_v2','service_role','DELETE',false),
('network_events_v2','service_role','TRUNCATE',false),
('network_events_v2','service_role','REFERENCES',false),
('network_events_v2','service_role','TRIGGER',false),
('network_events_v2','service_role','MAINTAIN',false),
('network_event_read_buckets_v2','anon','SELECT',false),
('network_event_read_buckets_v2','anon','INSERT',false),
('network_event_read_buckets_v2','anon','UPDATE',false),
('network_event_read_buckets_v2','anon','DELETE',false),
('network_event_read_buckets_v2','anon','TRUNCATE',false),
('network_event_read_buckets_v2','anon','REFERENCES',false),
('network_event_read_buckets_v2','anon','TRIGGER',false),
('network_event_read_buckets_v2','anon','MAINTAIN',false),
('network_event_read_buckets_v2','authenticated','SELECT',false),
('network_event_read_buckets_v2','authenticated','INSERT',false),
('network_event_read_buckets_v2','authenticated','UPDATE',false),
('network_event_read_buckets_v2','authenticated','DELETE',false),
('network_event_read_buckets_v2','authenticated','TRUNCATE',false),
('network_event_read_buckets_v2','authenticated','REFERENCES',false),
('network_event_read_buckets_v2','authenticated','TRIGGER',false),
('network_event_read_buckets_v2','authenticated','MAINTAIN',false),
('network_event_read_buckets_v2','service_role','SELECT',false),
('network_event_read_buckets_v2','service_role','INSERT',false),
('network_event_read_buckets_v2','service_role','UPDATE',false),
('network_event_read_buckets_v2','service_role','DELETE',false),
('network_event_read_buckets_v2','service_role','TRUNCATE',false),
('network_event_read_buckets_v2','service_role','REFERENCES',false),
('network_event_read_buckets_v2','service_role','TRIGGER',false),
('network_event_read_buckets_v2','service_role','MAINTAIN',false),
('network_event_write_buckets_v2','anon','SELECT',false),
('network_event_write_buckets_v2','anon','INSERT',false),
('network_event_write_buckets_v2','anon','UPDATE',false),
('network_event_write_buckets_v2','anon','DELETE',false),
('network_event_write_buckets_v2','anon','TRUNCATE',false),
('network_event_write_buckets_v2','anon','REFERENCES',false),
('network_event_write_buckets_v2','anon','TRIGGER',false),
('network_event_write_buckets_v2','anon','MAINTAIN',false),
('network_event_write_buckets_v2','authenticated','SELECT',false),
('network_event_write_buckets_v2','authenticated','INSERT',false),
('network_event_write_buckets_v2','authenticated','UPDATE',false),
('network_event_write_buckets_v2','authenticated','DELETE',false),
('network_event_write_buckets_v2','authenticated','TRUNCATE',false),
('network_event_write_buckets_v2','authenticated','REFERENCES',false),
('network_event_write_buckets_v2','authenticated','TRIGGER',false),
('network_event_write_buckets_v2','authenticated','MAINTAIN',false),
('network_event_write_buckets_v2','service_role','SELECT',false),
('network_event_write_buckets_v2','service_role','INSERT',false),
('network_event_write_buckets_v2','service_role','UPDATE',false),
('network_event_write_buckets_v2','service_role','DELETE',false),
('network_event_write_buckets_v2','service_role','TRUNCATE',false),
('network_event_write_buckets_v2','service_role','REFERENCES',false),
('network_event_write_buckets_v2','service_role','TRIGGER',false),
('network_event_write_buckets_v2','service_role','MAINTAIN',false),
('network_social_policies_v2','anon','SELECT',false),
('network_social_policies_v2','anon','INSERT',false),
('network_social_policies_v2','anon','UPDATE',false),
('network_social_policies_v2','anon','DELETE',false),
('network_social_policies_v2','anon','TRUNCATE',false),
('network_social_policies_v2','anon','REFERENCES',false),
('network_social_policies_v2','anon','TRIGGER',false),
('network_social_policies_v2','anon','MAINTAIN',false),
('network_social_policies_v2','authenticated','SELECT',false),
('network_social_policies_v2','authenticated','INSERT',false),
('network_social_policies_v2','authenticated','UPDATE',false),
('network_social_policies_v2','authenticated','DELETE',false),
('network_social_policies_v2','authenticated','TRUNCATE',false),
('network_social_policies_v2','authenticated','REFERENCES',false),
('network_social_policies_v2','authenticated','TRIGGER',false),
('network_social_policies_v2','authenticated','MAINTAIN',false),
('network_social_policies_v2','service_role','SELECT',true),
('network_social_policies_v2','service_role','INSERT',true),
('network_social_policies_v2','service_role','UPDATE',true),
('network_social_policies_v2','service_role','DELETE',false),
('network_social_policies_v2','service_role','TRUNCATE',false),
('network_social_policies_v2','service_role','REFERENCES',false),
('network_social_policies_v2','service_role','TRIGGER',false),
('network_social_policies_v2','service_role','MAINTAIN',false),
('network_social_votes_v2','anon','SELECT',false),
('network_social_votes_v2','anon','INSERT',false),
('network_social_votes_v2','anon','UPDATE',false),
('network_social_votes_v2','anon','DELETE',false),
('network_social_votes_v2','anon','TRUNCATE',false),
('network_social_votes_v2','anon','REFERENCES',false),
('network_social_votes_v2','anon','TRIGGER',false),
('network_social_votes_v2','anon','MAINTAIN',false),
('network_social_votes_v2','authenticated','SELECT',false),
('network_social_votes_v2','authenticated','INSERT',false),
('network_social_votes_v2','authenticated','UPDATE',false),
('network_social_votes_v2','authenticated','DELETE',false),
('network_social_votes_v2','authenticated','TRUNCATE',false),
('network_social_votes_v2','authenticated','REFERENCES',false),
('network_social_votes_v2','authenticated','TRIGGER',false),
('network_social_votes_v2','authenticated','MAINTAIN',false),
('network_social_votes_v2','service_role','SELECT',false),
('network_social_votes_v2','service_role','INSERT',false),
('network_social_votes_v2','service_role','UPDATE',false),
('network_social_votes_v2','service_role','DELETE',false),
('network_social_votes_v2','service_role','TRUNCATE',false),
('network_social_votes_v2','service_role','REFERENCES',false),
('network_social_votes_v2','service_role','TRIGGER',false),
('network_social_votes_v2','service_role','MAINTAIN',false),
('network_social_follows_v2','anon','SELECT',false),
('network_social_follows_v2','anon','INSERT',false),
('network_social_follows_v2','anon','UPDATE',false),
('network_social_follows_v2','anon','DELETE',false),
('network_social_follows_v2','anon','TRUNCATE',false),
('network_social_follows_v2','anon','REFERENCES',false),
('network_social_follows_v2','anon','TRIGGER',false),
('network_social_follows_v2','anon','MAINTAIN',false),
('network_social_follows_v2','authenticated','SELECT',false),
('network_social_follows_v2','authenticated','INSERT',false),
('network_social_follows_v2','authenticated','UPDATE',false),
('network_social_follows_v2','authenticated','DELETE',false),
('network_social_follows_v2','authenticated','TRUNCATE',false),
('network_social_follows_v2','authenticated','REFERENCES',false),
('network_social_follows_v2','authenticated','TRIGGER',false),
('network_social_follows_v2','authenticated','MAINTAIN',false),
('network_social_follows_v2','service_role','SELECT',false),
('network_social_follows_v2','service_role','INSERT',false),
('network_social_follows_v2','service_role','UPDATE',false),
('network_social_follows_v2','service_role','DELETE',false),
('network_social_follows_v2','service_role','TRUNCATE',false),
('network_social_follows_v2','service_role','REFERENCES',false),
('network_social_follows_v2','service_role','TRIGGER',false),
('network_social_follows_v2','service_role','MAINTAIN',false),
('network_social_comments_v2','anon','SELECT',false),
('network_social_comments_v2','anon','INSERT',false),
('network_social_comments_v2','anon','UPDATE',false),
('network_social_comments_v2','anon','DELETE',false),
('network_social_comments_v2','anon','TRUNCATE',false),
('network_social_comments_v2','anon','REFERENCES',false),
('network_social_comments_v2','anon','TRIGGER',false),
('network_social_comments_v2','anon','MAINTAIN',false),
('network_social_comments_v2','authenticated','SELECT',false),
('network_social_comments_v2','authenticated','INSERT',false),
('network_social_comments_v2','authenticated','UPDATE',false),
('network_social_comments_v2','authenticated','DELETE',false),
('network_social_comments_v2','authenticated','TRUNCATE',false),
('network_social_comments_v2','authenticated','REFERENCES',false),
('network_social_comments_v2','authenticated','TRIGGER',false),
('network_social_comments_v2','authenticated','MAINTAIN',false),
('network_social_comments_v2','service_role','SELECT',false),
('network_social_comments_v2','service_role','INSERT',false),
('network_social_comments_v2','service_role','UPDATE',false),
('network_social_comments_v2','service_role','DELETE',false),
('network_social_comments_v2','service_role','TRUNCATE',false),
('network_social_comments_v2','service_role','REFERENCES',false),
('network_social_comments_v2','service_role','TRIGGER',false),
('network_social_comments_v2','service_role','MAINTAIN',false),
('network_social_operations_v2','anon','SELECT',false),
('network_social_operations_v2','anon','INSERT',false),
('network_social_operations_v2','anon','UPDATE',false),
('network_social_operations_v2','anon','DELETE',false),
('network_social_operations_v2','anon','TRUNCATE',false),
('network_social_operations_v2','anon','REFERENCES',false),
('network_social_operations_v2','anon','TRIGGER',false),
('network_social_operations_v2','anon','MAINTAIN',false),
('network_social_operations_v2','authenticated','SELECT',false),
('network_social_operations_v2','authenticated','INSERT',false),
('network_social_operations_v2','authenticated','UPDATE',false),
('network_social_operations_v2','authenticated','DELETE',false),
('network_social_operations_v2','authenticated','TRUNCATE',false),
('network_social_operations_v2','authenticated','REFERENCES',false),
('network_social_operations_v2','authenticated','TRIGGER',false),
('network_social_operations_v2','authenticated','MAINTAIN',false),
('network_social_operations_v2','service_role','SELECT',false),
('network_social_operations_v2','service_role','INSERT',false),
('network_social_operations_v2','service_role','UPDATE',false),
('network_social_operations_v2','service_role','DELETE',false),
('network_social_operations_v2','service_role','TRUNCATE',false),
('network_social_operations_v2','service_role','REFERENCES',false),
('network_social_operations_v2','service_role','TRIGGER',false),
('network_social_operations_v2','service_role','MAINTAIN',false)) v(table_name,role_name,privilege_name,expected) loop
    if has_table_privilege(r.role_name::name,'public.'||r.table_name,r.privilege_name) is distinct from r.expected then
      raise exception 'Table ACL mismatch: % / % / %',r.table_name,r.role_name,r.privilege_name; end if;
  end loop;
  foreach h in array array['network_map_territories_v2','network_event_policies_v2','network_social_policies_v2'] loop
    if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass('public.'||h) and a.attname='enabled' and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then
      raise exception 'Gate default OFF missing: %',h; end if;
  end loop;
  for r in select * from (values ('network_history_invalidate_review_v2','network_history_entries_v2'),('network_event_guard_update_v2','network_events_v2')) v(name,table_name) loop
    if not exists(select 1 from pg_trigger t where t.tgname=r.name and t.tgrelid=to_regclass('public.'||r.table_name) and not t.tgisinternal and t.tgenabled='O') then
      raise exception 'Trigger mismatch: %',r.name; end if;
  end loop;
  select md5(jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,p.proconfig::text,md5(pg_get_functiondef(p.oid))) order by p.oid),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname in ('public','auth') and p.proname not in ('network_history_invalidate_review_v2','network_map_require_access_v2','network_map_canonical_zone_v2','network_map_candidates_v2','network_map_publication_safe_v2','get_network_territory_context_v2','list_network_map_cells_v2','list_network_zone_history_v2','network_event_require_access_v2','network_event_take_read_v2','network_event_take_write_v2','network_event_guard_update_v2','create_network_event_v2','network_event_is_public_v2','network_event_marker_json_v2','list_network_event_markers_v2','get_network_event_detail_v2','list_network_event_territories_v2','list_network_event_review_queue_v2','review_network_event_v2','finish_my_network_event_v2','network_social_actor_allowed_v2','network_social_require_v2','get_network_social_v2','mutate_network_social_v2','get_my_network_social_operation_v2','remove_my_network_social_v2','review_network_comment_v2','list_network_comment_review_v2','list_network_social_activity_v2')),
    'tables',(select coalesce(jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
      (select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      (select jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid))) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
      (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by i.indexrelid) from pg_index i where i.indrelid=c.oid)) order by c.oid),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth') and c.relname not in ('network_map_territories_v2','network_map_zones_v2','network_map_members_v2','network_map_sources_v2','network_map_publications_v2','network_map_publication_sources_v2','network_history_entries_v2','network_event_policies_v2','network_event_members_v2','network_events_v2','network_event_read_buckets_v2','network_event_write_buckets_v2','network_social_policies_v2','network_social_votes_v2','network_social_follows_v2','network_social_comments_v2','network_social_operations_v2'))
  )::text) into h;
  if h is distinct from current_setting('safemelink.phase17_catalog_fingerprint',true) then raise exception 'Pre-existing business metadata changed'; end if;
  raise notice 'DDL STRUCTURE CHECKS COMPLETED. No fixture, RPC execution, JWT, concurrency or external effects test. ROLLBACK follows.';
end $phase17_assertions$;
select pg_catalog.jsonb_build_object('status','DDL_ASSERTIONS_PASSED_ROLLBACK_FOLLOWS',
  'tables',17,'columns',150,'functions',30,'explicitIndexes',21,'triggers',2,
  'functionalRpcTests',false,'fixturesCreated',false,'postRollbackCheckStillRequired',true) as phase17_result;
rollback;
