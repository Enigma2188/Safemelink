begin;
do $$ declare signature_value text; function_oid oid;
begin
  if not exists(select 1 from pg_catalog.pg_roles as r where r.rolname='postgres' and (r.rolsuper or r.rolbypassrls)) then
    raise exception 'Required protected definer role unavailable';
  end if;
  foreach signature_value in array array['public.get_my_emergency_profile()',
    'public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean)',
    'public.get_received_sos_emergency_profile(uuid)','public.get_my_emergency_private_details(uuid)',
    'public.update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean)',
    'public.delete_my_emergency_private_details(uuid)','public.get_received_sos_private_details(uuid)',
    'public.get_my_ice_privacy_status(uuid)','public.revoke_my_all_ice_sharing(uuid)'] loop
    function_oid:=to_regprocedure(signature_value);
    if function_oid is null then raise exception 'Required earlier ICE RPC missing'; end if;
    if (select count(*) from pg_catalog.pg_proc as p where p.pronamespace='public'::regnamespace
      and p.proname=(select q.proname from pg_catalog.pg_proc as q where q.oid=function_oid))<>1 then
      raise exception 'Unexpected ICE overload: review required';
    end if;
    if exists(select 1 from pg_catalog.pg_depend as d where d.refclassid='pg_proc'::regclass and d.refobjid=function_oid
      and d.classid in ('pg_rewrite'::regclass,'pg_proc'::regclass)) then
      raise exception 'Review stored dependencies before ICE RPC wrapping';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_policies as p where p.schemaname='public'
    and p.tablename in ('emergency_profiles','emergency_private_details')) then
    raise exception 'Unexpected direct profile policies: review required';
  end if;
end $$;
-- One-time migration, requires Phase12 + Phase14. Apply only in a quiet window:
-- pre-migration in-flight function executions must have drained first.
create table public.ice_privacy_control (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  blocked boolean not null default false,
  legacy_allowed boolean not null default true,
  structured_allowed boolean not null default true,
  phone_allowed boolean not null default true,
  revision bigint not null default 0 check(revision>=0),
  consent_version text check(consent_version is null or consent_version='ICE_V1'),
  changed_at timestamptz not null default now()
);
alter table public.ice_privacy_control owner to postgres;
alter table public.ice_privacy_control enable row level security;
alter table public.ice_privacy_control force row level security;
revoke all on table public.ice_privacy_control from public,anon,authenticated,service_role;
revoke all on table public.emergency_profiles from public,anon,authenticated;
revoke all on table public.emergency_private_details from public,anon,authenticated;

create function public._ice15_read_guard() returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ICE requires a fresh READ COMMITTED transaction' using errcode='25001';
  end if;
  return true;
end $$;
alter function public._ice15_read_guard() owner to postgres;
revoke all on function public._ice15_read_guard() from public,anon,authenticated,service_role;

