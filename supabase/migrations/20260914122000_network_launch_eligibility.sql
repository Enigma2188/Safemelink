begin;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.profiles
  drop constraint if exists profiles_first_name_length,
  drop constraint if exists profiles_last_name_length;

alter table public.profiles
  add constraint profiles_first_name_length
    check (first_name is null or char_length(btrim(first_name)) between 2 and 60),
  add constraint profiles_last_name_length
    check (last_name is null or char_length(btrim(last_name)) between 2 and 60);

create or replace function public.network_user_is_eligible(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from auth.users auth_user
    join public.profiles profile on profile.id = auth_user.id
    join public.network_preferences preference on preference.user_id = auth_user.id
    join public.network_config config on config.singleton
    where auth_user.id = target_user_id
      and auth_user.email_confirmed_at is not null
      and char_length(btrim(coalesce(profile.first_name, ''))) between 2 and 60
      and char_length(btrim(coalesce(profile.last_name, ''))) between 2 and 60
      and char_length(btrim(coalesce(profile.nickname, ''))) between 2 and 40
      and char_length(regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')) between 6 and 15
      and preference.accepted_at is not null
      and preference.network_terms_version = config.current_terms_version
  );
$$;

drop function public.get_my_network_onboarding_status();

create function public.get_my_network_onboarding_status()
returns table (
  email_verified boolean,
  first_name_present boolean,
  last_name_present boolean,
  nickname_present boolean,
  phone_present boolean,
  phone_verified boolean,
  current_terms_version text,
  accepted_terms_version text,
  terms_accepted boolean,
  eligible boolean,
  restriction_status text,
  first_name text,
  last_name text,
  nickname text,
  phone text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  return query
  select
    auth_user.email_confirmed_at is not null,
    char_length(btrim(coalesce(profile.first_name, ''))) between 2 and 60,
    char_length(btrim(coalesce(profile.last_name, ''))) between 2 and 60,
    char_length(btrim(coalesce(profile.nickname, ''))) between 2 and 40,
    char_length(regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')) between 6 and 15,
    verification.phone_verified_at is not null
      and verification.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and verification.verification_source = 'safemelink_phone_otp',
    config.current_terms_version,
    preference.network_terms_version,
    preference.accepted_at is not null
      and preference.network_terms_version = config.current_terms_version,
    public.network_user_is_eligible(actor),
    coalesce((
      select restriction.restriction_type::text
      from public.network_user_restrictions restriction
      where restriction.user_id = actor
        and restriction.starts_at <= now()
        and (restriction.expires_at is null or restriction.expires_at > now())
      order by case restriction.restriction_type
        when 'FULL_NETWORK_BLOCKED' then 0
        when 'READ_ONLY' then 1
        when 'PUBLISH_BLOCKED' then 2
        when 'INTERACTIONS_BLOCKED' then 3
      end
      limit 1
    ), 'NONE'),
    nullif(btrim(profile.first_name), ''),
    nullif(btrim(profile.last_name), ''),
    nullif(btrim(profile.nickname), ''),
    nullif(btrim(profile.phone), '')
  from auth.users auth_user
  join public.profiles profile on profile.id = auth_user.id
  join public.network_config config on config.singleton
  left join public.account_verifications verification on verification.user_id = actor
  left join public.network_preferences preference on preference.user_id = actor
  where auth_user.id = actor;
end;
$$;

create or replace function public.update_my_network_identity(
  target_first_name text,
  target_last_name text,
  target_nickname text,
  target_phone text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(target_first_name, ''))) not between 2 and 60
    or char_length(btrim(coalesce(target_last_name, ''))) not between 2 and 60
    or char_length(btrim(coalesce(target_nickname, ''))) not between 2 and 40
    or char_length(btrim(coalesce(target_phone, ''))) not between 6 and 32
    or char_length(regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g')) not between 6 and 15
  then raise exception 'NETWORK_INVALID_PROFILE' using errcode = '22023'; end if;

  update public.profiles
  set first_name = btrim(target_first_name),
      last_name = btrim(target_last_name),
      nickname = btrim(target_nickname),
      phone = btrim(target_phone)
  where id = actor;
  if not found then raise exception 'Profile unavailable.' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.network_user_is_eligible(uuid) from public, anon, authenticated;
revoke all on function public.get_my_network_onboarding_status() from public, anon;
revoke all on function public.update_my_network_identity(text, text, text, text) from public, anon;
grant execute on function public.get_my_network_onboarding_status() to authenticated;
grant execute on function public.update_my_network_identity(text, text, text, text) to authenticated;

commit;
