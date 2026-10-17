begin;

-- Additive point-in-time status and atomic revocation. No persistent override:
-- changing legacy writer semantics requires separate authorization.
create function public.get_my_ice_privacy_status(expected_owner_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor_id uuid:=auth.uid(); result_value jsonb;
begin
  if actor_id is null or actor_id is distinct from expected_owner_id then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select jsonb_build_object(
    'owner_id',actor_id,'verified_at',clock_timestamp(),
    'legacy_shared',coalesce(e.share_ice_contact_during_sos,false),
    'legacy_text_present',coalesce(nullif(btrim(e.ice_contact),'') is not null,false),
    'structured_shared',coalesce(d.share_ice,false),
    'phone_shared',coalesce(d.share_ice_phone,false),
    'safety_shared',coalesce(d.share_safety,false)
  ) into result_value from (values(actor_id)) as o(owner_id)
  left join public.emergency_profiles as e on e.user_id=o.owner_id
  left join public.emergency_private_details as d on d.user_id=o.owner_id;
  return result_value;
end;
$$;

create function public.revoke_my_all_ice_sharing(expected_owner_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor_id uuid:=auth.uid();
begin
  if actor_id is null or actor_id is distinct from expected_owner_id then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  -- Fixed order: legacy row, then advanced row. Existing writers touch only one.
  -- A failure in either UPDATE aborts the entire RPC transaction.
  update public.emergency_profiles as e set share_ice_contact_during_sos=false,updated_at=now()
    where e.user_id=actor_id;
  update public.emergency_private_details as d set share_ice=false,share_ice_phone=false,updated_at=now()
    where d.user_id=actor_id;
  -- Text/name/number, medical and safety consents are deliberately unchanged.
  return public.get_my_ice_privacy_status(actor_id);
end;
$$;
alter function public.get_my_ice_privacy_status(uuid) owner to postgres;
alter function public.revoke_my_all_ice_sharing(uuid) owner to postgres;
revoke all on function public.get_my_ice_privacy_status(uuid) from public,anon,authenticated,service_role;
revoke all on function public.revoke_my_all_ice_sharing(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_ice_privacy_status(uuid) to authenticated;
grant execute on function public.revoke_my_all_ice_sharing(uuid) to authenticated;
commit;
