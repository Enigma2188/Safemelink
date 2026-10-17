-- MUTATING cleanup, ONLY generated fixture records. Run after A/B are finished.
-- If verification FAILS this transaction aborts and cleanup is NOT committed:
-- ROLLBACK, inspect the fixture, then obtain approval for targeted cleanup.
begin;
set local lock_timeout='3s';
do $$ declare f public.safemelink_phase13_fixture%rowtype; s public.sos%rowtype; expected_time timestamptz;
begin
  select x.* into strict f from public.safemelink_phase13_fixture as x for update;
  select x.* into strict s from public.sos as x where x.id=f.sos_id and x.user_id=f.owner_id for update;
  if not exists(select 1 from auth.users as u where u.id=f.owner_id
    and u.email='phase13-concurrency-'||f.owner_id::text||'@example.invalid') then raise exception 'Fixture identity mismatch'; end if;
  if f.contention_verified is distinct from true then raise exception 'No verified contention'; end if;
  if f.scenario in ('closure_first','gps_first') then
    if s.status::text is distinct from 'closed' or s.closed_at is null then raise exception 'Closure failed'; end if;
    if f.b_result is distinct from case when f.scenario='closure_first' then 'inactive' else 'closed' end then raise exception 'Wrong closure outcome'; end if;
    expected_time:=f.base_time+case when f.scenario='closure_first' then interval '0 seconds' else interval '30 seconds' end;
  else
    if f.b_result is distinct from case when f.scenario='newer_first' then 'stale' else 'updated' end then raise exception 'Wrong GPS outcome'; end if;
    expected_time:=f.base_time+case when f.scenario='newer_first' then interval '30 seconds' when f.scenario='older_first' then interval '45 seconds' else interval '20 seconds' end;
  end if;
  if s.location_updated_at is distinct from expected_time then raise exception 'Wrong final timestamp'; end if;
  if f.scenario in ('older_first','a_rollback') then
    if s.latitude is distinct from 7::double precision or s.longitude is distinct from 8::double precision or s.accuracy is distinct from 25::double precision then raise exception 'GPS tuple inconsistent'; end if;
  elsif f.scenario='closure_first' then
    if s.latitude is distinct from 1::double precision then raise exception 'GPS changed after closure'; end if;
  else if s.latitude is distinct from 3::double precision then raise exception 'A GPS lost'; end if;
  end if;
  delete from public.sos as x where x.id=f.sos_id and x.user_id=f.owner_id;
  delete from auth.users as x where x.id=f.owner_id and x.email='phase13-concurrency-'||f.owner_id::text||'@example.invalid';
  if exists(select 1 from public.profiles as x where x.id=f.owner_id) or exists(select 1 from public.sos as x where x.id=f.sos_id) then raise exception 'Cleanup incomplete'; end if;
  raise notice 'PASS concurrency scenario %, fixture cleanup verified',f.scenario;
end $$;
drop table public.safemelink_phase13_fixture;
commit;
