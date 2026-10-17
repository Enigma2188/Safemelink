-- MUTATING TAB B, start within 3 seconds of A. Probe rolls back effects; one retry.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare f public.safemelink_phase13_fixture%rowtype;
begin
  select x.* into strict f from public.safemelink_phase13_fixture as x;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  begin
    set local role authenticated;
    if f.scenario='gps_first' then perform public.close_my_sos(f.sos_id);
    else perform public.update_my_active_sos_location_result(f.sos_id,7,8,25,
      f.base_time+case when f.scenario='older_first' then interval '45 seconds' else interval '20 seconds' end); end if;
    raise exception 'BLOCKER: overlap not demonstrated; cleanup and fresh setup required';
  exception when lock_not_available then null;
  end;
  reset role;
  update public.safemelink_phase13_fixture as x set contention_verified=true where x.owner_id=f.owner_id;
end $$;
commit;
select pg_sleep(15);
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare f public.safemelink_phase13_fixture%rowtype; result_value text;
begin
  select x.* into strict f from public.safemelink_phase13_fixture as x;
  if f.contention_verified is distinct from true then raise exception 'No overlap proof'; end if;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if f.scenario='gps_first' then perform public.close_my_sos(f.sos_id); result_value:='closed';
  else result_value:=public.update_my_active_sos_location_result(f.sos_id,7,8,25,
    f.base_time+case when f.scenario='older_first' then interval '45 seconds' else interval '20 seconds' end); end if;
  reset role;
  update public.safemelink_phase13_fixture as x set b_result=result_value where x.owner_id=f.owner_id;
end $$;
commit;
