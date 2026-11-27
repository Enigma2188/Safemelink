begin;

-- Existing authenticated RPCs enforce auth.uid() and scope each active SOS to
-- its owner or an account linked as that owner's trusted contact. On the
-- Development database the anon role also had an explicit EXECUTE grant.
-- Remove this unnecessary entry point without changing the sharing defaults.
do $$ begin
  if to_regprocedure('public.get_my_emergency_profile()') is null
     or to_regprocedure('public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean)') is null
     or to_regprocedure('public.get_received_sos_emergency_profile(uuid)') is null then
    raise exception 'Emergency profile RPC contract missing; review migration order';
  end if;
end $$;

revoke execute on function public.get_my_emergency_profile() from public, anon;
revoke execute on function public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean) from public, anon;
revoke execute on function public.get_received_sos_emergency_profile(uuid) from public, anon;

do $$ begin
  if has_function_privilege('anon', 'public.get_received_sos_emergency_profile(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_my_emergency_profile()', 'execute')
     or has_function_privilege('anon', 'public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_received_sos_emergency_profile(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_emergency_profile()', 'execute')
     or not has_function_privilege('authenticated', 'public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean)', 'execute') then
    raise exception 'Emergency profile RPC privileges differ from intended contract';
  end if;
end $$;

commit;
