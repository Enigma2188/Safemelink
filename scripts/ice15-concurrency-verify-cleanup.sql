-- MUTATING cleanup AFTER both connections finish. Failure retains evidence;
-- ROLLBACK/inspect and authorize targeted cleanup instead of deleting blindly.
begin;
set local lock_timeout='3s';
do $$ declare f public.ice15_concurrency_fixture%rowtype; j jsonb; expected_result text; expected_block boolean;
begin
  select x.* into strict f from public.ice15_concurrency_fixture as x for update;
  if not exists(select 1 from auth.users as u where u.id=f.owner_id and u.email='ice15-concurrency-'||f.owner_id::text||'@example.invalid') then raise exception 'Fixture identity mismatch'; end if;
  if f.contention_verified is distinct from true then raise exception 'No overlap proof'; end if;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  j:=public.get_my_ice_privacy_status(f.owner_id);
  reset role;
  if f.scenario in ('writer_first','consent_first') then expected_result:='revoked'; expected_block:=true;
  elsif f.scenario='stale_consent' then expected_result:=case when f.a_commits then 'revision_changed' else 'confirmed' end; expected_block:=f.a_commits;
  else expected_result:=case when f.a_commits then 'blocked' else 'saved' end; expected_block:=f.a_commits; end if;
  if f.b_result is distinct from expected_result or j is null or (j->>'ice_blocked')::boolean is distinct from expected_block then raise exception 'Concurrent outcome wrong'; end if;
  if expected_block and ((j->>'legacy_shared')::boolean is distinct from false or (j->>'structured_shared')::boolean is distinct from false
    or (j->>'phone_shared')::boolean is distinct from false) then raise exception 'Sharing survived block'; end if;
  if f.scenario='stale_consent' and not f.a_commits and ((j->>'legacy_shared')::boolean is distinct from false
    or (j->>'structured_shared')::boolean is distinct from true or (j->>'phone_shared')::boolean is distinct from false) then raise exception 'Consent channel scope wrong'; end if;
  if f.scenario='missing_row' and f.a_commits and exists(select 1 from public.emergency_profiles as e where e.user_id=f.owner_id) then raise exception 'Pending insertion bypassed block'; end if;
  delete from auth.users as u where u.id=f.owner_id and u.email='ice15-concurrency-'||f.owner_id::text||'@example.invalid';
  if exists(select 1 from public.profiles as p where p.id=f.owner_id) or exists(select 1 from public.ice_privacy_control as c where c.user_id=f.owner_id) then raise exception 'Cleanup incomplete'; end if;
  raise notice 'PASS persistent ICE concurrency and fixture cleanup';
end $$;
drop table public.ice15_concurrency_fixture;
commit;
