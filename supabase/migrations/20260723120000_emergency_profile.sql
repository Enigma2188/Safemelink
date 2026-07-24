begin;

create table public.emergency_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  declared_blood_group text,
  severe_allergies text,
  important_conditions text,
  relevant_medications text,
  lifesaving_medications text,
  ice_contact text,
  emergency_notes text,
  share_medical_data_during_sos boolean not null default false,
  share_ice_contact_during_sos boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint emergency_profiles_blood_group_valid check (
    declared_blood_group is null
    or declared_blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
  ),
  constraint emergency_profiles_allergies_length check (
    severe_allergies is null or char_length(severe_allergies) <= 1000
  ),
  constraint emergency_profiles_conditions_length check (
    important_conditions is null or char_length(important_conditions) <= 1000
  ),
  constraint emergency_profiles_medications_length check (
    relevant_medications is null or char_length(relevant_medications) <= 1000
  ),
  constraint emergency_profiles_lifesaving_length check (
    lifesaving_medications is null or char_length(lifesaving_medications) <= 1000
  ),
  constraint emergency_profiles_ice_length check (
    ice_contact is null or char_length(ice_contact) <= 300
  ),
  constraint emergency_profiles_notes_length check (
    emergency_notes is null or char_length(emergency_notes) <= 2000
  )
);

comment on table public.emergency_profiles is
  'Optional, user-declared emergency data. Never exposed through public profiles or Radar.';

alter table public.emergency_profiles enable row level security;

-- Sensitive data is accessible only through the authenticated, scoped RPC functions below.
revoke all on table public.emergency_profiles from anon, authenticated;

