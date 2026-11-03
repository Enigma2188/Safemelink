-- PREPARED ONLY. Requires separate Development authorization and applied V2 draft.
-- Verify Dashboard/API identity lwkxufnbjrpsehdkfmgy AND deployed fixture-table triggers.
-- Executor must attest both checks in THIS connection before running the full file:
-- SET safemelink.network_test_project_ref = 'lwkxufnbjrpsehdkfmgy';
-- SET safemelink.network_test_triggers_reviewed = 'yes';
-- These attestations are NOT independent proof of identity or external-worker safety.
-- One connection; only random synthetic accounts/reports/territories; final ROLLBACK.
-- No Auth HTTP signup, recipients, SOS, SMS, push, scheduler or outbound HTTP calls.
begin;
set local statement_timeout='30s';
set local lock_timeout='2s';
set local timezone='UTC';
do $test$
declare
  territory uuid := gen_random_uuid();
  other_territory uuid := gen_random_uuid();
  zone_a uuid := gen_random_uuid();
  zone_b uuid := gen_random_uuid();
  other_zone uuid := gen_random_uuid();
  second_level_zone uuid := gen_random_uuid();
  publication uuid := gen_random_uuid();
  bad_publication uuid := gen_random_uuid();
  actors uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  reports uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  history uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  boundary extensions.geometry := extensions.st_multi(extensions.st_geomfromtext('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326));
  coords double precision[] := array[0.25,0.5,0.75,0.25,0.25];
  terms text;
  result jsonb;
  next_page jsonb;
  cursor_data jsonb;
  i integer;
  rejected boolean := false;
  table_name text;
begin
  if current_user <> 'postgres' then raise exception 'Expected controlled administrator session'; end if;
  if current_setting('safemelink.network_test_project_ref',true) IS DISTINCT FROM 'lwkxufnbjrpsehdkfmgy'
    or current_setting('safemelink.network_test_triggers_reviewed',true) IS DISTINCT FROM 'yes' then
    raise exception 'STOP: independently verify Development and deployed fixture-table triggers'; end if;
  select current_terms_version into terms from public.network_config where singleton;
  if terms is null then raise exception 'Missing legacy NETWORK configuration'; end if;
  -- Synthetic geometry is NOT a real municipal dataset. No real source rows are selected.
  insert into public.network_map_territories_v2(id,code,label,boundary,geometry_source,geometry_license,geometry_version)
  values(territory,'synthetic-'||territory,'SYNTHETIC',boundary,'synthetic','test-only','test'),
    (other_territory,'synthetic-'||other_territory,'SYNTHETIC OTHER',boundary,'synthetic','test-only','test');
  if (select enabled from public.network_map_territories_v2 where id=territory) IS DISTINCT FROM false then
    raise exception 'Default gate must be OFF'; end if;
  begin
    update public.network_map_territories_v2 set enabled=true where id=territory;
  exception when check_violation then rejected:=true; end;
  if rejected IS DISTINCT FROM true then raise exception 'NULL/incomplete policy must fail closed'; end if;
  rejected:=false;
  -- No authenticated identity: even a known territory UUID grants nothing.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.get_network_territory_context_v2(territory);
  exception when insufficient_privilege then rejected:=true; end;
  if rejected IS DISTINCT FROM true then raise exception 'Anonymous application identity accepted'; end if;
  insert into public.network_map_zones_v2(id,territory_id,zone_code,label,geometry) values
    (zone_a,territory,'A','SYNTHETIC A',extensions.st_multi(extensions.st_geomfromtext('POLYGON((0 0,0 1,0.5 1,0.5 0,0 0))',4326))),
    (zone_b,territory,'B','SYNTHETIC B',extensions.st_multi(extensions.st_geomfromtext('POLYGON((0.5 0,0.5 1,1 1,1 0,0.5 0))',4326))),
    (other_zone,other_territory,'A','SYNTHETIC OTHER',boundary);
  insert into public.network_map_zones_v2(id,territory_id,level_code,zone_code,label,geometry)
    values(second_level_zone,territory,'COARSE','A','SYNTHETIC COARSE',boundary);
  insert into public.network_map_publications_v2(id,territory_id,zone_id,policy_version,period_start,
    period_end,report_count,contributor_count,state,disclosure_review_ref,reviewed_at,valid_until)
  values(publication,territory,zone_a,'test','2026-09-01','2026-10-01',2,2,'APPROVED',
    'synthetic review',now(),now()+interval '1 hour');
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then
    raise exception 'OFF territory unexpectedly publishes'; end if;
  -- Deliberately invalid claimed counts: even reviewed rows must have real matching links.
  update public.network_map_territories_v2 set policy_version='test',controller_approval_ref='synthetic',
    retention_decision_ref='synthetic',privacy_review_ref='synthetic',min_reports=2,min_contributors=2,
    low_max=2,medium_max=4,snapshot_ttl=interval '1 hour',period_kind='MONTH',enabled=true
    where id in (territory,other_territory);
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then
    raise exception 'Fabricated counts without source links accepted'; end if;
  if public.network_map_publication_safe_v2(gen_random_uuid()) IS DISTINCT FROM false then
    raise exception 'Missing publication accepted'; end if;
  -- Auth INSERT only, not signup: reviewed repository trigger bootstraps private profile/Radar defaults.
  for i in 1..3 loop
    insert into auth.users(id,email,email_confirmed_at)
    values(actors[i],'network-v2-'||actors[i]||'@example.invalid',now());
    insert into public.profiles(id) values(actors[i]) on conflict(id) do nothing;
    update public.profiles set first_name='Synthetic',last_name='Fixture',nickname='Synthetic fixture',phone='0000000000'
      where id=actors[i];
    insert into public.network_preferences(user_id,network_terms_version,accepted_at)
      values(actors[i],terms,now());
  end loop;
  insert into public.network_map_members_v2(territory_id,user_id,policy_version,valid_until)
    values(territory,actors[1],'test',now()+interval '1 hour');
  for i in 1..5 loop
    insert into public.network_reports(id,author_user_id,author_nickname_snapshot,category,description,
      status,moderation_state,location,public_cell_id,public_location,created_at,updated_at,last_activity_at,expires_at,resolved_at)
    values(reports[i],case when i=4 then actors[2] else actors[1+(i%2)] end,
      'Synthetic fixture','URBAN_HAZARD','Synthetic fixture only',
      'RESOLVED','VISIBLE',
      extensions.st_setsrid(extensions.st_makepoint(coords[i],0.5),4326)::extensions.geography,
      'synthetic-only',extensions.st_setsrid(extensions.st_makepoint(coords[i],0.5),4326)::extensions.geography,
      case when i=4 then '2026-08-15'::timestamptz else '2026-09-15'::timestamptz end,
      now(),now(),'2026-10-01'::timestamptz,'2026-10-01'::timestamptz);
    insert into public.network_map_sources_v2(report_id,territory_id,policy_version,inclusion_review_ref)
      values(reports[i],territory,'test','synthetic inclusion');
  end loop;
  insert into public.network_map_publication_sources_v2(publication_id,report_id)
    values(publication,reports[1]),(publication,reports[2]);
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM true then
    raise exception 'POSITIVE: valid publication rejected'; end if;
  -- Isolate wrong-zone/time guards without changing the expected distinct-author count.
  update public.network_map_publication_sources_v2 set report_id=reports[3]
    where publication_id=publication and report_id=reports[1];
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then
    raise exception 'Wrong-zone source accepted in cohort'; end if;
  update public.network_map_publication_sources_v2 set report_id=reports[4]
    where publication_id=publication and report_id=reports[3];
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then
    raise exception 'Wrong-period source accepted in cohort'; end if;
  update public.network_map_publication_sources_v2 set report_id=reports[1]
    where publication_id=publication and report_id=reports[4];
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM true then
    raise exception 'Restored synthetic cohort rejected'; end if;
  if public.network_map_canonical_zone_v2(territory,reports[2]) IS DISTINCT FROM zone_a then
    raise exception 'Shared-edge assignment not canonical'; end if;
  if public.network_map_canonical_zone_v2(territory,reports[2],'COARSE') IS DISTINCT FROM second_level_zone then
    raise exception 'Canonical assignment mixed geographic levels'; end if;
  if (select report_count from public.network_map_candidates_v2(territory,'2026-09-01') where zone_id=zone_a)
    IS DISTINCT FROM 3::bigint then raise exception 'Candidate canonical count incorrect'; end if;
  if (select sum(report_count) from public.network_map_candidates_v2(territory,'2026-09-01'))
    IS DISTINCT FROM 4::numeric then raise exception 'Boundary source counted twice or wrong period included'; end if;
  -- Same shared-edge source cannot justify a publication of zone B.
  insert into public.network_map_publications_v2(id,territory_id,zone_id,policy_version,period_start,period_end,
    report_count,contributor_count,state,disclosure_review_ref,reviewed_at,valid_until)
    values(bad_publication,territory,zone_b,'test','2026-09-01','2026-10-01',2,2,'APPROVED','synthetic',now(),now()+interval '1 hour');
  insert into public.network_map_publication_sources_v2(publication_id,report_id)
    values(bad_publication,reports[2]),(bad_publication,reports[3]);
  if public.network_map_publication_safe_v2(bad_publication) IS DISTINCT FROM false then
    raise exception 'Noncanonical boundary publication accepted'; end if;
  update public.network_map_publications_v2 set state='WITHDRAWN' where id=bad_publication;
  -- Valid entries 1/2; wrong zone 3; wrong period 4; same-zone/period but extraneous cohort 5.
  for i in 1..5 loop
    insert into public.network_history_entries_v2(id,territory_id,zone_id,source_report_id,policy_version,
      category,public_month,summary,state,disclosure_review_ref,reviewed_at,valid_until)
    values(history[i],territory,zone_a,reports[i],'test','URBAN_HAZARD','2026-09-01',
      'Synthetic reviewed summary','APPROVED','synthetic review',now(),now()+interval '1 hour');
  end loop;
  -- More than 100 newer drafts must NOT hide older valid entries.
  insert into public.network_history_entries_v2(territory_id,zone_id,source_report_id,policy_version,
    category,public_month,summary,valid_until)
    select territory,zone_a,reports[1],'test','URBAN_HAZARD','2026-10-01',
      'Synthetic draft summary',now()+interval '1 hour' from generate_series(1,101);
  perform set_config('request.jwt.claim.sub',actors[1]::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actors[1],'role','authenticated')::text,true);
  -- Real DB client role for positive reads; no direct private-table access used below.
  execute 'set local role authenticated';
  result:=public.list_network_map_cells_v2(territory);
  if jsonb_array_length(result->'zones') IS DISTINCT FROM 2 then raise exception 'Authorized zone read failed'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'zones') z
    where z->>'zoneId'=zone_a::text and z->>'availability'='PUBLISHED') then
    raise exception 'Valid zone not published'; end if;
  result:=public.list_network_zone_history_v2(territory,zone_a);
  if jsonb_array_length(result->'entries') IS DISTINCT FROM 2 then
    raise exception 'History cohort/zone/period filtering or pre-limit filtering failed'; end if;
  if exists(select 1 from jsonb_array_elements(result->'entries') e
    where (e->>'entryId')::uuid not in (history[1],history[2])) then raise exception 'Foreign history leaked'; end if;
  result:=public.list_network_zone_history_v2(territory,zone_a,1);
  cursor_data:=result->'nextCursor';
  if cursor_data is null or cursor_data='null'::jsonb then raise exception 'Missing stable cursor'; end if;
  next_page:=public.list_network_zone_history_v2(territory,zone_a,1,(cursor_data->>'month')::date,(cursor_data->>'entryId')::uuid);
  if jsonb_array_length(next_page->'entries') IS DISTINCT FROM 1
    or next_page->'entries'->0->>'entryId'=result->'entries'->0->>'entryId' then
    raise exception 'Pagination duplicate/missing entry'; end if;
  rejected:=false;
  begin perform public.get_network_territory_context_v2(other_territory);
  exception when insufficient_privilege then rejected:=true; end;
  if rejected IS DISTINCT FROM true then raise exception 'Foreign territory access accepted'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',actors[3]::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actors[3],'role','authenticated')::text,true);
  execute 'set local role authenticated';
  rejected:=false;
  begin perform public.list_network_map_cells_v2(territory);
  exception when insufficient_privilege then rejected:=true; end;
  if rejected IS DISTINCT FROM true then raise exception 'Nonpilot account accepted'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',actors[1]::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actors[1],'role','authenticated')::text,true);
  update public.network_map_members_v2 set revoked_at=now() where territory_id=territory and user_id=actors[1];
  execute 'set local role authenticated';
  rejected:=false;
  begin perform public.list_network_zone_history_v2(territory,zone_a);
  exception when insufficient_privilege then rejected:=true; end;
  if rejected IS DISTINCT FROM true then raise exception 'Revoked pilot member accepted'; end if;
  execute 'reset role';
  update public.network_map_members_v2 set revoked_at=null where territory_id=territory and user_id=actors[1];
  update public.network_map_sources_v2 set revoked_at=now() where report_id=reports[1];
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then raise exception 'Revoked source published'; end if;
  result:=public.list_network_zone_history_v2(territory,zone_a);
  if jsonb_array_length(result->'entries') IS DISTINCT FROM 0 then raise exception 'History survives cohort revocation'; end if;
  update public.network_map_sources_v2 set revoked_at=null where report_id=reports[1];
  update public.network_reports set moderation_state='LIMITED' where id=reports[1];
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then raise exception 'Limited report published'; end if;
  update public.network_reports set moderation_state='VISIBLE' where id=reports[1];
  update public.network_map_sources_v2 set territory_id=other_territory where report_id=reports[1];
  if public.network_map_publication_safe_v2(publication) IS DISTINCT FROM false then raise exception 'Foreign territory source published'; end if;
  update public.network_map_sources_v2 set territory_id=territory where report_id=reports[1];
  -- Content changes cannot retain old approval even if caller tries APPROVED in same UPDATE.
  update public.network_history_entries_v2 set summary='Synthetic corrected summary',state='APPROVED' where id=history[1];
  if not exists(select 1 from public.network_history_entries_v2 where id=history[1]
    and state='DRAFT' and revision=2 and reviewed_at is null and disclosure_review_ref is null) then
    raise exception 'Content correction preserved stale approval'; end if;
  result:=public.list_network_zone_history_v2(territory,zone_a);
  if jsonb_array_length(result->'entries') IS DISTINCT FROM 1 then raise exception 'Draft correction leaked'; end if;
  update public.network_history_entries_v2 set state='APPROVED',reviewed_at=now(),disclosure_review_ref='new synthetic review'
    where id=history[1];
  result:=public.list_network_zone_history_v2(territory,zone_a);
  if jsonb_array_length(result->'entries') IS DISTINCT FROM 2 then raise exception 'Explicit reapproval failed'; end if;
  update public.network_history_entries_v2 set state='WITHDRAWN' where id=history[1];
  result:=public.list_network_zone_history_v2(territory,zone_a);
  if jsonb_array_length(result->'entries') IS DISTINCT FROM 1 then raise exception 'Withdrawn history leaked'; end if;
  foreach table_name in array array['network_map_territories_v2','network_map_zones_v2',
    'network_map_members_v2','network_map_sources_v2','network_map_publications_v2',
    'network_map_publication_sources_v2','network_history_entries_v2'] loop
    if has_table_privilege('authenticated','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('anon','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Direct access leaked: %',table_name; end if;
  end loop;
  if has_function_privilege('authenticated','public.network_map_candidates_v2(uuid,date,text)','EXECUTE')
    or has_function_privilege('authenticated','public.network_map_canonical_zone_v2(uuid,uuid,text)','EXECUTE') then
    raise exception 'Private candidate count access leaked'; end if;
  raise notice 'Synthetic positive/negative assertions passed; transaction will rollback';
end;
$test$;
rollback;
