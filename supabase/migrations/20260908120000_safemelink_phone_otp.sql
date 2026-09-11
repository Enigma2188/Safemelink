-- One-shot migration. Apply exactly once through the recorded Development
-- migration workflow; a repeated manual execution is expected to fail safely.
begin;

create type public.phone_verification_challenge_status as enum (
  'DELIVERY_PENDING',
  'PENDING',
  'CONSUMED',
  'EXPIRED',
  'INVALIDATED',
  'LOCKED',
  'DELIVERY_FAILED'
);

create type public.phone_verification_rate_action as enum ('REQUEST', 'VERIFY');

create table public.phone_verification_challenges (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_hmac text not null check (char_length(phone_hmac) between 43 and 128),
  phone_ciphertext text not null check (char_length(phone_ciphertext) between 16 and 512),
  phone_nonce text not null check (char_length(phone_nonce) between 12 and 64),
  otp_digest text not null check (char_length(otp_digest) between 43 and 128),
  idempotency_key uuid not null,
  status public.phone_verification_challenge_status not null default 'DELIVERY_PENDING',
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  max_attempts integer not null default 5 check (max_attempts = 5),
  expires_at timestamptz not null,
  resend_available_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  provider_message_reference_hash text,
  last_error_category text check (
    last_error_category is null or char_length(last_error_category) between 2 and 40
  ),
  constraint phone_verification_challenge_window check (
    expires_at > created_at and resend_available_at > created_at and resend_available_at <= expires_at
  ),
  constraint phone_verification_challenge_terminal_state check (
    (status = 'CONSUMED') = (consumed_at is not null)
    and (
      status not in ('INVALIDATED', 'LOCKED', 'DELIVERY_FAILED')
      or invalidated_at is not null
    )
  ),
  unique (user_id, idempotency_key)
);

create unique index phone_verification_one_pending_per_account_idx
  on public.phone_verification_challenges (user_id)
  where status in ('DELIVERY_PENDING', 'PENDING');
create index phone_verification_challenges_phone_idx
  on public.phone_verification_challenges (phone_hmac, created_at desc);
create index phone_verification_challenges_expiry_idx
  on public.phone_verification_challenges (expires_at)
  where status in ('DELIVERY_PENDING', 'PENDING');

create table public.phone_verification_rate_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  phone_hmac text,
  ip_hmac text,
  action public.phone_verification_rate_action not null,
  created_at timestamptz not null default now(),
  constraint phone_verification_rate_identity check (
    phone_hmac is null or char_length(phone_hmac) between 43 and 128
  ),
  constraint phone_verification_rate_ip check (
    ip_hmac is null or char_length(ip_hmac) between 43 and 128
  )
);

create index phone_verification_rate_account_idx
  on public.phone_verification_rate_events (user_id, action, created_at desc);
create index phone_verification_rate_phone_idx
  on public.phone_verification_rate_events (phone_hmac, action, created_at desc)
  where phone_hmac is not null;
create index phone_verification_rate_ip_idx
  on public.phone_verification_rate_events (ip_hmac, action, created_at desc)
  where ip_hmac is not null;

alter table public.phone_verification_challenges enable row level security;
alter table public.phone_verification_rate_events enable row level security;

revoke all on table public.phone_verification_challenges,
  public.phone_verification_rate_events
from public, anon, authenticated;

do $$
begin
  if exists (
    select verification.phone_e164
    from public.account_verifications verification
    where verification.phone_verified_at is not null
    group by verification.phone_e164
    having count(*) > 1
  ) then
    raise exception 'PHONE_VERIFICATION_DUPLICATE_LEGACY_PHONE';
  end if;
end;
$$;

create unique index account_verifications_unique_verified_phone_idx
  on public.account_verifications (phone_e164)
  where phone_verified_at is not null;

