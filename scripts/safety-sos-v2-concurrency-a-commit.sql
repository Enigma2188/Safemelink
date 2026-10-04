-- MUTATING / TAB A. Start TAB B within 5 seconds. Holds locks for 15 seconds.
-- Isolated Development only, consumers OFF, setup already committed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare f public.safety_sos_v2_test_fixture%rowtype; j jsonb; sid uuid; begin
  select x.* into strict f from public.safety_sos_v2_test_fixture x;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  if f.scenario='watchdog_first' then
    set local role service_role;
    j:=public.process_safety_watchdog_v2(f.session_id);
  elsif f.scenario='closure_first' then
    select o.canonical_sos_id into strict sid from public.safety_sos_v2_operations o where o.operation_id=f.manual_op;
    set local role authenticated;
    j:=public.finish_my_sos_v2(sid,'closed');
  else
    set local role authenticated;
    j:=public.create_or_reuse_my_sos_v2(f.manual_op);
  end if;
  reset role;
  update public.safety_sos_v2_test_fixture x set a_result=j;
end $$;
select pg_sleep(15);
commit;
