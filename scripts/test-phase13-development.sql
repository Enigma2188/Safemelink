-- MUTATING, REVERSIBLE: AFTER both migrations, one SQL Editor connection.
-- No migration DDL embedded. No delivery/HTTP/SMS/push functions invoked.
-- Default BLOCKED. Edit the two attestations ONLY after external identity and
-- worker/scheduler/consumer inactivity checks. They are not proof by themselves.
begin;
set local statement_timeout='30s';
do $$ declare verified_ref text := null; workers_stopped boolean := false;
begin
  if verified_ref is distinct from 'lwkxufnbjrpsehdkfmgy' or workers_stopped is distinct from true then
    raise exception 'BLOCKED: external Development identity/worker verification required';
  end if;
  if to_regclass('public.safemelink_phase13_fixture') is not null then raise exception 'Residual concurrency fixture'; end if;
end $$;
create temporary table phase13_ids(owner_id uuid, trusted_id uuid, outsider_id uuid, sos_id uuid) on commit drop;
insert into pg_temp.phase13_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select x.actor_id,'phase13-'||x.actor_id::text||'@example.invalid'
from pg_temp.phase13_ids as f cross join lateral (values(f.owner_id),(f.trusted_id),(f.outsider_id)) as x(actor_id);
insert into public.profiles(id) select x.actor_id from pg_temp.phase13_ids as f
cross join lateral (values(f.owner_id),(f.trusted_id),(f.outsider_id)) as x(actor_id) on conflict(id) do nothing;
insert into public.trusted_contacts(user_id,name,phone,priority,linked_profile_id)
select f.owner_id,'Synthetic Phase13',null,1,f.trusted_id from pg_temp.phase13_ids as f;
insert into public.sos(id,user_id,latitude,longitude,accuracy,location_updated_at)
select f.sos_id,f.owner_id,1,2,10,now()-interval '1 minute' from pg_temp.phase13_ids as f;
insert into public.nearby_alerts(sos_id,source_user_id,nearby_user_id,distance_meters)
select f.sos_id,f.owner_id,f.outsider_id,50 from pg_temp.phase13_ids as f;
do $$ declare f record; result_value text; b boolean; j jsonb; before_row public.sos%rowtype;
begin
  select x.* into strict f from pg_temp.phase13_ids as x;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  result_value:=public.update_my_active_sos_location_result(f.sos_id,3,4,20,now()-interval '30 seconds');
  if result_value is distinct from 'updated' then raise exception 'GPS new update failed'; end if;
  result_value:=public.update_my_active_sos_location_result(f.sos_id,9,9,1,now()-interval '45 seconds');
  if result_value is distinct from 'stale' then raise exception 'GPS older update not rejected'; end if;
  b:=public.update_my_active_sos_location(f.sos_id,9,9,1,now()-interval '30 seconds');
  if b is distinct from true then raise exception 'Legacy stale fix stopped tracking'; end if;
  begin
    perform public.update_my_active_sos_location_result(f.sos_id,1,2,10,now()+interval '3 minutes');
    raise exception 'Future bound accepted';
  exception when invalid_parameter_value then null; end;
  result_value:=public.update_my_active_sos_location_result(f.sos_id,5,6,15,now()+interval '1 minute');
  if result_value is distinct from 'updated' then raise exception 'Allowed clock skew not accepted'; end if;
  result_value:=public.update_my_active_sos_location_result(f.sos_id,7,8,15,now());
  if result_value is distinct from 'stale' then raise exception 'Clock skew ordering changed'; end if;
  j:=public.get_my_emergency_private_details(f.owner_id);
  if j is not null then raise exception 'New fixture unexpectedly has private data'; end if;
  j:=public.update_my_emergency_private_details(f.owner_id,'Synthetic ICE','Synthetic relation','+3900000000',
    'Synthetic private declaration',null,null,'Synthetic instruction',false,false,false);
  if (j->>'share_ice')::boolean is distinct from false or (j->>'share_ice_phone')::boolean is distinct from false
    or (j->>'share_safety')::boolean is distinct from false then raise exception 'Defaults/private save wrong'; end if;
  begin
    perform public.get_my_emergency_private_details(f.trusted_id); raise exception 'Owner spoof accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_my_emergency_private_details(f.owner_id,'Synthetic ICE',null,null,null,null,null,null,false,true,false);
    raise exception 'Phone consent without ICE accepted';
  exception when check_violation then null; end;
  reset role;
  select s.* into strict before_row from public.sos as s where s.id=f.sos_id;
  if before_row.latitude is distinct from 5::double precision or before_row.longitude is distinct from 6::double precision
    or before_row.accuracy is distinct from 15::double precision then raise exception 'Coordinates not atomic'; end if;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  if public.get_received_sos_private_details(f.sos_id) is not null then raise exception 'Private data disclosed'; end if;
  reset role;
  update public.emergency_private_details as d set share_ice=true where d.user_id=f.owner_id;
  set local role authenticated;
  j:=public.get_received_sos_private_details(f.sos_id);
  if j is null or j->>'ice_name' is distinct from 'Synthetic ICE' or j->>'ice_phone' is not null
    or j->>'stalking' is not null then raise exception 'ICE redaction failed'; end if;
  reset role;
  update public.emergency_private_details as d set share_ice_phone=true,share_safety=true where d.user_id=f.owner_id;
  set local role authenticated;
  j:=public.get_received_sos_private_details(f.sos_id);
  if j is null or j->>'ice_phone' is distinct from '+3900000000'
    or j->>'stalking' is distinct from 'Synthetic private declaration' then raise exception 'Explicit disclosure missing'; end if;
  begin perform 1 from public.emergency_private_details; raise exception 'Direct table access permitted';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub',f.outsider_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.outsider_id,'role','authenticated')::text,true);
  set local role authenticated;
  if public.get_received_sos_private_details(f.sos_id) is not null then raise exception 'Nearby outsider disclosed'; end if;
  b:=public.update_my_active_sos_location(f.sos_id,1,2,10,now());
  if b is distinct from false then raise exception 'Legacy foreign SOS semantics changed'; end if;
  begin perform public.update_my_active_sos_location_result(f.sos_id,1,2,10,now()); raise exception 'Foreign GPS writer permitted';
  exception when insufficient_privilege then null; end;
  reset role;
  insert into public.emergency_profiles(user_id,ice_contact,share_ice_contact_during_sos)
    values(f.owner_id,'Synthetic legacy +3900000000',true);
  update public.emergency_private_details as d set share_ice=false,share_ice_phone=false,share_safety=false where d.user_id=f.owner_id;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  if public.get_received_sos_private_details(f.sos_id) is not null then raise exception 'Revocation not effective'; end if;
  select to_jsonb(p) into strict j from public.get_received_sos_emergency_profile(f.sos_id) as p;
  if j->>'ice_contact' is distinct from 'Synthetic legacy +3900000000' then raise exception 'Legacy contract unexpectedly changed'; end if;
  reset role;
  update public.sos as s set status='closed',closed_at=now() where s.id=f.sos_id;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if public.update_my_active_sos_location_result(f.sos_id,1,2,10,now()) is distinct from 'inactive' then raise exception 'Closed SOS updated'; end if;
  perform public.delete_my_emergency_private_details(f.owner_id);
  if public.get_my_emergency_private_details(f.owner_id) is not null then raise exception 'Deletion failed'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  set local role authenticated;
  if public.get_received_sos_private_details(f.sos_id) is not null then raise exception 'Closed disclosure'; end if;
  reset role;
  set local role anon;
  begin perform public.get_received_sos_private_details(f.sos_id); raise exception 'Anonymous EXECUTE permitted';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS Phase13 transactional assertions; concurrency NOT tested by this script';
end $$;
rollback;
