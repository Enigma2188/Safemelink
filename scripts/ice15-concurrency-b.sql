-- MUTATING TAB B, within 3s of A. Probe must time out on account lock, not succeed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare f public.ice15_concurrency_fixture%rowtype;
begin
  select x.* into strict f from public.ice15_concurrency_fixture as x;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  begin
    set local role authenticated;
    if f.scenario in ('writer_first','consent_first') then perform public.revoke_my_all_ice_sharing(f.owner_id);
    elsif f.scenario='stale_consent' then perform public.confirm_my_ice_sharing(f.owner_id,f.original_revision,'ICE_V1',false,true,false);
    else perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic ICE',null,false,true); end if;
    raise exception 'BLOCKER: overlap not observed; cleanup/fresh setup required';
  exception when lock_not_available then null;
  end;
  reset role;
  update public.ice15_concurrency_fixture as x set contention_verified=true where x.owner_id=f.owner_id;
end $$;
commit;
select pg_sleep(15);
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare f public.ice15_concurrency_fixture%rowtype; result_value text;
begin
  select x.* into strict f from public.ice15_concurrency_fixture as x;
  if f.contention_verified is distinct from true then raise exception 'No overlap proof'; end if;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  begin
    set local role authenticated;
    if f.scenario in ('writer_first','consent_first') then perform public.revoke_my_all_ice_sharing(f.owner_id); result_value:='revoked';
    elsif f.scenario='stale_consent' then perform public.confirm_my_ice_sharing(f.owner_id,f.original_revision,'ICE_V1',false,true,false); result_value:='confirmed';
    else perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic ICE',null,false,true); result_value:='saved'; end if;
  exception when insufficient_privilege then result_value:='blocked';
    when serialization_failure then result_value:='revision_changed';
  end;
  reset role;
  update public.ice15_concurrency_fixture as x set b_result=result_value where x.owner_id=f.owner_id;
end $$;
commit;
