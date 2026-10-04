-- MUTATING / TAB B: start within 5 seconds of A. Whole script, no fragments.
-- First transaction proves contention (or independent accounts) and rolls back
-- the probe's effects via a subtransaction. Then ONE explicit retry transaction.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create temporary table safety_v2_probe(verified boolean not null) on commit preserve rows;
do $$ declare f public.safety_sos_v2_test_fixture%rowtype; actor uuid; op uuid; j jsonb; begin
  select x.* into strict f from public.safety_sos_v2_test_fixture x;
  actor:=case when f.scenario='cross_account' then f.other_id else f.owner_id end;
  op:=case when f.scenario in ('same_operation','closure_first') then f.manual_op else f.second_op end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  begin
    if f.scenario='manual_first' then
      set local role service_role;
      j:=public.process_safety_watchdog_v2(f.session_id);
    else
      set local role authenticated;
      j:=public.create_or_reuse_my_sos_v2(op);
    end if;
    reset role;
    if f.scenario<>'cross_account' then raise exception 'BLOCKER: real overlap not observed; repeat with fresh setup'; end if;
    raise exception 'Successful independent-account probe; undo effects' using errcode='PT001';
  exception
    when serialization_failure then
      if f.scenario='cross_account' then raise exception 'BLOCKER: unrelated account lock conflict'; end if;
    when sqlstate 'PT001' then null;
  end;
  reset role;
  insert into pg_temp.safety_v2_probe values(true);
end $$;
commit;
select pg_sleep(18);
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare f public.safety_sos_v2_test_fixture%rowtype; actor uuid; op uuid; j jsonb; begin
  select x.* into strict f from public.safety_sos_v2_test_fixture x;
  if not exists(select 1 from pg_temp.safety_v2_probe p where p.verified) then raise exception 'No overlap proof'; end if;
  actor:=case when f.scenario='cross_account' then f.other_id else f.owner_id end;
  op:=case when f.scenario in ('same_operation','closure_first') then f.manual_op else f.second_op end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  if f.scenario='manual_first' then
    set local role service_role;
    j:=public.process_safety_watchdog_v2(f.session_id);
  else
    set local role authenticated;
    j:=public.create_or_reuse_my_sos_v2(op);
  end if;
  reset role;
  update public.safety_sos_v2_test_fixture x set b_result=j,contention_verified=true;
end $$;
commit;
drop table pg_temp.safety_v2_probe;