create or replace function public.create_phone_verification_challenge(
  target_user_id uuid,
  target_challenge_id uuid,
  target_phone_hmac text,
  target_phone_ciphertext text,
  target_phone_nonce text,
  target_otp_digest text,
  target_idempotency_key uuid,
  target_ip_hmac text default null
) returns table (
  challenge_id uuid,
  challenge_status text,
  challenge_expires_at timestamptz,
  challenge_resend_available_at timestamptz,
  should_send boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.phone_verification_challenges%rowtype;
  now_at timestamptz := clock_timestamp();
begin
  if target_user_id is null or target_challenge_id is null or target_idempotency_key is null
    or target_phone_hmac is null or target_phone_ciphertext is null
    or target_phone_nonce is null or target_otp_digest is null
  then
    raise exception 'PHONE_VERIFICATION_INVALID_INPUT' using errcode = '22023';
  end if;

  -- All request paths acquire locks in this fixed order to serialize the
  -- account, phone and shared-IP rate-limit decisions without deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-number:' || target_phone_hmac, 0));
  if target_ip_hmac is not null then
    perform pg_advisory_xact_lock(hashtextextended('phone-otp-ip:' || target_ip_hmac, 0));
  end if;

  select * into existing
  from public.phone_verification_challenges challenge
  where challenge.user_id = target_user_id
    and challenge.idempotency_key = target_idempotency_key;

  if found then
    return query select existing.id, existing.status::text, existing.expires_at,
      existing.resend_available_at, false;
    return;
  end if;

  if (select count(*) from public.phone_verification_rate_events event
      where event.user_id = target_user_id and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '15 minutes') >= 3
    or (select count(*) from public.phone_verification_rate_events event
      where event.user_id = target_user_id and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '1 hour') >= 5
    or (select count(*) from public.phone_verification_rate_events event
      where event.user_id = target_user_id and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '1 day') >= 10
    or (select count(*) from public.phone_verification_rate_events event
      where event.phone_hmac = target_phone_hmac and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '15 minutes') >= 3
    or (select count(*) from public.phone_verification_rate_events event
      where event.phone_hmac = target_phone_hmac and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '1 hour') >= 5
    or (select count(*) from public.phone_verification_rate_events event
      where event.phone_hmac = target_phone_hmac and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '1 day') >= 10
    or (target_ip_hmac is not null and (select count(*)
      from public.phone_verification_rate_events event
      where event.ip_hmac = target_ip_hmac and event.action = 'REQUEST'
        and event.created_at >= now_at - interval '1 hour') >= 10)
  then
    raise exception 'PHONE_VERIFICATION_RATE_LIMITED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.phone_verification_challenges challenge
    where (challenge.user_id = target_user_id or challenge.phone_hmac = target_phone_hmac)
      and challenge.created_at > now_at - interval '60 seconds'
  ) then
    raise exception 'PHONE_VERIFICATION_COOLDOWN' using errcode = 'P0001';
  end if;

  update public.phone_verification_challenges
  set status = case when expires_at <= now_at then 'EXPIRED' else 'INVALIDATED' end,
      invalidated_at = case when expires_at <= now_at then invalidated_at else now_at end,
      last_error_category = case when expires_at <= now_at then 'expired' else 'superseded' end
  where user_id = target_user_id and status in ('DELIVERY_PENDING', 'PENDING');

  insert into public.phone_verification_rate_events (
    user_id, phone_hmac, ip_hmac, action, created_at
  ) values (
    target_user_id, target_phone_hmac, target_ip_hmac, 'REQUEST', now_at
  );

  insert into public.phone_verification_challenges (
    id, user_id, phone_hmac, phone_ciphertext, phone_nonce, otp_digest,
    idempotency_key, expires_at, resend_available_at, created_at
  ) values (
    target_challenge_id, target_user_id, target_phone_hmac, target_phone_ciphertext,
    target_phone_nonce, target_otp_digest, target_idempotency_key,
    now_at + interval '10 minutes', now_at + interval '60 seconds', now_at
  );

  return query select target_challenge_id, 'DELIVERY_PENDING'::text,
    now_at + interval '10 minutes', now_at + interval '60 seconds', true;
