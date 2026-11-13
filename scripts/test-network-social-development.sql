-- PREPARED ONLY. Needs all three V2 migrations; never run originals inside the test.
-- New synthetic Auth rows can execute DEPLOYED triggers: external review is mandatory.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); territory uuid:=gen_random_uuid(); zone uuid:=gen_random_uuid();
  operation uuid:=gen_random_uuid(); vote_op uuid:=gen_random_uuid(); comment_op uuid:=gen_random_uuid();
  e uuid; c uuid; terms text; result jsonb; replay jsonb; data jsonb; rejected boolean;
  boundary extensions.geometry:=extensions.st_multi(extensions.st_geomfromtext('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326));
begin
  if current_user<>'postgres' or current_setting('safemelink.event_test_target',true) is distinct from 'lwkxufnbjrpsehdkfmgy'
    or current_setting('safemelink.event_test_external_review',true) is distinct from 'confirmed-no-side-effects'
    or current_setting('safemelink.social_test_review',true) is distinct from 'approved-synthetic-only' then
    raise exception 'STOP: independently verified Development and external effects review required'; end if;
  select current_terms_version into strict terms from public.network_config where singleton;
  if terms is null then raise exception 'Missing terms dependency'; end if;
  insert into auth.users(id,email,email_confirmed_at) values
    (a,'synthetic-social-'||a||'@example.invalid',statement_timestamp()),(b,'synthetic-social-'||b||'@example.invalid',statement_timestamp());
  insert into public.profiles(id) values(a),(b) on conflict(id) do nothing;
  update public.profiles set first_name='Synthetic',last_name='Fixture',nickname='Synthetic social',phone='0000000000' where id in(a,b);
  insert into public.network_preferences(user_id,network_terms_version,accepted_at) values(a,terms,statement_timestamp()),(b,terms,statement_timestamp())
    on conflict(user_id) do update set network_terms_version=excluded.network_terms_version,accepted_at=excluded.accepted_at;
  if public.network_user_is_eligible(a) is distinct from true or public.network_user_is_eligible(b) is distinct from true then
    raise exception 'Fixture eligibility incompatible'; end if;
  insert into public.network_map_territories_v2(id,code,label,boundary,geometry_source,geometry_license,geometry_version)
    values(territory,'synthetic-social-'||territory,'SYNTHETIC SOCIAL',boundary,'synthetic','test-only','test');
  insert into public.network_map_zones_v2(id,territory_id,zone_code,label,geometry) values(zone,territory,'SYNTHETIC','SYNTHETIC',boundary);
  insert into public.network_event_policies_v2(territory_id,enabled,policy_version,required_terms_version,metric_srid,precision_meters,min_cell_area_m2,
    event_ttl,resolved_ttl,record_retention,create_limit_hour,create_limit_day,read_limit_minute,privacy_approval_ref,retention_decision_ref,moderation_plan_ref)
    values(territory,true,'synthetic',terms,3857,500,10000,interval '1 hour',interval '30 minutes',interval '2 hours',20,100,120,'synthetic','synthetic','synthetic');
  insert into public.network_social_policies_v2(territory_id) values(territory);
  if (select enabled from public.network_social_policies_v2 where territory_id=territory) is distinct from false then raise exception 'Gate not OFF'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  result:=public.create_network_event_v2(operation,territory,0.25,0.25,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic social parent event.');
  e:=(result->>'publicId')::uuid;
  if e is null then raise exception 'Missing parent identity'; end if;
  perform public.review_network_event_v2(e,1,'APPROVED','synthetic parent review');
  rejected:=false;
  begin perform public.get_network_social_v2(e); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Disabled social read accepted'; end if;
  rejected:=false;
  begin update public.network_social_policies_v2 set enabled=true where territory_id=territory;
  exception when check_violation then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Incomplete social policy accepted'; end if;
  update public.network_social_policies_v2 set enabled=true,policy_version='synthetic',approval_ref='synthetic',moderation_ref='synthetic',
    retention_ref='synthetic',retain_for=interval '1 hour',writes_hour=100,writes_day=100 where territory_id=territory;
  result:=public.mutate_network_social_v2(e,vote_op,'VOTE','CONFIRMED');
  replay:=public.mutate_network_social_v2(e,vote_op,'VOTE','CONFIRMED');
  if replay->>'replayed' is distinct from 'true' or replay->>'operationId' is distinct from result->>'operationId' then raise exception 'Replay mismatch'; end if;
  rejected:=false;
  begin perform public.mutate_network_social_v2(e,vote_op,'VOTE','NO_LONGER_PRESENT'); exception when invalid_parameter_value then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Conflicting replay accepted'; end if;
  result:=public.mutate_network_social_v2(e,comment_op,'COMMENT','Synthetic moderated comment.');c:=(result->>'commentId')::uuid;
  if c is null then raise exception 'Missing comment identity'; end if;
  data:=public.get_network_social_v2(e);
  if data->>'confirmedCount' is distinct from '1' or data->'comments' is distinct from '[]'::jsonb then raise exception 'Pending comment leaked or vote lost'; end if;
  perform public.review_network_comment_v2(c,1,'APPROVED','synthetic review');
  rejected:=false;
  begin perform public.review_network_comment_v2(c,1,'APPROVED','stale synthetic review'); exception when serialization_failure then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Stale review accepted'; end if;
  data:=public.get_network_social_v2(e);
  if jsonb_array_length(data->'comments') is distinct from 1 or data->'comments'->0->>'canWithdraw' is distinct from 'true'
    or (data->'comments'->0) ? 'author_id' or (data->'comments'->0) ? 'operation_id' then raise exception 'Comment serialization invalid'; end if;
  perform public.mutate_network_social_v2(e,gen_random_uuid(),'FOLLOW','ON');
  if jsonb_array_length(public.list_network_social_activity_v2(territory,true)) is distinct from 1 then raise exception 'Follow activity absent'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.get_my_network_social_operation_v2(comment_op) is not null then raise exception 'Cross-account receipt leak'; end if;
  data:=public.get_network_social_v2(e);
  if data->>'following' is distinct from 'false' or data->'myVote' is distinct from 'null'::jsonb
    or data->'comments'->0->>'canWithdraw' is distinct from 'false' then raise exception 'Cross-account state inherited'; end if;
  perform public.remove_my_network_social_v2(e,c);
  if jsonb_array_length(public.get_network_social_v2(e)->'comments') is distinct from 1 then raise exception 'Other author withdrew comment'; end if;
  update public.network_social_policies_v2 set writes_hour=1,writes_day=1 where territory_id=territory;
  perform public.mutate_network_social_v2(e,gen_random_uuid(),'VOTE','CONFIRMED');
  rejected:=false;
  begin perform public.mutate_network_social_v2(e,gen_random_uuid(),'FOLLOW','ON'); exception when program_limit_exceeded then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Social quota exceeded'; end if;
  update public.network_social_policies_v2 set writes_hour=100,writes_day=100 where territory_id=territory;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  perform public.remove_my_network_social_v2(e,c);
  if public.get_network_social_v2(e)->'comments' is distinct from '[]'::jsonb then raise exception 'Withdrawn comment visible'; end if;
  rejected:=false;
  begin perform public.review_network_comment_v2(c,3,'APPROVED','synthetic invalid resurrection'); exception when invalid_parameter_value then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Withdrawn comment resurrected'; end if;
  result:=public.mutate_network_social_v2(e,gen_random_uuid(),'COMMENT','Synthetic expiring comment.');
  perform public.review_network_comment_v2((result->>'commentId')::uuid,1,'APPROVED','synthetic expiry review');
  update public.network_social_comments_v2 set valid_until=statement_timestamp()-interval '1 second' where public_id=(result->>'commentId')::uuid;
  if public.get_network_social_v2(e)->'comments' is distinct from '[]'::jsonb then raise exception 'Expired comment exposed'; end if;
  perform public.finish_my_network_event_v2(e,'RESOLVED');
  rejected:=false;
  begin perform public.mutate_network_social_v2(e,gen_random_uuid(),'COMMENT','Synthetic closed event.'); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Resolved event accepted new comment'; end if;
  perform public.finish_my_network_event_v2(e,'WITHDRAWN');
  rejected:=false;
  begin perform public.get_network_social_v2(e); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Hidden parent leaked social'; end if;
  update public.network_social_policies_v2 set enabled=false where territory_id=territory;
  perform public.remove_my_network_social_v2(e,null);
  if exists(select 1 from public.network_social_follows_v2 where event_id=e and user_id=a) then raise exception 'Cleanup blocked by gate'; end if;
  if public.get_my_network_social_operation_v2(comment_op)->>'commentId' is distinct from c::text then raise exception 'Own receipt recovery absent'; end if;
  raise notice 'Sequential social assertions completed; actual JWT/concurrency not tested. ROLLBACK follows.';
end $$;
set local role authenticated;
do $$ declare rejected boolean:=false; begin
  begin perform 1 from public.network_social_comments_v2 limit 1; exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Direct social table access allowed'; end if;
  if has_function_privilege(current_user,'public.review_network_comment_v2(uuid,integer,text,text)','EXECUTE') is distinct from false then
    raise exception 'Client moderation execution allowed'; end if;
end $$;
reset role;
set local role anon;
do $$ declare rejected boolean:=false; begin
  begin perform public.get_network_social_v2(gen_random_uuid()); exception when insufficient_privilege then rejected:=true; end;
  if rejected is distinct from true then raise exception 'Anonymous social access allowed'; end if;
end $$;
reset role;
rollback;
