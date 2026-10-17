-- MUTATING TAB A. Run B within 3s. Hold account lock for 12s, then COMMIT.
begin;
set local statement_timeout='30s';
do $$ declare f public.ice15_concurrency_fixture%rowtype;
begin
  select x.* into strict f from public.ice15_concurrency_fixture as x;
  if f.a_commits is distinct from true then raise exception 'Use A rollback'; end if;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if f.scenario='writer_first' then perform public.update_my_emergency_profile(null,null,null,null,null,'Synthetic ICE',null,false,true);
  elsif f.scenario='consent_first' then perform public.confirm_my_ice_sharing(f.owner_id,f.original_revision,'ICE_V1',false,true,false);
  else perform public.revoke_my_all_ice_sharing(f.owner_id); end if;
  reset role;
  perform pg_sleep(12);
end $$;
commit;
