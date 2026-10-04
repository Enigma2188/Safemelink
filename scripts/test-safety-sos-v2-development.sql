-- MUTATING / MANUAL / ISOLATED DEVELOPMENT ONLY. Entire script -> ROLLBACK.
-- Requires Phase 7B + 7C, privileged SQL Editor, two existing idle profiles.
-- Disable ALL watchdog processors/consumers; no HTTP, SMS or delivery RPCs here.
-- Simulated JWT claims test SQL authorization, not a real signed client JWT.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
lock table public.safety_watchdog_sessions, public.safety_watchdog_outbox,
  public.safety_watchdog_deliveries, public.safety_sos_v2_accounts,
  public.safety_sos_v2_operations, public.safety_watchdog_v2_resolutions in access exclusive mode;
do $$ begin
  if exists(select 1 from public.safety_watchdog_sessions)
    or exists(select 1 from public.safety_sos_v2_accounts)
    or exists(select 1 from public.safety_sos_v2_operations)
    or exists(select 1 from public.safety_watchdog_v2_resolutions) then
    raise exception 'Isolated empty watchdog/V2 environment required.';
  end if;
end $$;
create temporary table v2_test(key text primary key, id uuid not null) on commit drop;
insert into v2_test
  select 'a',p.id from public.profiles p where not exists
    (select 1 from public.sos s where s.user_id = p.id and s.status in ('open','accepted')) order by p.id limit 1;
insert into v2_test
  select 'b',p.id from public.profiles p where p.id <> (select t.id from v2_test t where t.key = 'a')
    and not exists(select 1 from public.sos s where s.user_id = p.id and s.status in ('open','accepted')) order by p.id limit 1;
do $$ begin if (select count(*) from v2_test) <> 2 then raise exception 'Two idle profiles required.'; end if; end $$;
insert into v2_test values ('op',gen_random_uuid()),('op2',gen_random_uuid());
grant select,insert,update on v2_test to authenticated;
select set_config('request.jwt.claim.sub',(select t.id::text from v2_test t where t.key = 'a'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select t.id from v2_test t where t.key = 'a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    perform public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op'));
    raise exception 'Dormancy gate bypassed';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.safety_sos_v2_lock_account(auth.uid());
    raise exception 'Private helper exposed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.safety_sos_v2_accounts(user_id,enabled) select t.id,true from v2_test t where t.key in ('a','b');
set local role authenticated;
do $$ declare w public.safety_watchdog_sessions; j jsonb; k jsonb; begin
  w := public.start_my_safety_watchdog(gen_random_uuid(),'CHECKPOINT',1,2);
  insert into pg_temp.v2_test values('session',w.id),('watchdog_op',w.operation_id);
  j := public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op'));
  if j->>'outcome' <> 'created' or j->>'status' <> 'open' then raise exception 'Creation failed'; end if;
  insert into pg_temp.v2_test values('sos',(j->>'sos_id')::uuid);
  k := public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op'));
  if k->>'outcome' <> 'replayed' or k->>'sos_id' <> j->>'sos_id' then raise exception 'Response-lost replay failed'; end if;
  k := public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op2'),0,0,1,clock_timestamp());
  if k->>'outcome' <> 'reused_active' or k->>'sos_id' <> j->>'sos_id' or k->'sos' <> j->'sos' then
    raise exception 'Reuse changed canonical row';
  end if;
  begin perform public.cancel_my_safety_watchdog(w.id,w.generation); raise exception 'STOP undid absorption';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
reset role;
do $$ declare j jsonb; before_count bigint; begin
  if not exists(select 1 from public.safety_watchdog_sessions w
    where w.id = (select t.id from v2_test t where t.key = 'session') and w.state = 'ABSORBED'
      and w.sos_id is null and w.escalated_at is null) then raise exception 'Absorption state'; end if;
  if not exists(select 1 from public.safety_watchdog_v2_resolutions r
    where r.session_id = (select t.id from v2_test t where t.key = 'session') and r.outcome = 'ABSORBED') then
    raise exception 'Missing resolution'; end if;
  select count(*) into before_count from public.sos;
  j := public.process_safety_watchdog_v2((select t.id from v2_test t where t.key = 'session'));
  if j->>'sos_id' <> (select t.id::text from v2_test t where t.key = 'sos') then raise exception 'Absorbed replay'; end if;
  if (select count(*) from public.sos) <> before_count then raise exception 'Late escalation'; end if;
  if exists(select 1 from public.safety_watchdog_outbox) then raise exception 'Manual absorption dispatched twice'; end if;
  begin update public.safety_sos_v2_operations set origin = 'watchdog'; raise exception 'Journal mutable';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