end;
$$;

create or replace function public.mark_phone_verification_delivery(
  target_user_id uuid,
  target_challenge_id uuid,
  delivery_succeeded boolean,
  target_provider_reference_hash text default null,
  target_error_category text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare affected integer;
begin
  update public.phone_verification_challenges
  set provider_message_reference_hash = case when delivery_succeeded then target_provider_reference_hash else null end,
      last_error_category = case when delivery_succeeded then null else coalesce(target_error_category, 'provider') end,
      status = case when delivery_succeeded then 'PENDING' else 'DELIVERY_FAILED' end,
      invalidated_at = case when delivery_succeeded then invalidated_at else clock_timestamp() end
  where id = target_challenge_id and user_id = target_user_id and status = 'DELIVERY_PENDING';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.verify_phone_verification_challenge(
  target_user_id uuid,
  target_challenge_id uuid,
  candidate_matches boolean,
  target_phone_hmac text,
  target_phone_e164 text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  challenge public.phone_verification_challenges%rowtype;
  now_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  select * into challenge
  from public.phone_verification_challenges
  where id = target_challenge_id and user_id = target_user_id
  for update;

  if not found then return 'not_found'; end if;

  -- Serialize every VERIFY rate-limit decision for the same normalized phone
  -- after the account/challenge locks and before any phone count or event insert.
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-number:' || challenge.phone_hmac, 0));

  if challenge.status = 'CONSUMED' then
    if exists (select 1 from public.account_verifications verification
      where verification.user_id = target_user_id
        and verification.phone_verified_at is not null
        and verification.verification_source = 'safemelink_phone_otp')
    then return 'already_verified'; end if;
    return 'unavailable';
  end if;
  if challenge.status <> 'PENDING' then return lower(challenge.status::text); end if;
  if challenge.expires_at <= now_at then
    update public.phone_verification_challenges
    set status = 'EXPIRED', last_error_category = 'expired'
    where id = challenge.id;
    return 'expired';
  end if;
  if challenge.attempt_count >= challenge.max_attempts then
    update public.phone_verification_challenges
    set status = 'LOCKED', invalidated_at = now_at, last_error_category = 'attempt_limit'
    where id = challenge.id;
    return 'locked';
  end if;

  if (select count(*) from public.phone_verification_rate_events event
      where event.user_id = target_user_id and event.action = 'VERIFY'
        and event.created_at >= now_at - interval '1 hour') >= 20
    or (select count(*) from public.phone_verification_rate_events event
      where event.phone_hmac = challenge.phone_hmac and event.action = 'VERIFY'
        and event.created_at >= now_at - interval '1 hour') >= 20
  then
    return 'rate_limited';
  end if;

  insert into public.phone_verification_rate_events (
    user_id, phone_hmac, action, created_at
  ) values (target_user_id, challenge.phone_hmac, 'VERIFY', now_at);

  if challenge.phone_hmac <> target_phone_hmac
    or candidate_matches is distinct from true
  then
    update public.phone_verification_challenges
    set attempt_count = attempt_count + 1,
        status = case when attempt_count + 1 >= max_attempts then 'LOCKED' else status end,
        invalidated_at = case when attempt_count + 1 >= max_attempts then now_at else invalidated_at end,
        last_error_category = case when attempt_count + 1 >= max_attempts then 'attempt_limit' else 'invalid_code' end
    where id = challenge.id;
    return case when challenge.attempt_count + 1 >= challenge.max_attempts then 'locked' else 'invalid_code' end;
  end if;

  if target_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then return 'invalid_phone'; end if;

  if exists (
    select 1 from public.account_verifications verification
    where verification.phone_e164 = target_phone_e164
      and verification.phone_verified_at is not null
      and verification.user_id <> target_user_id
  ) then
    update public.phone_verification_challenges
    set status = 'INVALIDATED', invalidated_at = now_at, last_error_category = 'phone_unavailable'
    where id = challenge.id;
    return 'phone_unavailable';
  end if;

  begin
    insert into public.account_verifications (
      user_id, phone_e164, phone_verified_at, verification_source, updated_at
    ) values (
      target_user_id, target_phone_e164, now_at, 'safemelink_phone_otp', now_at
    )
    on conflict (user_id) do update set
      phone_e164 = excluded.phone_e164,
      phone_verified_at = excluded.phone_verified_at,
      verification_source = excluded.verification_source,
      updated_at = excluded.updated_at;
  exception when unique_violation then
    update public.phone_verification_challenges
    set status = 'INVALIDATED', invalidated_at = now_at, last_error_category = 'phone_unavailable'
    where id = challenge.id;
    return 'phone_unavailable';
  end;

  update public.phone_verification_challenges
  set status = 'CONSUMED', consumed_at = now_at, last_error_category = null
  where id = challenge.id;
  return 'verified';
end;
$$;

create or replace function public.cancel_phone_verification_challenge(
  target_user_id uuid,
  target_challenge_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare affected integer;
begin
  update public.phone_verification_challenges
  set status = 'INVALIDATED', invalidated_at = clock_timestamp(), last_error_category = 'cancelled'
  where id = target_challenge_id and user_id = target_user_id
    and status in ('DELIVERY_PENDING', 'PENDING');
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.cleanup_phone_verification_data()
returns table (deleted_challenges bigint, deleted_rate_events bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare challenge_count bigint; rate_count bigint;
begin
  update public.phone_verification_challenges
  set status = 'EXPIRED', last_error_category = 'expired'
  where status in ('DELIVERY_PENDING', 'PENDING') and expires_at <= clock_timestamp();

  delete from public.phone_verification_challenges
  where created_at < clock_timestamp() - interval '72 hours';
  get diagnostics challenge_count = row_count;

  delete from public.phone_verification_rate_events
  -- The longest configured anti-abuse window is one day. HMAC-only events
  -- survive account deletion until this bounded window has elapsed.
  where created_at < clock_timestamp() - interval '1 day';
  get diagnostics rate_count = row_count;

  return query select challenge_count, rate_count;
end;
$$;

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
    join public.account_verifications verification
      on verification.user_id = auth_user.id
      and verification.phone_verified_at is not null
      and verification.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and verification.verification_source = 'safemelink_phone_otp'
    join public.network_preferences preference on preference.user_id = auth_user.id
    join public.network_config config on config.singleton
    where auth_user.id = target_user_id
      and auth_user.email_confirmed_at is not null
      and nullif(btrim(profile.nickname), '') is not null
      and preference.accepted_at is not null
      and preference.network_terms_version = config.current_terms_version
  );
$$;

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

revoke all on function public.create_phone_verification_challenge(uuid, uuid, text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_phone_verification_delivery(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
revoke all on function public.verify_phone_verification_challenge(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_phone_verification_challenge(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.cleanup_phone_verification_data()
  from public, anon, authenticated;
revoke all on function public.network_user_is_eligible(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_network_onboarding_status()
  from public, anon;

grant execute on function public.create_phone_verification_challenge(uuid, uuid, text, text, text, text, uuid, text)
  to service_role;
grant execute on function public.mark_phone_verification_delivery(uuid, uuid, boolean, text, text)
  to service_role;
grant execute on function public.verify_phone_verification_challenge(uuid, uuid, boolean, text, text)
  to service_role;
grant execute on function public.cancel_phone_verification_challenge(uuid, uuid)
  to service_role;
grant execute on function public.cleanup_phone_verification_data()
  to service_role;
grant execute on function public.get_my_network_onboarding_status()
  to authenticated;

commit;
