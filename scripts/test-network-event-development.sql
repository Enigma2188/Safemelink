-- PREPARED ONLY, NOT EXECUTED. Run in ONE session on an independently verified
-- disposable local DB or Development. Migration must already exist there.
-- Do not set the acknowledgements until auth/profile triggers and external
-- workers/webhooks have been inspected: SQL cannot prove those are inactive.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare
  territory uuid := gen_random_uuid(); zone uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); operation uuid := gen_random_uuid();
  event_id uuid; expired_id uuid := gen_random_uuid(); restriction uuid := gen_random_uuid();
  terms text; created jsonb; replay jsonb; markers jsonb; detail jsonb; rejected boolean; revision_now integer;
  boundary extensions.geometry := extensions.st_multi(extensions.st_geomfromtext('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326));
  existing public.network_events_v2%rowtype;
begin
  if current_user<>'postgres' then raise exception 'Controlled admin session required'; end if;
  if current_setting('safemelink.event_test_target',true) not in ('VERIFIED_LOCAL_DISPOSABLE','lwkxufnbjrpsehdkfmgy')
    or current_setting('safemelink.event_test_target',true) is null
    or current_setting('safemelink.event_test_external_review',true) is distinct from 'confirmed-no-side-effects' then
    raise exception 'STOP: independently verify target identity, triggers and external workers first'; end if;
  select current_terms_version into terms from public.network_config where singleton;
  if terms is null then raise exception 'NETWORK terms dependency absent'; end if;
  if exists(select 1 from auth.users where id in (a,b)) then raise exception 'Fixture collision'; end if;
  insert into auth.users(id,email,email_confirmed_at) values
    (a,'synthetic-event-'||a||'@example.invalid',statement_timestamp()),
    (b,'synthetic-event-'||b||'@example.invalid',statement_timestamp());
  insert into public.profiles(id) values(a),(b) on conflict(id) do nothing;
  update public.profiles set first_name='Synthetic',last_name='Fixture',nickname='Synthetic event fixture',phone='0000000000'
    where id in (a,b);
  insert into public.network_preferences(user_id,network_terms_version,accepted_at) values(a,terms,statement_timestamp()),(b,terms,statement_timestamp())
    on conflict(user_id) do update set network_terms_version=excluded.network_terms_version,accepted_at=excluded.accepted_at;
  if public.network_user_is_eligible(a) is distinct from true or public.network_user_is_eligible(b) is distinct from true then
    raise exception 'Synthetic fixtures incompatible with eligibility implementation'; end if;
  insert into public.network_map_territories_v2(id,code,label,boundary,geometry_source,geometry_license,geometry_version)
    values(territory,'synthetic-event-'||territory,'SYNTHETIC EVENT TEST',boundary,'synthetic','test-only','test');
  insert into public.network_map_zones_v2(id,territory_id,zone_code,label,geometry)
    values(zone,territory,'SYNTHETIC','SYNTHETIC',boundary);
  insert into public.network_event_policies_v2(territory_id) values(territory);
  if (select enabled from public.network_event_policies_v2 where territory_id=territory) is distinct from false then
    raise exception 'Policy must default OFF'; end if;
  rejected:=false;
  begin update public.network_event_policies_v2 set enabled=true where territory_id=territory;
  exception when check_violation then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Incomplete privacy policy accepted'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  rejected:=false;
  begin perform public.create_network_event_v2(operation,territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic event description only.');
  exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'OFF gate accepted publication'; end if;
  -- SYNTHETIC TEST POLICY ONLY. These values are NOT a policy for any real territory.
  update public.network_event_policies_v2 set enabled=true,policy_version='synthetic-test',required_terms_version=terms,
    metric_srid=3857,precision_meters=500,min_cell_area_m2=10000,event_ttl=interval '1 hour',resolved_ttl=interval '1 hour',
    record_retention=interval '2 hours',create_limit_hour=20,create_limit_day=100,read_limit_minute=120,
    privacy_approval_ref='synthetic',retention_decision_ref='synthetic',moderation_plan_ref='synthetic'
    where territory_id=territory;
  rejected:=false;
  begin perform public.create_network_event_v2(operation,territory,0.25,0.25,'GPS_DEFAULT','LIGHTING','Synthetic event description only.');
  exception when invalid_parameter_value then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Implicit GPS provenance accepted'; end if;
  rejected:=false;
  begin perform public.create_network_event_v2(operation,territory,2,2,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic event description only.');
  exception when invalid_parameter_value then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Outside event accepted'; end if;
  created:=public.create_network_event_v2(operation,territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic event description only.');
  if created->>'publicationState' is distinct from 'PENDING' or (created->>'replayed')::boolean is distinct from false
    or created->>'publicId' is null then raise exception 'Missing/incorrect create result'; end if;
  event_id:=(created->>'publicId')::uuid;
  replay:=public.create_network_event_v2(operation,territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic event description only.');
  if replay->>'publicId' is distinct from event_id::text or (replay->>'replayed')::boolean is distinct from true
    or (select count(*) from public.network_events_v2 where author_user_id=a and operation_id=operation)<>1 then
    raise exception 'Idempotency failed'; end if;
  rejected:=false;
  begin perform public.create_network_event_v2(operation,territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Changed synthetic description.');
  exception when invalid_parameter_value then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Operation payload conflict not detected'; end if;
  rejected:=false;
  begin perform public.create_network_event_v2(gen_random_uuid(),territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic event description only.');
  exception when unique_violation then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Duplicate publication not detected'; end if;
  update public.network_event_policies_v2 set create_limit_hour=1 where territory_id=territory;
  rejected:=false;
  begin perform public.create_network_event_v2(gen_random_uuid(),territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Another synthetic event description.');
  exception when program_limit_exceeded then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Publication quota not enforced'; end if;
  update public.network_event_policies_v2 set create_limit_hour=20 where territory_id=territory;
  markers:=public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE','LIGHTING');
  if markers is distinct from '[]'::jsonb then raise exception 'Unreviewed event leaked'; end if;
  select revision into strict revision_now from public.network_events_v2 where public_id=event_id;
  perform public.review_network_event_v2(event_id,revision_now,'APPROVED','synthetic content/location/nickname review');
  rejected:=false;
  begin perform public.review_network_event_v2(event_id,revision_now,'APPROVED','stale synthetic review');
  exception when serialization_failure then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Stale review accepted'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  markers:=public.list_network_event_markers_v2(territory,0.25,0.25,2500,'ACTIVE',null);
  if jsonb_array_length(markers) is distinct from 1 or markers->0->>'publicId' is distinct from event_id::text
    or markers->0->>'kind' is distinct from 'OPERATIONAL_EVENT' or (markers->0->>'schemaVersion')::integer is distinct from 2
    or markers->0->'publicPosition'->>'representation' is distinct from 'GENERALIZED_EVENT_POINT' then
    raise exception 'Public marker contract failed'; end if;
  if (markers->0 ?| array['author_user_id','authorId','operation_id','description','authorNickname','request_payload']) is distinct from false then
    raise exception 'Non-marker/private fields exposed'; end if;
  if (select extensions.st_equals(public_position,extensions.st_setsrid(extensions.st_makepoint(0.25,0.25),4326))
    from public.network_events_v2 where public_id=event_id) is distinct from false then raise exception 'Chosen point was not generalized'; end if;
  detail:=public.get_network_event_detail_v2(event_id);
  if detail->'marker'->>'publicId' is distinct from event_id::text or detail->>'authorNickname' is distinct from 'Synthetic event fixture'
    or detail->>'description' is distinct from 'Synthetic event description only.' then raise exception 'Authorized detail failed'; end if;
  replay:=public.create_network_event_v2(operation,territory,0.5,0.5,'EXPLICIT_EVENT_POINT','LIGHTING','Another account synthetic event.');
  if replay->>'publicId' is null or replay->>'publicId'=event_id::text or (replay->>'replayed')::boolean is distinct from false then
    raise exception 'Operation identity crossed accounts'; end if;
  update public.network_event_policies_v2 set read_limit_minute=1 where territory_id=territory;
  rejected:=false;
  begin perform public.get_network_event_detail_v2(event_id); exception when program_limit_exceeded then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Read quota not enforced'; end if;
  update public.network_event_policies_v2 set read_limit_minute=120 where territory_id=territory;
  rejected:=false;
  begin perform public.finish_my_network_event_v2(event_id,'WITHDRAWN');
  exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Cross-owner withdrawal accepted'; end if;
  update public.network_event_policies_v2 set access_mode='PILOT' where territory_id=territory;
  rejected:=false;
  begin perform public.get_network_event_detail_v2(event_id); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Non-member pilot reader accepted'; end if;
  insert into public.network_event_members_v2(territory_id,user_id,policy_version,valid_until)
    values(territory,b,'synthetic-test',statement_timestamp()+interval '1 hour');
  if public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null) is distinct from '[]'::jsonb then
    raise exception 'Non-member pilot author exposed'; end if;
  insert into public.network_event_members_v2(territory_id,user_id,policy_version,valid_until)
    values(territory,a,'synthetic-test',statement_timestamp()+interval '1 hour');
  if jsonb_array_length(public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null)) is distinct from 1 then
    raise exception 'Authorized pilot members unavailable'; end if;
  update public.network_event_members_v2 set revoked_at=statement_timestamp() where territory_id=territory and user_id=a;
  if public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null) is distinct from '[]'::jsonb then
    raise exception 'Revoked pilot author exposed'; end if;
  update public.network_event_policies_v2 set access_mode='NETWORK' where territory_id=territory;
  insert into public.network_user_restrictions(id,user_id,restriction_type,reason_code)
    values(restriction,a,'PUBLISH_BLOCKED','synthetic-test');
  if public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null) is distinct from '[]'::jsonb then
    raise exception 'Restricted author marker exposed'; end if;
  update public.network_user_restrictions set starts_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour'
    where id=restriction and user_id=a;
  -- Synthetic expired INSERT, never mutate immutable provenance of an existing row.
  select * into strict existing from public.network_events_v2 where public_id=event_id;
  insert into public.network_events_v2(public_id,author_user_id,operation_id,request_payload,territory_id,zone_id,category_id,
    author_nickname_snapshot,description,public_position,cell_key,generalization_meters,location_policy_version,
    moderation_state,review_ref,reviewed_at,created_at,updated_at,expires_at,purge_after)
  values(expired_id,a,gen_random_uuid(),existing.request_payload,territory,zone,existing.category_id,existing.author_nickname_snapshot,
    'Synthetic expired event only.',existing.public_position,existing.cell_key,existing.generalization_meters,existing.location_policy_version,
    'APPROVED','synthetic',statement_timestamp()-interval '1 hour',statement_timestamp()-interval '2 hours',
    statement_timestamp()-interval '1 hour',statement_timestamp()-interval '1 second',statement_timestamp()+interval '1 hour');
  if jsonb_array_length(public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null)) is distinct from 1 then
    raise exception 'Expired marker exposed'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  perform public.finish_my_network_event_v2(event_id,'RESOLVED');
  perform public.finish_my_network_event_v2(event_id,'RESOLVED');
  if public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null) is distinct from '[]'::jsonb then
    raise exception 'Resolved event stayed active'; end if;
  if jsonb_array_length(public.list_network_event_markers_v2(territory,0.25,0.25,1000,'RESOLVED',null)) is distinct from 1 then
    raise exception 'Resolved event unavailable during visibility window'; end if;
  replay:=public.create_network_event_v2(operation,territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic event description only.');
  if replay->>'status' is distinct from 'RESOLVED' then raise exception 'Replay reactivated terminal event'; end if;
  perform public.finish_my_network_event_v2(event_id,'WITHDRAWN');
  if public.list_network_event_markers_v2(territory,0.25,0.25,1000,'RESOLVED',null) is distinct from '[]'::jsonb then
    raise exception 'Withdrawn marker exposed'; end if;
  rejected:=false;
  begin perform public.get_network_event_detail_v2(event_id); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Withdrawn detail exposed'; end if;
  rejected:=false;
  begin update public.network_events_v2 set description='Changed withdrawn synthetic event.' where public_id=event_id;
  exception when invalid_parameter_value then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Withdrawn content edit reactivated event'; end if;
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
  rejected:=false;
  begin perform public.list_network_event_markers_v2(territory,0.25,0.25,1000,'ACTIVE',null); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Missing identity accepted'; end if;
  if has_table_privilege('authenticated','public.network_events_v2','SELECT') is distinct from false
    or has_function_privilege('anon','public.list_network_event_markers_v2(uuid,double precision,double precision,integer,text,text)','EXECUTE') is distinct from false
    or has_function_privilege('authenticated','public.review_network_event_v2(uuid,integer,text,text)','EXECUTE') is distinct from false
    or has_function_privilege('service_role','public.review_network_event_v2(uuid,integer,text,text)','EXECUTE') is distinct from true then
    raise exception 'Privilege boundary failed'; end if;
  raise notice 'Sequential synthetic assertions completed; no concurrent PostgreSQL execution tested. ROLLBACK follows.';
end $$;
-- Effective SQL role tests, in addition to the simulated JWT identities above.
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin perform 1 from public.network_events_v2 limit 1; exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Authenticated direct table access accepted'; end if;
  rejected:=false;
  begin perform public.review_network_event_v2(null,1,'APPROVED','synthetic forbidden review');
  exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Authenticated moderation privilege accepted'; end if;
end $$;
reset role;
rollback;
