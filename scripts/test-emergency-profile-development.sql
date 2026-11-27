-- SafeMeLink Development only. Synthetic users, no dispatch RPC, no external
-- delivery, all writes and SOS rows are rolled back in this same transaction.
-- Run as a single SQL Editor request; a successful execution reaches ROLLBACK.
begin;
set local statement_timeout = '30s';
create temporary table emergency_profile_fixture (
  owner_id uuid, trusted_id uuid, nearby_id uuid, sos_id uuid
) on commit drop;
insert into pg_temp.emergency_profile_fixture
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users (id,email)
select actor.id,'emergency-profile-'||actor.id::text||'@example.invalid'
from pg_temp.emergency_profile_fixture f
cross join lateral (values(f.owner_id),(f.trusted_id),(f.nearby_id)) actor(id);
insert into public.profiles (id)
select actor.id from pg_temp.emergency_profile_fixture f
cross join lateral (values(f.owner_id),(f.trusted_id),(f.nearby_id)) actor(id)
on conflict (id) do nothing;
insert into public.trusted_contacts (user_id,name,phone,priority,linked_profile_id)
select owner_id,'Synthetic linked contact','+39000000001',1,trusted_id
from pg_temp.emergency_profile_fixture;
insert into public.sos (id,user_id,latitude,longitude)
select sos_id,owner_id,1,2 from pg_temp.emergency_profile_fixture;
insert into public.nearby_alerts (sos_id,source_user_id,nearby_user_id,distance_meters)
select sos_id,owner_id,nearby_id,50 from pg_temp.emergency_profile_fixture;

do $$
declare f record; shared record;
begin
  select * into strict f from pg_temp.emergency_profile_fixture;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.update_my_emergency_profile('O+','Synthetic allergy','Synthetic condition',
    'Synthetic therapy','Synthetic rescue medication','Synthetic ICE','Synthetic notes',false,false);
  if exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id)) then
    raise exception 'Default OFF must hide owner profile from SOS'; end if;
  perform public.update_my_emergency_profile('O+','Synthetic allergy','Synthetic condition',
    'Synthetic therapy','Synthetic rescue medication','Synthetic ICE','Synthetic notes',true,false);
  reset role;

  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  select * into strict shared from public.get_received_sos_emergency_profile(f.sos_id);
  if shared.declared_blood_group is distinct from 'O+'
     or shared.severe_allergies is distinct from 'Synthetic allergy'
     or shared.important_conditions is distinct from 'Synthetic condition'
     or shared.relevant_medications is distinct from 'Synthetic therapy'
     or shared.lifesaving_medications is distinct from 'Synthetic rescue medication'
     or shared.emergency_notes is distinct from 'Synthetic notes'
     or shared.ice_contact is not null then
    raise exception 'Medical consent or ICE redaction failed'; end if;
  begin
    perform 1 from public.emergency_profiles;
    raise exception 'Direct table read allowed';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub',f.nearby_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.nearby_id,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id)) then
    raise exception 'Nearby outsider obtained medical data'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.update_my_emergency_profile('O+','Synthetic allergy','Synthetic condition',
    'Synthetic therapy','Synthetic rescue medication','Synthetic ICE','Synthetic notes',false,true);
  reset role;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  select * into strict shared from public.get_received_sos_emergency_profile(f.sos_id);
  if shared.ice_contact is distinct from 'Synthetic ICE' or shared.severe_allergies is not null then
    raise exception 'ICE-only consent leaked medical fields'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.update_my_emergency_profile('O+','Synthetic allergy','Synthetic condition',
    'Synthetic therapy','Synthetic rescue medication','Synthetic ICE','Synthetic notes',false,false);
  reset role;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id)) then
    raise exception 'Revocation during an active SOS did not remove access'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.update_my_emergency_profile('O+','Synthetic allergy','Synthetic condition',
    'Synthetic therapy','Synthetic rescue medication','Synthetic ICE','Synthetic notes',true,false);
  reset role;
  perform set_config('request.jwt.claim.sub',f.trusted_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.trusted_id,'role','authenticated')::text,true);

  update public.sos set status='closed',closed_at=now() where id=f.sos_id;
  set local role authenticated;
  if exists(select 1 from public.get_received_sos_emergency_profile(f.sos_id)) then
    raise exception 'Closed SOS disclosed profile'; end if;
  reset role;
  if has_function_privilege('anon','public.get_received_sos_emergency_profile(uuid)','execute') then
    raise exception 'Anonymous function EXECUTE remains granted'; end if;
end $$;
rollback;
