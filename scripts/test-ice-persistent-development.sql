-- MUTATING / REVERSIBLE. AFTER Phase15; one connection; NOT EXECUTED.
-- Phase14/13 tests that EXPECT legacy reactivation are historical, not Phase15 gates.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
do $$ declare verified_ref text:=null; workers_stopped boolean:=false;
begin
  if verified_ref is distinct from 'lwkxufnbjrpsehdkfmgy' or workers_stopped is distinct from true then
    raise exception 'BLOCKED: external Development identity, drained transactions and inactive workers required';
  end if;
end $$;
create temporary table ice15_ids(owner_id uuid,trusted_id uuid,sos_id uuid) on commit drop;
insert into pg_temp.ice15_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select v.actor_id,'ice15-'||v.actor_id::text||'@example.invalid'
from pg_temp.ice15_ids as f cross join lateral(values(f.owner_id),(f.trusted_id)) as v(actor_id);
insert into public.profiles(id) select v.actor_id from pg_temp.ice15_ids as f
cross join lateral(values(f.owner_id),(f.trusted_id)) as v(actor_id) on conflict(id) do nothing;
insert into public.trusted_contacts(user_id,name,phone,priority,linked_profile_id)
select f.owner_id,'Synthetic ICE',null,1,f.trusted_id from pg_temp.ice15_ids as f;
insert into public.sos(id,user_id,latitude,longitude,accuracy) select f.sos_id,f.owner_id,1,2,10 from pg_temp.ice15_ids as f;
insert into public.emergency_profiles(user_id,ice_contact,share_ice_contact_during_sos,share_medical_data_during_sos)
select f.owner_id,'Synthetic legacy',true,true from pg_temp.ice15_ids as f;
insert into public.emergency_private_details(user_id,ice_name,ice_phone,stalking,share_ice,share_ice_phone,share_safety)
select f.owner_id,'Synthetic ICE','+3900000000','Synthetic safety',true,true,true from pg_temp.ice15_ids as f;
do $$ declare f record; j jsonb; revision_value bigint;
begin
  select x.* into strict f from pg_temp.ice15_ids as x;
  -- Prove recipient access works before revocation, not just an always-empty RPC.
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  if not exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id) as p where p.ice_contact='Synthetic legacy' and p.ice_contact_shared) then raise exception 'Positive legacy access missing'; end if;
  j:=public.get_received_sos_private_details(f.sos_id);
  if j is null or j->>'ice_name' is distinct from 'Synthetic ICE' or (j->>'share_ice_phone')::boolean is distinct from true then raise exception 'Positive advanced access missing'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  j:=public.revoke_my_all_ice_sharing(f.owner_id);
  if j is null or (j->>'ice_blocked')::boolean is distinct from true or (j->>'legacy_shared')::boolean is distinct from false
    or (j->>'structured_shared')::boolean is distinct from false or (j->>'phone_shared')::boolean is distinct from false
    then raise exception 'Persistent revocation missing'; end if;
  revision_value:=(j->>'ice_revision')::bigint;
  if revision_value is null or revision_value<1 then raise exception 'Missing revision'; end if;
  begin perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic changed text',null,true,true);
    raise exception 'Legacy reactivation bypass'; exception when insufficient_privilege then null; end;
  begin perform public._ice15_update_legacy(null,null,null,null,null,'Synthetic changed text',null,true,true);
    raise exception 'Internal helper accessible'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.ice_privacy_control;
    raise exception 'Direct control access'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.emergency_profiles;
    raise exception 'Direct legacy access'; exception when insufficient_privilege then null; end;
  begin perform public.confirm_my_ice_sharing(f.owner_id,revision_value-1,'ICE_V1',true,false,false);
    raise exception 'Stale explicit consent accepted'; exception when serialization_failure then null; end;
  j:=public.confirm_my_ice_sharing(f.owner_id,revision_value,'ICE_V1',false,true,false);
  if (j->>'ice_blocked')::boolean is distinct from false or (j->>'structured_shared')::boolean is distinct from true
    or (j->>'legacy_shared')::boolean is distinct from false or (j->>'phone_shared')::boolean is distinct from false then
    raise exception 'Explicit channel scope failed'; end if;
  begin perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic legacy',null,true,true);
    raise exception 'Structured consent enabled legacy'; exception when insufficient_privilege then null; end;
  begin perform public.update_my_emergency_private_details(f.owner_id,'Synthetic ICE',null,'+3900000000','Synthetic safety',null,null,null,true,true,true);
    raise exception 'Structured consent enabled phone'; exception when insufficient_privilege then null; end;
  perform public.revoke_my_all_ice_sharing(f.owner_id);
  perform public.delete_my_emergency_private_details(f.owner_id);
  j:=public.get_my_ice_privacy_status(f.owner_id);
  if (j->>'ice_blocked')::boolean is distinct from true then raise exception 'Delete cleared block'; end if;
  perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic retained text',null,true,false);
  reset role;
  if not exists(select 1 from public.emergency_profiles as e where e.user_id=f.owner_id and e.ice_contact='Synthetic retained text') then
    raise exception 'Private text edit lost'; end if;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id) as p where p.ice_contact is not null or p.ice_contact_shared) then raise exception 'Legacy disclosure after block'; end if;
  if public.get_received_sos_private_details(f.sos_id) is not null then raise exception 'Advanced disclosure after block'; end if;
  begin perform public.confirm_my_ice_sharing(f.owner_id,0,'ICE_V1',true,false,false);
    raise exception 'Other account consent accepted'; exception when insufficient_privilege then null; end;
  reset role;
  update public.sos as s set status='closed',closed_at=now() where s.id=f.sos_id;
  set local role authenticated;
  if exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id)) then raise exception 'Closed disclosure'; end if;
  reset role;
  -- Prepare a SECOND-update rejection to test rollback of the persistent state too.
  insert into public.emergency_private_details(user_id,ice_name) values(f.owner_id,'Synthetic ICE');
  perform set_config('app.ice15_owner',f.owner_id::text,true);
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
end $$;
create function pg_temp.ice15_reject() returns trigger language plpgsql as $$
begin
  if new.user_id::text=current_setting('app.ice15_owner',true) then raise exception 'Synthetic rejection' using errcode='23514'; end if;
  return new;
end $$;
create trigger ice15_synthetic_reject before update on public.emergency_private_details for each row execute function pg_temp.ice15_reject();
do $$ declare f record; before_value jsonb; after_value jsonb;
begin
  select x.* into strict f from pg_temp.ice15_ids as x;
  set local role authenticated;
  before_value:=public.get_my_ice_privacy_status(f.owner_id);
  if before_value is null or before_value->>'ice_revision' is null or (before_value->>'ice_blocked')::boolean is distinct from true then raise exception 'Missing baseline for rollback test'; end if;
  begin perform public.revoke_my_all_ice_sharing(f.owner_id); raise exception 'Injected failure missing';
  exception when check_violation then null; end;
  after_value:=public.get_my_ice_privacy_status(f.owner_id);
  if after_value is null or after_value->>'ice_revision' is distinct from before_value->>'ice_revision' or after_value->>'ice_blocked' is distinct from before_value->>'ice_blocked' then raise exception 'Control revision survived failed transaction'; end if;
  reset role;
  set local role anon;
  begin perform public.get_my_ice_privacy_status(f.owner_id); raise exception 'Anon status permitted'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS sequential persistent ICE assertions. Concurrency NOT tested by this script.';
end $$;
rollback;
