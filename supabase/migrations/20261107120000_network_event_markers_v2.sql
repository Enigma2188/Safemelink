-- LOCAL DRAFT / NOT APPLIED. No seed, activation, legacy import, transport or scheduler.
begin;
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
commit;
