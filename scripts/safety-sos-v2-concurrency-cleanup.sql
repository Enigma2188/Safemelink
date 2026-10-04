-- MUTATING / PRIVILEGED / ONLY AFTER BOTH TABS FINISH, consumers OFF.
-- Deletes ONLY explicitly identified fixture records. Unexpected data -> STOP.
begin;
set local lock_timeout='3s';
lock table public.safety_sos_v2_test_fixture, public.safety_watchdog_sessions,
  public.safety_watchdog_outbox, public.safety_watchdog_deliveries,
  public.safety_sos_v2_operations, public.safety_watchdog_v2_resolutions,
  public.safety_sos_v2_accounts in access exclusive mode;
do $$ declare f public.safety_sos_v2_test_fixture%rowtype; ids uuid[]; begin
  select x.* into strict f from public.safety_sos_v2_test_fixture x;
  if exists(select 1 from public.safety_sos_v2_operations o where o.operation_id not in (f.manual_op,f.second_op,f.watchdog_op))
    or exists(select 1 from public.safety_watchdog_sessions w where w.id<>f.session_id)
    or exists(select 1 from public.safety_sos_v2_accounts a where a.user_id not in (f.owner_id,f.other_id)) then
    raise exception 'Unexpected records; inspect, do not automatically delete';
  end if;
  select array_agg(distinct o.canonical_sos_id) into ids from public.safety_sos_v2_operations o
    where o.operation_id in (f.manual_op,f.second_op,f.watchdog_op) and o.user_id in (f.owner_id,f.other_id);
  if exists(select 1 from public.sos s where s.id=any(ids) and
    (s.user_id not in (f.owner_id,f.other_id) or s.accepted_by is not null or s.push_dispatch_claim_id is not null or s.push_dispatched_at is not null))
    or exists(select 1 from public.nearby_alerts n where n.sos_id=any(ids))
    or exists(select 1 from public.safety_watchdog_deliveries d join public.safety_watchdog_outbox o on o.id=d.event_id where o.session_id=f.session_id) then
    raise exception 'Fixture touched by external delivery/user; STOP';
  end if;
  delete from public.safety_watchdog_v2_resolutions r where r.session_id=f.session_id and r.user_id=f.owner_id;
  delete from public.safety_watchdog_sessions w where w.id=f.session_id and w.user_id=f.owner_id;
  delete from public.safety_sos_v2_operations o where o.operation_id in (f.manual_op,f.second_op,f.watchdog_op)
    and o.user_id in (f.owner_id,f.other_id);
  delete from public.sos s where s.id=any(ids) and s.user_id in (f.owner_id,f.other_id);
  delete from public.safety_sos_v2_accounts a where a.user_id in (f.owner_id,f.other_id);
end $$;
drop table public.safety_sos_v2_test_fixture;
commit;
