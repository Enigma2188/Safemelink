-- MUTATING TAB A. Run B within 3 seconds; transaction holds the SOS lock 12s.
begin;
set local statement_timeout='30s';
do $$ declare f public.safemelink_phase13_fixture%rowtype; result_value text;
begin
  select x.* into strict f from public.safemelink_phase13_fixture as x;
  if f.scenario='a_rollback' then raise exception 'Use A rollback script'; end if;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if f.scenario='closure_first' then
    perform public.close_my_sos(f.sos_id);
  else
    result_value:=public.update_my_active_sos_location_result(f.sos_id,3,4,20,
      f.base_time+case when f.scenario='older_first' then interval '15 seconds' else interval '30 seconds' end);
    if result_value is distinct from 'updated' then raise exception 'A GPS not updated'; end if;
  end if;
  reset role;
  perform pg_sleep(12);
end $$;
commit;
