begin;

-- NETWORK runtime compatibility: the Android client needs this authenticated
-- status RPC even when the dedicated Phone OTP migration is deployed later.
create or replace function public.get_my_network_onboarding_status()
returns table (
  email_verified boolean,
  nickname_present boolean,
  phone_verified boolean,
  current_terms_version text,
  accepted_terms_version text,
  terms_accepted boolean,
  eligible boolean,
  restriction_status text,
  nickname text
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
    nullif(btrim(profile.nickname), '') is not null,
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
    nullif(btrim(profile.nickname), '')
  from auth.users auth_user
  join public.profiles profile on profile.id = auth_user.id
  join public.network_config config on config.singleton
  left join public.account_verifications verification on verification.user_id = actor
  left join public.network_preferences preference on preference.user_id = actor
  where auth_user.id = actor;
end;
$$;

revoke all on function public.get_my_network_onboarding_status() from public, anon;
grant execute on function public.get_my_network_onboarding_status() to authenticated;

-- Five kilometres is the single MVP feed radius. Existing rows at the former
-- one-kilometre default are migrated; any other explicit value is preserved.
alter table public.network_config
  alter column default_feed_radius_meters set default 5000;
alter table public.network_preferences
  alter column feed_radius_meters set default 5000;

update public.network_config
set default_feed_radius_meters = 5000,
    max_feed_radius_meters = 5000,
    updated_at = now()
where singleton
  and (default_feed_radius_meters is distinct from 5000
    or max_feed_radius_meters is distinct from 5000);

update public.network_preferences
set feed_radius_meters = 5000,
    updated_at = now()
where feed_radius_meters = 1000;

commit;
