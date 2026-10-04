-- MUTATING. ISOLATED DEVELOPMENT ONLY. ALL processors/consumers MUST be OFF.
-- Run once per case. Choose ONLY the scenario literal below; no UUID assembly.
-- Accounts are selected from existing idle profiles, never created.
begin;
set local lock_timeout = '3s';
lock table public.safety_watchdog_sessions, public.safety_watchdog_outbox,
  public.safety_watchdog_deliveries, public.safety_sos_v2_accounts,
  public.safety_sos_v2_operations, public.safety_watchdog_v2_resolutions in access exclusive mode;
do $$ begin
  if to_regclass('public.safety_sos_v2_test_fixture') is not null
    or exists(select 1 from public.safety_watchdog_sessions)
    or exists(select 1 from public.safety_sos_v2_accounts)
    or exists(select 1 from public.safety_sos_v2_operations)
    or exists(select 1 from public.safety_watchdog_v2_resolutions) then
    raise exception 'Refusing nonempty environment / existing fixture';
  end if;
end $$;
create table public.safety_sos_v2_test_fixture (
  singleton boolean primary key check(singleton),
  scenario text not null check(scenario in ('manual_first','watchdog_first','same_operation','different_operations','cross_account','closure_first')),
  owner_id uuid not null, other_id uuid not null, session_id uuid,
  manual_op uuid not null, second_op uuid not null, watchdog_op uuid,
  a_result jsonb, b_result jsonb, contention_verified boolean not null default false
);
alter table public.safety_sos_v2_test_fixture enable row level security;
revoke all on public.safety_sos_v2_test_fixture from public,anon,authenticated,service_role;
do $$ declare a uuid; b uuid; op uuid; w public.safety_watchdog_sessions; j jsonb; begin
  select p.id into a from public.profiles p where not exists(select 1 from public.sos s
    where s.user_id=p.id and s.status in ('open','accepted')) order by p.id limit 1;
  select p.id into b from public.profiles p where p.id<>a and not exists(select 1 from public.sos s
    where s.user_id=p.id and s.status in ('open','accepted')) order by p.id limit 1;
  if a is null or b is null then raise exception 'Two idle profiles required'; end if;
  insert into public.safety_sos_v2_test_fixture(singleton,scenario,owner_id,other_id,manual_op,second_op)
    values(true,'manual_first',a,b,gen_random_uuid(),gen_random_uuid());
  insert into public.safety_sos_v2_accounts(user_id,enabled) values(a,true),(b,true);
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  w:=public.start_my_safety_watchdog(gen_random_uuid(),'CHECKPOINT',1,1);
  reset role;
  update public.safety_sos_v2_test_fixture f set session_id=w.id,watchdog_op=w.operation_id;
  with deadline as(select clock_timestamp()-interval '31 seconds' as t1)
  update public.safety_watchdog_sessions s set next_check_at=d.t1,
    confirmation_deadline_at=d.t1+interval '30 seconds' from deadline d where s.id=w.id;
  if (select f.scenario from public.safety_sos_v2_test_fixture f)='closure_first' then
    select f.manual_op into op from public.safety_sos_v2_test_fixture f;
    set local role authenticated;
    j:=public.create_or_reuse_my_sos_v2(op);
    reset role;
  end if;
end $$;
commit;
