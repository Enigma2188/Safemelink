-- MUTATING committed synthetic fixture. NOT EXECUTED. Fresh setup per scenario.
begin;
do $$ declare verified_ref text:=null; workers_stopped boolean:=false;
begin
  if verified_ref is distinct from 'lwkxufnbjrpsehdkfmgy' or workers_stopped is distinct from true then raise exception 'BLOCKED: external Development/drain/worker checks required'; end if;
  if to_regclass('public.ice15_concurrency_fixture') is not null then raise exception 'Existing fixture: inspect, never overwrite'; end if;
end $$;
create table public.ice15_concurrency_fixture(owner_id uuid primary key,scenario text not null,
  a_commits boolean not null,original_revision bigint not null default 0,b_result text,contention_verified boolean not null default false,
  check(scenario in ('writer_first','revoker_first','consent_first','stale_consent','missing_row')));
revoke all on public.ice15_concurrency_fixture from public,anon,authenticated,service_role;
-- Edit scenario and a_commits only; use the matching complete A script.
insert into public.ice15_concurrency_fixture(owner_id,scenario,a_commits) values(gen_random_uuid(),'writer_first',true);
insert into auth.users(id,email) select f.owner_id,'ice15-concurrency-'||f.owner_id::text||'@example.invalid' from public.ice15_concurrency_fixture as f;
insert into public.profiles(id) select f.owner_id from public.ice15_concurrency_fixture as f on conflict(id) do nothing;
insert into public.emergency_profiles(user_id,ice_contact,share_ice_contact_during_sos)
select f.owner_id,'Synthetic ICE',true from public.ice15_concurrency_fixture as f where f.scenario<>'missing_row';
insert into public.emergency_private_details(user_id,ice_name,ice_phone,share_ice,share_ice_phone)
select f.owner_id,'Synthetic ICE','+3900000000',true,true from public.ice15_concurrency_fixture as f where f.scenario<>'missing_row';
do $$ declare f record; j jsonb;
begin
  select x.* into strict f from public.ice15_concurrency_fixture as x;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if f.scenario='consent_first' then perform public.revoke_my_all_ice_sharing(f.owner_id); end if;
  j:=public.get_my_ice_privacy_status(f.owner_id);
  reset role;
  update public.ice15_concurrency_fixture as x set original_revision=(j->>'ice_revision')::bigint where x.owner_id=f.owner_id;
end $$;
commit;