-- All write entry points call this BEFORE touching either profile table.
-- Hash collisions only serialize unrelated owners; authorization never uses hash.
create function public._ice15_lock(expected_owner_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null or auth.uid() is distinct from expected_owner_id then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  perform public._ice15_read_guard();
  perform pg_advisory_xact_lock(hashtextextended('safemelink:ice:'||expected_owner_id::text,0));
end $$;
alter function public._ice15_lock(uuid) owner to postgres;
revoke all on function public._ice15_lock(uuid) from public,anon,authenticated,service_role;

-- Preserve the reviewed implementations as inaccessible implementation helpers.
-- No authenticated caller may invoke these through PostgREST or SQL directly.
alter function public.get_my_emergency_profile() rename to _ice15_get_legacy;
alter function public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean) rename to _ice15_update_legacy;
alter function public.get_received_sos_emergency_profile(uuid) rename to _ice15_received_legacy;
alter function public.get_my_emergency_private_details(uuid) rename to _ice15_get_private;
alter function public.update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) rename to _ice15_update_private;
alter function public.delete_my_emergency_private_details(uuid) rename to _ice15_delete_private;
alter function public.get_received_sos_private_details(uuid) rename to _ice15_received_private;
alter function public._ice15_get_legacy() owner to postgres;
alter function public._ice15_update_legacy(text,text,text,text,text,text,text,boolean,boolean) owner to postgres;
alter function public._ice15_received_legacy(uuid) owner to postgres;
alter function public._ice15_get_private(uuid) owner to postgres;
alter function public._ice15_update_private(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) owner to postgres;
alter function public._ice15_delete_private(uuid) owner to postgres;
alter function public._ice15_received_private(uuid) owner to postgres;
alter function public._ice15_get_legacy() set search_path=pg_catalog,pg_temp;
alter function public._ice15_update_legacy(text,text,text,text,text,text,text,boolean,boolean) set search_path=pg_catalog,pg_temp;
alter function public._ice15_received_legacy(uuid) set search_path=pg_catalog,pg_temp;
alter function public._ice15_get_private(uuid) set search_path=pg_catalog,pg_temp;
alter function public._ice15_update_private(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) set search_path=pg_catalog,pg_temp;
alter function public._ice15_delete_private(uuid) set search_path=pg_catalog,pg_temp;
alter function public._ice15_received_private(uuid) set search_path=pg_catalog,pg_temp;
revoke all on function public._ice15_get_legacy() from public,anon,authenticated,service_role;
revoke all on function public._ice15_update_legacy(text,text,text,text,text,text,text,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public._ice15_received_legacy(uuid) from public,anon,authenticated,service_role;
revoke all on function public._ice15_get_private(uuid) from public,anon,authenticated,service_role;
revoke all on function public._ice15_update_private(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public._ice15_delete_private(uuid) from public,anon,authenticated,service_role;
revoke all on function public._ice15_received_private(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_my_ice_privacy_status(expected_owner_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result_value jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from expected_owner_id then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public._ice15_read_guard();
  select jsonb_build_object('owner_id',expected_owner_id,'verified_at',clock_timestamp(),
    'legacy_shared',coalesce(e.share_ice_contact_during_sos,false) and not coalesce(c.blocked,false) and coalesce(c.legacy_allowed,true),
    'legacy_text_present',nullif(btrim(e.ice_contact),'') is not null,
    'structured_shared',coalesce(d.share_ice,false) and not coalesce(c.blocked,false) and coalesce(c.structured_allowed,true),
    'phone_shared',coalesce(d.share_ice_phone,false) and not coalesce(c.blocked,false) and coalesce(c.structured_allowed,true) and coalesce(c.phone_allowed,true),
    'safety_shared',coalesce(d.share_safety,false),'ice_blocked',coalesce(c.blocked,false),
    'ice_revision',coalesce(c.revision,0)::text,'consent_version',c.consent_version,
    'ice_legacy_allowed',coalesce(c.legacy_allowed,true),'ice_structured_allowed',coalesce(c.structured_allowed,true),'ice_phone_allowed',coalesce(c.phone_allowed,true)
  ) into result_value from (values(expected_owner_id)) as o(owner_id)
  left join public.emergency_profiles as e on e.user_id=o.owner_id
  left join public.emergency_private_details as d on d.user_id=o.owner_id
  left join public.ice_privacy_control as c on c.user_id=o.owner_id;
  return result_value;
end $$;

create or replace function public.revoke_my_all_ice_sharing(expected_owner_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform public._ice15_lock(expected_owner_id);
  insert into public.ice_privacy_control as c(user_id,blocked,revision,legacy_allowed,structured_allowed,phone_allowed)
    values(expected_owner_id,true,1,false,false,false)
    on conflict(user_id) do update set blocked=true,revision=c.revision+1,legacy_allowed=false,structured_allowed=false,phone_allowed=false,consent_version=null,changed_at=now();
  update public.emergency_profiles as e set share_ice_contact_during_sos=false,updated_at=now() where e.user_id=expected_owner_id;
  update public.emergency_private_details as d set share_ice=false,share_ice_phone=false,updated_at=now() where d.user_id=expected_owner_id;
  return public.get_my_ice_privacy_status(expected_owner_id);
end $$;

create function public.get_my_emergency_profile()
returns table(declared_blood_group text,severe_allergies text,important_conditions text,relevant_medications text,
  lifesaving_medications text,ice_contact text,emergency_notes text,share_medical_data_during_sos boolean,
  share_ice_contact_during_sos boolean,profile_updated_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  -- The old getter can INSERT an empty row, so it participates in write ordering.
  perform public._ice15_lock(auth.uid());
  return query select p.declared_blood_group,p.severe_allergies,p.important_conditions,p.relevant_medications,
    p.lifesaving_medications,p.ice_contact,p.emergency_notes,p.share_medical_data_during_sos,
    p.share_ice_contact_during_sos and not coalesce(c.blocked,false) and coalesce(c.legacy_allowed,true),p.profile_updated_at
  from public._ice15_get_legacy() as p left join public.ice_privacy_control as c on c.user_id=auth.uid();
end $$;

create function public.update_my_emergency_profile(next_declared_blood_group text,next_severe_allergies text,
  next_important_conditions text,next_relevant_medications text,next_lifesaving_medications text,next_ice_contact text,
  next_emergency_notes text,next_share_medical_data_during_sos boolean,next_share_ice_contact_during_sos boolean)
returns table(declared_blood_group text,severe_allergies text,important_conditions text,relevant_medications text,
  lifesaving_medications text,ice_contact text,emergency_notes text,share_medical_data_during_sos boolean,
  share_ice_contact_during_sos boolean,profile_updated_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform public._ice15_lock(auth.uid());
  if next_share_ice_contact_during_sos and exists(select 1 from public.ice_privacy_control as c where c.user_id=auth.uid() and (c.blocked or not c.legacy_allowed)) then
    raise exception 'ICE_SHARING_BLOCKED: use the updated explicit consent flow' using errcode='42501';
  end if;
  return query select p.* from public._ice15_update_legacy(next_declared_blood_group,next_severe_allergies,
    next_important_conditions,next_relevant_medications,next_lifesaving_medications,next_ice_contact,
    next_emergency_notes,next_share_medical_data_during_sos,next_share_ice_contact_during_sos) as p;
end $$;

create function public.get_my_emergency_private_details(expected_owner_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j jsonb; policy public.ice_privacy_control%rowtype;
begin
  perform public._ice15_read_guard();
  j:=public._ice15_get_private(expected_owner_id);
  select c.* into policy from public.ice_privacy_control as c where c.user_id=expected_owner_id;
  if j is not null and found then
    j:=j||jsonb_build_object('share_ice',(j->>'share_ice')::boolean and not policy.blocked and policy.structured_allowed,
      'share_ice_phone',(j->>'share_ice_phone')::boolean and not policy.blocked and policy.structured_allowed and policy.phone_allowed);
  end if;
  return j;
end $$;
create function public.update_my_emergency_private_details(expected_owner_id uuid,next_ice_name text,next_ice_relation text,
  next_ice_phone text,next_stalking text,next_domestic_violence text,next_other_risk text,next_instructions text,
  next_share_ice boolean,next_share_ice_phone boolean,next_share_safety boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform public._ice15_lock(expected_owner_id);
  if exists(select 1 from public.ice_privacy_control as c where c.user_id=expected_owner_id and
    ((next_share_ice and (c.blocked or not c.structured_allowed)) or (next_share_ice_phone and (c.blocked or not c.structured_allowed or not c.phone_allowed)))) then
    raise exception 'ICE_SHARING_BLOCKED: use the updated explicit consent flow' using errcode='42501';
  end if;
  return public._ice15_update_private(expected_owner_id,next_ice_name,next_ice_relation,next_ice_phone,next_stalking,
    next_domestic_violence,next_other_risk,next_instructions,next_share_ice,next_share_ice_phone,next_share_safety);
end $$;
create function public.delete_my_emergency_private_details(expected_owner_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform public._ice15_lock(expected_owner_id);
  perform public._ice15_delete_private(expected_owner_id);
  -- Never delete/reset ice_privacy_control when private contents are deleted.
end $$;

create function public.get_received_sos_emergency_profile(target_sos_id uuid)
returns table(sos_id uuid,declared_blood_group text,severe_allergies text,important_conditions text,relevant_medications text,
  lifesaving_medications text,ice_contact text,emergency_notes text,medical_data_shared boolean,ice_contact_shared boolean,declared_by_user boolean)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select p.sos_id,p.declared_blood_group,p.severe_allergies,p.important_conditions,p.relevant_medications,p.lifesaving_medications,
    case when coalesce(c.blocked,false) or not coalesce(c.legacy_allowed,true) then null else p.ice_contact end,p.emergency_notes,p.medical_data_shared,
    p.ice_contact_shared and not coalesce(c.blocked,false) and coalesce(c.legacy_allowed,true),p.declared_by_user
  from public._ice15_received_legacy(target_sos_id) as p
  join public.sos as s on s.id=p.sos_id
  left join public.ice_privacy_control as c on c.user_id=s.user_id
  where public._ice15_read_guard() and (p.medical_data_shared or (p.ice_contact_shared and not coalesce(c.blocked,false) and coalesce(c.legacy_allowed,true)));
$$;
create function public.get_received_sos_private_details(target_sos_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare j jsonb; policy public.ice_privacy_control%rowtype;
begin
  perform public._ice15_read_guard();
  j:=public._ice15_received_private(target_sos_id);
  if j is null then return null; end if;
  select c.* into policy from public.ice_privacy_control as c join public.sos as s on c.user_id=s.user_id where s.id=target_sos_id;
  if found and (policy.blocked or not policy.structured_allowed) then
    if (j->>'share_safety')::boolean is distinct from true then return null; end if;
    j:=j||jsonb_build_object('share_ice',false,'share_ice_phone',false,'ice_name',null,'ice_relation',null,'ice_phone',null);
  elsif found and not policy.phone_allowed then
    j:=j||jsonb_build_object('share_ice_phone',false,'ice_phone',null);
  end if;
  return j;
end $$;

-- ONLY this versioned, revision-checked contract may clear a persistent block.
-- It proves an authenticated consent request, not a physical human tap.
create function public.confirm_my_ice_sharing(expected_owner_id uuid,expected_revision bigint,consent_version text,
  enable_legacy boolean,enable_structured boolean,enable_phone boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actual_revision bigint;
begin
  perform public._ice15_lock(expected_owner_id);
  if consent_version is distinct from 'ICE_V1' or expected_revision is null or enable_legacy is null or enable_structured is null
    or enable_phone is null or not(enable_legacy or enable_structured or enable_phone) or (enable_phone and not enable_structured) then
    raise exception 'Explicit versioned consent required' using errcode='22023';
  end if;
  insert into public.ice_privacy_control(user_id) values(expected_owner_id) on conflict(user_id) do nothing;
  select c.revision into strict actual_revision from public.ice_privacy_control as c where c.user_id=expected_owner_id for update;
  if actual_revision<>expected_revision then raise exception 'ICE_CONSENT_REVISION_CHANGED' using errcode='40001'; end if;
  if enable_legacy and not exists(select 1 from public.emergency_profiles as e where e.user_id=expected_owner_id and nullif(btrim(e.ice_contact),'') is not null) then
    raise exception 'ICE content required' using errcode='22023';
  end if;
  if enable_structured and not exists(select 1 from public.emergency_private_details as d where d.user_id=expected_owner_id and d.ice_name is not null
    and (not enable_phone or d.ice_phone is not null)) then raise exception 'Structured ICE content required' using errcode='22023'; end if;
  update public.emergency_profiles as e set share_ice_contact_during_sos=enable_legacy,updated_at=now() where e.user_id=expected_owner_id;
  update public.emergency_private_details as d set share_ice=enable_structured,share_ice_phone=enable_phone,updated_at=now() where d.user_id=expected_owner_id;
  update public.ice_privacy_control as c set blocked=false,legacy_allowed=enable_legacy,structured_allowed=enable_structured,
    phone_allowed=enable_phone,revision=c.revision+1,consent_version='ICE_V1',changed_at=now() where c.user_id=expected_owner_id;
  return public.get_my_ice_privacy_status(expected_owner_id);
end $$;

-- Explicit allowlist; no internal helper is re-granted. Fixed signatures only.
do $$ declare signature_value text;
begin
  foreach signature_value in array array[
    'get_my_emergency_profile()',
    'update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean)',
    'get_received_sos_emergency_profile(uuid)',
    'get_my_emergency_private_details(uuid)',
    'update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean)',
    'delete_my_emergency_private_details(uuid)','get_received_sos_private_details(uuid)',
    'get_my_ice_privacy_status(uuid)','revoke_my_all_ice_sharing(uuid)',
    'confirm_my_ice_sharing(uuid,bigint,text,boolean,boolean,boolean)'
  ] loop
    execute 'alter function public.'||signature_value||' owner to postgres';
    execute 'revoke all on function public.'||signature_value||' from public,anon,authenticated,service_role';
    execute 'grant execute on function public.'||signature_value||' to authenticated';
  end loop;
end $$;
commit;
