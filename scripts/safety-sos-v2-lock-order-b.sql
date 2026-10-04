-- MUTATING TRANSACTIONAL / lock-order stress TAB B.
-- Fresh concurrency setup, both tabs within 3 seconds; no SOS creation.
-- At least one result must be BUSY_40001; 40P01 or timeout is a BLOCKER.
begin;
set local statement_timeout='20s';
create temporary table v2_lock_result(result text) on commit drop;
do $$ declare f public.safety_sos_v2_test_fixture%rowtype; outcome text:='ACQUIRED_BOTH'; begin
  select x.* into strict f from public.safety_sos_v2_test_fixture x;
  perform public.safety_sos_v2_lock_account(f.other_id);
  perform pg_sleep(8);
  begin
    perform public.safety_sos_v2_lock_account(f.owner_id);
  exception when serialization_failure then outcome:='BUSY_40001'; end;
  insert into pg_temp.v2_lock_result values(outcome);
end $$;
select result from pg_temp.v2_lock_result;
rollback;
