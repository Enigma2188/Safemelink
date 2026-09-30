-- MANUAL DEVELOPMENT ONLY, after review/application. Never called by npm/tests.
-- SQL role simulation, NOT proof of an end-to-end real JWT session.
-- Refuses a nonempty watchdog environment. No HTTP/SMS/prepare_sos_delivery.
-- Execute the WHOLE script. Any error: explicitly ROLLBACK before continuing.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.safety_watchdog_sessions,public.safety_watchdog_outbox,public.safety_watchdog_deliveries in access exclusive mode;
do $$ begin
  if exists(select 1 from public.safety_watchdog_sessions) or exists(select 1 from public.safety_watchdog_outbox) then
    raise exception 'Use isolated Development with empty watchdog tables; refusing unrelated sessions.';
  end if;
end $$;
create temporary table wd_test(k text primary key,v uuid) on commit drop;
insert into wd_test select 'a',p.id from public.profiles p where not exists(select 1 from public.sos s where s.user_id=p.id and s.status in ('open','accepted')) order by p.id limit 1;
insert into wd_test select 'b',p.id from public.profiles p where p.id<>(select v from wd_test where k='a') order by p.id limit 1;
do $$ begin if (select count(*) from wd_test)<>2 then raise exception 'Two existing Development profiles required.'; end if; end $$;
grant select,insert,update on wd_test to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from wd_test where k='a'),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',(select v::text from wd_test where k='a'),true);
set local role authenticated;
do $$ declare s public.safety_watchdog_sessions; r public.safety_watchdog_sessions; req uuid:=gen_random_uuid(); begin
  s:=public.start_my_safety_watchdog(req,'CHECKPOINT',1,2);
  r:=public.start_my_safety_watchdog(req,'CHECKPOINT',1,2);
  if s.id<>r.id then raise exception 'duplicate start'; end if;
  insert into pg_temp.wd_test values('session',s.id);
  begin perform public.start_my_safety_watchdog(gen_random_uuid(),'CHECKPOINT',1,1); raise exception 'second active accepted'; exception when unique_violation then null; end;
  begin perform public.confirm_my_safety_watchdog(s.id,2); raise exception 'generation accepted'; exception when serialization_failure then null; end;
  begin perform public.process_due_safety_watchdogs(1); raise exception 'internal privilege leak'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from wd_test where k='b'),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',(select v::text from wd_test where k='b'),true);
set local role authenticated;
do $$ begin
  begin perform public.get_my_safety_watchdog((select v from pg_temp.wd_test where k='session')); raise exception 'isolation read'; exception when insufficient_privilege then null; end;
  begin perform public.cancel_my_safety_watchdog((select v from pg_temp.wd_test where k='session'),1); raise exception 'isolation cancel'; exception when insufficient_privilege then null; end;
  begin perform public.confirm_my_safety_watchdog((select v from pg_temp.wd_test where k='session'),1); raise exception 'isolation confirm'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Accelerate ONLY the owned test fixture, not real sessions.
with t as(select clock_timestamp()-interval '1 second' as t1)
update public.safety_watchdog_sessions s set next_check_at=t.t1,confirmation_deadline_at=t.t1+interval '30 seconds' from t where s.id=(select v from wd_test where k='session');
select public.process_due_safety_watchdogs(1);
select public.process_due_safety_watchdogs(1);
do $$ begin
  if (select count(*) from public.safety_watchdog_outbox)<>1 then raise exception 'T1 dedupe'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from wd_test where k='a'),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',(select v::text from wd_test where k='a'),true);
set local role authenticated;
do $$ declare s public.safety_watchdog_sessions; begin
  s:=public.confirm_my_safety_watchdog((select v from pg_temp.wd_test where k='session'),1);
  if s.generation<>2 or s.repeat_completed<>1 or s.state<>'ACTIVE' then raise exception 'repeat progression'; end if;
