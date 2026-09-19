-- Development ONLY. Database-role test, not a real JWT/gateway test.
-- All test writes are rolled back; no push function is invoked.
-- Requires SQL Editor administrator and two existing profiles.
begin;
set local statement_timeout = '30s';
do $schema$
begin
  if not exists(select 1 from information_schema.columns col where col.table_schema='public'
    and col.table_name='sos' and col.column_name='location_updated_at' and col.data_type='timestamp with time zone'
    and col.is_nullable='YES' and col.column_default is null) then
    raise exception 'Corrective location timestamp migration required';
  end if;
end;
$schema$;
do $test$
declare accounts uuid[];
begin
  select array_agg(candidates.id order by candidates.id) into accounts
  from (select p.id from public.profiles p order by p.id limit 2) candidates;
  if coalesce(array_length(accounts, 1), 0) <> 2 then
    raise exception 'Two Development profiles required';
  end if;
  perform set_config('safety_test.a', accounts[1]::text, true);
  perform set_config('safety_test.b', accounts[2]::text, true);
  perform set_config('safety_test.valid', gen_random_uuid()::text, true);
  perform set_config('safety_test.null', gen_random_uuid()::text, true);
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('safety_test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('safety_test.a'), 'role', 'authenticated')::text, true);
do $test$
declare
  expected_account_id uuid := current_setting('safety_test.a')::uuid;
  operation_id_value uuid := current_setting('safety_test.valid')::uuid;
  original public.sos%rowtype;
  retry public.sos%rowtype;
  other public.sos%rowtype;
  denied boolean := false;
begin
  if auth.uid() is distinct from expected_account_id then raise exception 'Wrong auth context'; end if;
  select * into strict original from public.create_my_safety_sos(operation_id_value,expected_account_id,45,9,10,now(),now());
  if original.location_updated_at is distinct from now() then raise exception 'Observation timestamp lost'; end if;
  select * into strict retry from public.create_my_safety_sos(operation_id_value,expected_account_id,46,10,20,now(),now());
  if to_jsonb(original) is distinct from to_jsonb(retry) then raise exception 'Changed payload overwrote SOS'; end if;
  select * into strict retry from public.create_my_safety_sos(operation_id_value,expected_account_id,999,null,-1,'infinity',null);
  if to_jsonb(original) is distinct from to_jsonb(retry) then raise exception 'Invalid retry did not return original'; end if;
  if (select count(*) from public.sos s where s.id=operation_id_value) <> 1 then raise exception 'Duplicate SOS'; end if;
  select * into strict other from public.create_my_safety_sos(
    current_setting('safety_test.null')::uuid,expected_account_id,null,null,null,now(),null);
  if other.latitude is not null or other.longitude is not null or other.location_updated_at is not null then raise exception 'NULL coordinates/timestamp failed'; end if;
  if not public.update_my_active_sos_location(other.id,45,9,10,now()-interval '1 minute') then
    raise exception 'Live location update failed';
  end if;
  if not exists(select 1 from public.sos s where s.id=other.id
    and s.location_updated_at=now()-interval '1 minute') then raise exception 'Live observation time lost'; end if;
  -- Restore the NULL-coordinate fixture for the delivery exclusion test.
  -- Use another new operation; direct coordinate UPDATE remains forbidden.
  perform set_config('safety_test.null',gen_random_uuid()::text,true);
  perform public.create_my_safety_sos(current_setting('safety_test.null')::uuid,expected_account_id,null,null,null,now(),null);
  select * into strict other from public.create_my_safety_sos(gen_random_uuid(),expected_account_id,45,9,10,now(),now());
  if other.id=operation_id_value then raise exception 'Different operation did not create new SOS'; end if;
  perform public.close_my_sos(operation_id_value);
  select s.* into strict original from public.sos s where s.id=operation_id_value;
  select * into strict retry from public.create_my_safety_sos(operation_id_value,expected_account_id,999,null,-1,null,null);
  if to_jsonb(original) is distinct from to_jsonb(retry) then raise exception 'Lifecycle reset'; end if;
  -- Legacy deletion is preserved, but the durable mapping prohibits recreation.
  delete from public.sos s where s.id=operation_id_value;
  if exists(select 1 from public.sos s where s.id=operation_id_value) then raise exception 'Legacy DELETE unavailable'; end if;
  begin
    perform public.create_my_safety_sos(operation_id_value,expected_account_id,45,9,10,now(),now());
  exception when no_data_found then denied := true;
  end;
  if not denied then raise exception 'Deleted operation recreated'; end if;
  insert into public.sos as s(user_id,latitude,longitude) values(expected_account_id,45,9) returning s.* into other;
  delete from public.sos s where s.id=other.id;
  raise notice 'PASS A-F/I/J: payloads, nullable, retry, lifecycle, deletion, manual SOS';
end;
$test$;
select set_config('request.jwt.claim.sub', current_setting('safety_test.b'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('safety_test.b'), 'role', 'authenticated')::text, true);
do $test$
declare denied boolean := false;
begin
  begin
    perform public.create_my_safety_sos(current_setting('safety_test.valid')::uuid,
      current_setting('safety_test.b')::uuid,45,9,10,now(),now());
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Deleted operation reused by B'; end if;
  raise notice 'PASS G: durable account isolation';
end;
$test$;
reset role;
set local role service_role;
do $test$
declare recipients uuid[]; nearby integer;
begin
  select coalesce(array_agg(delivery.recipient_user_id),array[]::uuid[]),count(*) filter(where delivery.is_nearby)
  into recipients,nearby from public.prepare_sos_delivery(current_setting('safety_test.null')::uuid) delivery;
  if nearby <> 0 or exists(select 1 from public.nearby_alerts alert
    where alert.sos_id=current_setting('safety_test.null')::uuid) then raise exception 'Nearby without coordinates'; end if;
  if exists(select 1 from public.trusted_contacts c where c.user_id=current_setting('safety_test.a')::uuid
    and c.linked_profile_id is not null and c.linked_profile_id<>c.user_id
    and not(c.linked_profile_id=any(recipients))) then raise exception 'Trusted recipient lost'; end if;
  raise notice 'PASS K/L: NULL nearby excluded; existing trusted preserved (requires trusted fixture for non-vacuous coverage)';
end;
$test$;
reset role;
do $test$
declare rpc regprocedure := 'public.create_my_safety_sos(uuid,uuid,double precision,double precision,double precision,timestamptz,timestamptz)'::regprocedure;
begin
  if not has_function_privilege('authenticated',rpc,'EXECUTE') or has_function_privilege('anon',rpc,'EXECUTE')
    then raise exception 'Creation grants incorrect'; end if;
  if has_function_privilege('authenticated','public.prepare_sos_delivery(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.prepare_sos_delivery(uuid)','EXECUTE')
    then raise exception 'Delivery grants incorrect'; end if;
  if not exists(select 1 from pg_proc proc where proc.oid=rpc and proc.prosecdef
    and proc.proconfig @> array['search_path=public, pg_temp']) then raise exception 'Definer/search_path incorrect'; end if;
  if not exists(select 1 from pg_class cls where cls.oid='public.safety_sos_operations'::regclass and cls.relrowsecurity)
    then raise exception 'Mapping RLS missing'; end if;
  if has_table_privilege('authenticated','public.safety_sos_operations','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon','public.safety_sos_operations','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Direct mapping access allowed'; end if;
  if (select count(*) from public.safety_sos_operations mapping where mapping.operation_id=current_setting('safety_test.valid')::uuid) <> 1
    then raise exception 'Tombstone missing'; end if;
  if not exists(select 1 from pg_constraint con where con.conrelid='public.safety_sos_operations'::regclass and con.contype='p')
    or not exists(select 1 from pg_constraint con where con.conrelid='public.safety_sos_operations'::regclass and con.contype='u')
    then raise exception 'Concurrency constraints missing'; end if;
  raise notice 'PASS H/M: PK/UNIQUE and security; real concurrent connections require a separate test';
end;
$test$;
rollback;
