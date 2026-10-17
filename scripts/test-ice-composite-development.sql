-- MUTATING / REVERSIBLE, AFTER Phase12 + Phase14 migrations. NOT EXECUTED.
-- One connection. Synthetic fixtures only. Includes transactional trigger DDL:
-- use ONLY quiet Development after reviewing triggers and stopping workers.
-- Edit attestations only after external project identity/host checks.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
do $$ declare verified_ref text:=null; workers_stopped boolean:=false;
begin
  if verified_ref is distinct from 'lwkxufnbjrpsehdkfmgy' or workers_stopped is distinct from true then
    raise exception 'BLOCKED: external Development/worker checks required';
  end if;
end $$;
create temporary table phase14_ids(owner_id uuid,trusted_id uuid,sos_id uuid) on commit drop;
insert into pg_temp.phase14_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select v.actor_id,'phase14-'||v.actor_id::text||'@example.invalid'
from pg_temp.phase14_ids as f cross join lateral(values(f.owner_id),(f.trusted_id)) as v(actor_id);
insert into public.profiles(id) select v.actor_id from pg_temp.phase14_ids as f
cross join lateral(values(f.owner_id),(f.trusted_id)) as v(actor_id) on conflict(id) do nothing;
insert into public.trusted_contacts(user_id,name,phone,priority,linked_profile_id)
select f.owner_id,'Synthetic ICE test',null,1,f.trusted_id from pg_temp.phase14_ids as f;
insert into public.sos(id,user_id,latitude,longitude,accuracy)
select f.sos_id,f.owner_id,1,2,10 from pg_temp.phase14_ids as f;
insert into public.emergency_profiles(user_id,ice_contact,share_ice_contact_during_sos,share_medical_data_during_sos)
select f.owner_id,'Synthetic legacy ICE',true,true from pg_temp.phase14_ids as f;
insert into public.emergency_private_details(user_id,ice_name,ice_phone,stalking,share_ice,share_ice_phone,share_safety)
select f.owner_id,'Synthetic ICE','+3900000000','Synthetic safety declaration',true,true,true from pg_temp.phase14_ids as f;
do $$ declare f record; j jsonb;
begin
  select x.* into strict f from pg_temp.phase14_ids as x;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  j:=public.revoke_my_all_ice_sharing(f.owner_id);
  if j is null or j->>'owner_id' is distinct from f.owner_id::text or (j->>'legacy_shared')::boolean is distinct from false
    or (j->>'structured_shared')::boolean is distinct from false or (j->>'phone_shared')::boolean is distinct from false
    or (j->>'safety_shared')::boolean is distinct from true then raise exception 'Revocation result wrong'; end if;
  reset role;
  if not exists(select 1 from public.emergency_profiles as e where e.user_id=f.owner_id and e.ice_contact='Synthetic legacy ICE' and e.share_medical_data_during_sos)
    or not exists(select 1 from public.emergency_private_details as d where d.user_id=f.owner_id and d.ice_name='Synthetic ICE'
      and d.ice_phone='+3900000000' and d.stalking='Synthetic safety declaration') then raise exception 'Values erased'; end if;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  j:=public.get_received_sos_private_details(f.sos_id);
  if j is null or j->>'ice_phone' is not null or j->>'ice_name' is not null
    or j->>'stalking' is distinct from 'Synthetic safety declaration' then raise exception 'Shared data not redacted'; end if;
  begin perform public.revoke_my_all_ice_sharing(f.owner_id); raise exception 'Cross-account revoke permitted';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic legacy ICE',null,true,true);
  j:=public.get_my_ice_privacy_status(f.owner_id);
  if (j->>'legacy_shared')::boolean is distinct from true then raise exception 'Legacy writer contract changed unexpectedly'; end if;
  reset role;
  update public.emergency_private_details as d set share_ice=true,share_ice_phone=true where d.user_id=f.owner_id;
  perform set_config('app.phase14_owner',f.owner_id::text,true);
end $$;
-- Force an error on the SECOND update to prove the first update rolls back too.
create function pg_temp.phase14_reject_update() returns trigger language plpgsql as $$
begin
  if new.user_id::text=current_setting('app.phase14_owner',true) then
    raise exception 'Synthetic second-update rejection' using errcode='23514';
  end if;
  return new;
end $$;
create trigger phase14_synthetic_rejection before update on public.emergency_private_details
for each row execute function pg_temp.phase14_reject_update();
do $$ declare f record;
begin
  select x.* into strict f from pg_temp.phase14_ids as x;
  set local role authenticated;
  begin perform public.revoke_my_all_ice_sharing(f.owner_id); raise exception 'Injected failure missing';
  exception when check_violation then null; end;
  reset role;
  if not exists(select 1 from public.emergency_profiles as e where e.user_id=f.owner_id and e.share_ice_contact_during_sos)
    or not exists(select 1 from public.emergency_private_details as d where d.user_id=f.owner_id and d.share_ice and d.share_ice_phone)
    then raise exception 'Partial revocation survived exception'; end if;
  set local role anon;
  begin perform public.get_my_ice_privacy_status(f.owner_id); raise exception 'Anonymous status permitted';
  exception when insufficient_privilege then null; end;
  reset role;
  update public.sos as s set status='closed',closed_at=now() where s.id=f.sos_id;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  if public.get_received_sos_private_details(f.sos_id) is not null then raise exception 'Closed SOS disclosure'; end if;
  reset role;
  raise notice 'PASS Phase14 transactional assertions. Legacy reactivation remains intentionally possible. Concurrency NOT tested.';
end $$;
rollback;