end $$;
reset role;
with t as(select clock_timestamp()-interval '1 second' as t1)
update public.safety_watchdog_sessions s set next_check_at=t.t1,confirmation_deadline_at=t.t1+interval '30 seconds' from t where s.id=(select v from wd_test where k='session');
set local role authenticated;
do $$ declare s public.safety_watchdog_sessions; begin
  s:=public.confirm_my_safety_watchdog((select v from pg_temp.wd_test where k='session'),2);
  if s.state<>'COMPLETE' or s.repeat_completed<>2 then raise exception 'final repeat'; end if;
  begin perform public.start_my_safety_watchdog(gen_random_uuid(),'HOME_RETURN',10081,1); raise exception 'hard bound'; exception when invalid_parameter_value then null; end;
  begin perform public.start_my_safety_watchdog(gen_random_uuid(),'CHECKPOINT',780,1); raise exception 'checkpoint bound'; exception when invalid_parameter_value then null; end;
  s:=public.start_my_safety_watchdog(gen_random_uuid(),'HOME_RETURN',780,1);
  s:=public.cancel_my_safety_watchdog(s.id,1);
  if s.state<>'CANCELLED' then raise exception 'cancel'; end if;
  s:=public.start_my_safety_watchdog(gen_random_uuid(),'CHECKPOINT',1,1);
  update pg_temp.wd_test set v=s.id where k='session';
end $$;
reset role;
with t as(select clock_timestamp()-interval '31 seconds' as t1)
update public.safety_watchdog_sessions s set next_check_at=t.t1,confirmation_deadline_at=t.t1+interval '30 seconds' from t where s.id=(select v from wd_test where k='session');
set local role authenticated;
do $$ begin
  begin perform public.confirm_my_safety_watchdog((select v from pg_temp.wd_test where k='session'),1); raise exception 'late confirm'; exception when object_not_in_prerequisite_state then null; end;
  begin perform public.cancel_my_safety_watchdog((select v from pg_temp.wd_test where k='session'),1); raise exception 'late cancel'; exception when object_not_in_prerequisite_state then null; end;
end $$;
reset role;
select public.process_due_safety_watchdogs(100);
select public.process_due_safety_watchdogs(100);
do $$ declare sid uuid; e uuid; c uuid:=gen_random_uuid(); d jsonb; dc uuid:=gen_random_uuid(); begin
  select s.sos_id into sid from public.safety_watchdog_sessions s where s.id=(select v from wd_test where k='session');
  if sid is null or (select count(*) from public.sos s where s.id=sid)<>1 or
    (select count(*) from public.safety_sos_operations m where m.operation_id=sid)<>1 then raise exception 'T2 idempotence'; end if;
  select o.id into e from public.safety_watchdog_outbox o where o.session_id=(select v from wd_test where k='session') and o.kind='SOS_DISPATCH';
  update public.safety_watchdog_outbox o set state='CLAIMED',claim_id=c,lease_until=clock_timestamp()+interval '2 minutes' where o.id=e;
  if public.claim_sos_push_dispatch(sid,c)<>'claimed' then raise exception 'dispatch claim'; end if;
  if not public.stage_safety_watchdog_deliveries(e,c,array[repeat('a',64),repeat('b',64)]) then raise exception 'stage'; end if;
  perform public.stage_safety_watchdog_deliveries(e,c,array[repeat('a',64),repeat('b',64)]);
  if (select count(*) from public.safety_watchdog_deliveries)<>2 then raise exception 'journal dedupe'; end if;
  d:=public.claim_safety_watchdog_delivery(dc);
  if not public.finish_safety_watchdog_delivery((d->>'deliveryId')::uuid,dc,'release') then raise exception 'pre-send retry'; end if;
  dc:=gen_random_uuid(); d:=public.claim_safety_watchdog_delivery(dc);
  if not public.finish_safety_watchdog_delivery((d->>'deliveryId')::uuid,dc,'attempt') then raise exception 'attempt'; end if;
  perform public.finish_safety_watchdog_delivery((d->>'deliveryId')::uuid,dc,'unknown');
  if public.finish_safety_watchdog_delivery((d->>'deliveryId')::uuid,dc,'release') then raise exception 'unsafe uncertain retry'; end if;
  update public.safety_watchdog_deliveries j set available_at=clock_timestamp() where j.event_id=e and j.state='PENDING';
  dc:=gen_random_uuid(); d:=public.claim_safety_watchdog_delivery(dc);
  if d is null then raise exception 'lost pending sibling'; end if;
  perform public.finish_safety_watchdog_delivery((d->>'deliveryId')::uuid,dc,'attempt');
  perform public.finish_safety_watchdog_delivery((d->>'deliveryId')::uuid,dc,'accepted');
  if public.claim_safety_watchdog_delivery(gen_random_uuid()) is not null then raise exception 'terminal send reclaimed'; end if;
  perform public.reconcile_safety_watchdog_deliveries();
  if (select o.state from public.safety_watchdog_outbox o where o.id=e)<>'UNKNOWN' then raise exception 'partial parent state'; end if;
end $$;
select 'PASS transactional assertions; concurrency requires separate sessions' as result;
rollback;