-- Account B cannot take over an A operation or close A's SOS.
select set_config('request.jwt.claim.sub',(select t.id::text from v2_test t where t.key = 'b'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select t.id from v2_test t where t.key = 'b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op'));
    raise exception 'Cross-account operation reused'; exception when insufficient_privilege then null; end;
  begin perform public.finish_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'sos'),'closed');
    raise exception 'Cross-account close'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Accepted fixture: privileged update ONLY of the SOS generated by this test.
update public.sos s set status = 'accepted',accepted_by = (select t.id from v2_test t where t.key = 'b')
  where s.id = (select t.id from v2_test t where t.key = 'sos');
select set_config('request.jwt.claim.sub',(select t.id::text from v2_test t where t.key = 'a'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select t.id from v2_test t where t.key = 'a'),'role','authenticated')::text,true);
create temporary table v2_snapshot on commit drop as select to_jsonb(s) as row_value from public.sos s
  where s.id = (select t.id from v2_test t where t.key = 'sos');
grant select on v2_snapshot to authenticated;
set local role authenticated;
do $$ declare j jsonb; begin
  j := public.create_or_reuse_my_sos_v2(gen_random_uuid(),1,1,5,clock_timestamp());
  if j->>'status' <> 'accepted' or j->'sos' <> (select row_value from pg_temp.v2_snapshot) then raise exception 'Accepted reset'; end if;
  perform public.finish_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'sos'),'closed');
  j := public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op'));
  if j->>'outcome' <> 'replayed' or j->>'lifecycle' <> 'terminal' or j->>'status' <> 'closed' then raise exception 'Resurrection'; end if;
end $$;
reset role;
do $$ declare j jsonb; begin
  j := public.process_safety_watchdog_v2((select t.id from v2_test t where t.key = 'session'));
  if j->>'lifecycle' <> 'terminal' then raise exception 'Closed absorbed session rearmed'; end if;
end $$;
-- Deletion does not release the original operation ID (fixture SOS only).
delete from public.sos s where s.id = (select t.id from v2_test t where t.key = 'sos');
set local role authenticated;
do $$ declare j jsonb; begin
  j := public.create_or_reuse_my_sos_v2((select t.id from pg_temp.v2_test t where t.key = 'op'));
  if j->>'outcome' <> 'replayed' or j->>'lifecycle' <> 'missing' or j->'sos' <> 'null'::jsonb then
    raise exception 'Deleted SOS resurrected';
  end if;
end $$;
reset role;
-- Watchdog first on a NEW session/operation; force ONLY test fixture past T2.
set local role authenticated;
do $$ declare w public.safety_watchdog_sessions; begin
  w := public.start_my_safety_watchdog(gen_random_uuid(),'HOME_RETURN',1,1);
  insert into pg_temp.v2_test values('session2',w.id);
end $$;
reset role;
with deadline as(select clock_timestamp()-interval '31 seconds' as t1)
update public.safety_watchdog_sessions w set next_check_at=d.t1,confirmation_deadline_at=d.t1+interval '30 seconds'
  from deadline d where w.id = (select t.id from v2_test t where t.key = 'session2');
select public.process_safety_watchdog_v2((select t.id from v2_test t where t.key = 'session2'));
set local role authenticated;
do $$ declare j jsonb; begin
  j := public.create_or_reuse_my_sos_v2(gen_random_uuid());
  if j->>'outcome' <> 'reused_active' then raise exception 'Watchdog-first reuse'; end if;
  insert into pg_temp.v2_test values('sos2',(j->>'sos_id')::uuid);
end $$;
reset role;
do $$ begin
  if (select count(*) from public.sos s where s.user_id = (select t.id from v2_test t where t.key = 'a')
    and s.status in ('open','accepted')) <> 1 then raise exception 'Duplicate active SOS'; end if;
  if (select count(*) from public.safety_watchdog_outbox o where o.kind = 'SOS_DISPATCH') <> 1 then raise exception 'Dispatch dedupe'; end if;
end $$;
select 'PASS transactional Phase 7C; two-connection tests remain separate' as result;
rollback;