create or replace function public.get_my_emergency_profile()
returns table (
  declared_blood_group text,
  severe_allergies text,
  important_conditions text,
  relevant_medications text,
  lifesaving_medications text,
  ice_contact text,
  emergency_notes text,
  share_medical_data_during_sos boolean,
  share_ice_contact_during_sos boolean,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  insert into public.emergency_profiles (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  return query
  select
    emergency_profile.declared_blood_group,
    emergency_profile.severe_allergies,
    emergency_profile.important_conditions,
    emergency_profile.relevant_medications,
    emergency_profile.lifesaving_medications,
    emergency_profile.ice_contact,
    emergency_profile.emergency_notes,
    emergency_profile.share_medical_data_during_sos,
    emergency_profile.share_ice_contact_during_sos,
    emergency_profile.updated_at
  from public.emergency_profiles emergency_profile
  where emergency_profile.user_id = current_user_id;
end;
$$;

create or replace function public.update_my_emergency_profile(
  next_declared_blood_group text,
  next_severe_allergies text,
  next_important_conditions text,
  next_relevant_medications text,
  next_lifesaving_medications text,
  next_ice_contact text,
  next_emergency_notes text,
  next_share_medical_data_during_sos boolean,
  next_share_ice_contact_during_sos boolean
)
returns table (
  declared_blood_group text,
  severe_allergies text,
  important_conditions text,
  relevant_medications text,
  lifesaving_medications text,
  ice_contact text,
  emergency_notes text,
  share_medical_data_during_sos boolean,
  share_ice_contact_during_sos boolean,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_blood_group text := nullif(
    replace(upper(btrim(next_declared_blood_group)), '0', 'O'),
    ''
  );
  normalized_allergies text := nullif(btrim(next_severe_allergies), '');
  normalized_conditions text := nullif(btrim(next_important_conditions), '');
  normalized_medications text := nullif(btrim(next_relevant_medications), '');
  normalized_lifesaving text := nullif(btrim(next_lifesaving_medications), '');
  normalized_ice_contact text := nullif(btrim(next_ice_contact), '');
  normalized_notes text := nullif(btrim(next_emergency_notes), '');
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if next_share_medical_data_during_sos is null
     or next_share_ice_contact_during_sos is null then
    raise exception 'Sharing preferences are required.' using errcode = '22023';
  end if;

  if normalized_blood_group is not null
     and normalized_blood_group not in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') then
    raise exception 'Invalid declared blood group.' using errcode = '22023';
  end if;

  if char_length(coalesce(normalized_allergies, '')) > 1000
     or char_length(coalesce(normalized_conditions, '')) > 1000
     or char_length(coalesce(normalized_medications, '')) > 1000
     or char_length(coalesce(normalized_lifesaving, '')) > 1000
     or char_length(coalesce(normalized_ice_contact, '')) > 300
     or char_length(coalesce(normalized_notes, '')) > 2000 then
    raise exception 'Emergency profile field is too long.' using errcode = '22001';
  end if;

  insert into public.emergency_profiles (
    user_id,
    declared_blood_group,
    severe_allergies,
    important_conditions,
    relevant_medications,
    lifesaving_medications,
    ice_contact,
    emergency_notes,
    share_medical_data_during_sos,
    share_ice_contact_during_sos,
    updated_at
  )
  values (
    current_user_id,
    normalized_blood_group,
    normalized_allergies,
    normalized_conditions,
    normalized_medications,
    normalized_lifesaving,
    normalized_ice_contact,
    normalized_notes,
    next_share_medical_data_during_sos,
    next_share_ice_contact_during_sos,
    now()
  )
  on conflict (user_id) do update
  set declared_blood_group = excluded.declared_blood_group,
      severe_allergies = excluded.severe_allergies,
      important_conditions = excluded.important_conditions,
      relevant_medications = excluded.relevant_medications,
      lifesaving_medications = excluded.lifesaving_medications,
      ice_contact = excluded.ice_contact,
      emergency_notes = excluded.emergency_notes,
      share_medical_data_during_sos = excluded.share_medical_data_during_sos,
      share_ice_contact_during_sos = excluded.share_ice_contact_during_sos,
      updated_at = now();

  return query
  select
    emergency_profile.declared_blood_group,
    emergency_profile.severe_allergies,
    emergency_profile.important_conditions,
    emergency_profile.relevant_medications,
    emergency_profile.lifesaving_medications,
    emergency_profile.ice_contact,
    emergency_profile.emergency_notes,
    emergency_profile.share_medical_data_during_sos,
    emergency_profile.share_ice_contact_during_sos,
    emergency_profile.updated_at
  from public.emergency_profiles emergency_profile
  where emergency_profile.user_id = current_user_id;
end;
$$;

create or replace function public.get_received_sos_emergency_profile(target_sos_id uuid)
returns table (
  sos_id uuid,
  declared_blood_group text,
  severe_allergies text,
  important_conditions text,
  relevant_medications text,
  lifesaving_medications text,
  ice_contact text,
  emergency_notes text,
  medical_data_shared boolean,
  ice_contact_shared boolean,
  declared_by_user boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    emergency_sos.id,
    case when emergency_profile.share_medical_data_during_sos
      then emergency_profile.declared_blood_group else null end,
    case when emergency_profile.share_medical_data_during_sos
      then emergency_profile.severe_allergies else null end,
    case when emergency_profile.share_medical_data_during_sos
      then emergency_profile.important_conditions else null end,
    case when emergency_profile.share_medical_data_during_sos
      then emergency_profile.relevant_medications else null end,
    case when emergency_profile.share_medical_data_during_sos
      then emergency_profile.lifesaving_medications else null end,
    case when emergency_profile.share_ice_contact_during_sos
      then emergency_profile.ice_contact else null end,
    case when emergency_profile.share_medical_data_during_sos
      then emergency_profile.emergency_notes else null end,
    emergency_profile.share_medical_data_during_sos,
    emergency_profile.share_ice_contact_during_sos,
    true
  from public.sos emergency_sos
  join public.emergency_profiles emergency_profile
    on emergency_profile.user_id = emergency_sos.user_id
  where emergency_sos.id = target_sos_id
    and emergency_sos.status in ('open', 'accepted')
    and auth.uid() is not null
    and (
      emergency_sos.user_id = auth.uid()
      or exists (
        select 1
        from public.trusted_contacts trusted_contact
        where trusted_contact.user_id = emergency_sos.user_id
          and trusted_contact.linked_profile_id = auth.uid()
      )
    )
    and (
      emergency_profile.share_medical_data_during_sos = true
      or emergency_profile.share_ice_contact_during_sos = true
    );
$$;

revoke all on function public.get_my_emergency_profile() from public;
revoke all on function public.update_my_emergency_profile(
  text, text, text, text, text, text, text, boolean, boolean
) from public;
revoke all on function public.get_received_sos_emergency_profile(uuid) from public;

grant execute on function public.get_my_emergency_profile() to authenticated;
grant execute on function public.update_my_emergency_profile(
  text, text, text, text, text, text, text, boolean, boolean
) to authenticated;
grant execute on function public.get_received_sos_emergency_profile(uuid) to authenticated;

commit;
