-- Additive Phone OTP V2 operation contract. V1 remains available during rollout.
begin;

create type public.phone_verification_operation_status as enum (
  'INITIALIZED', 'DELIVERY_PENDING', 'PENDING', 'COMPLETED',
  'DELIVERY_FAILED', 'FAILED', 'CANCELLED'
);

create table public.phone_verification_operations (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_hmac text,
  status public.phone_verification_operation_status not null default 'INITIALIZED',
  result_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  cleanup_completed_at timestamptz,
  delivery_attempt_id uuid,
  delivery_lease_expires_at timestamptz,
  delivery_completed_attempt_id uuid,
  constraint phone_verification_operations_phone_hmac_check
    check (phone_hmac is null or char_length(phone_hmac) between 43 and 128),
  constraint phone_verification_operations_result_check
    check (result_code is null or char_length(result_code) between 2 and 40),
  constraint phone_verification_operations_terminal_check check (
    (status in ('COMPLETED', 'DELIVERY_FAILED', 'FAILED', 'CANCELLED') and terminal_at is not null)
    or (status in ('INITIALIZED', 'DELIVERY_PENDING', 'PENDING') and terminal_at is null)
  ),
  constraint phone_verification_operations_delivery_lease_check check (
    (delivery_attempt_id is null) = (delivery_lease_expires_at is null)
  ),
  unique (id, user_id)
);

create table public.phone_verification_attempts (
  operation_id uuid not null references public.phone_verification_operations(id) on delete cascade,
  attempt_id uuid not null,
  candidate_fingerprint text not null check (char_length(candidate_fingerprint) between 43 and 128),
  result_code text check (result_code is null or char_length(result_code) between 2 and 40),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (operation_id, attempt_id)
);

create index phone_verification_operations_user_created_idx
  on public.phone_verification_operations (user_id, created_at desc);
create index phone_verification_operations_user_status_idx
  on public.phone_verification_operations (user_id, status, updated_at desc);
create index phone_verification_operations_terminal_idx
  on public.phone_verification_operations (terminal_at)
  where status in ('COMPLETED', 'DELIVERY_FAILED', 'FAILED', 'CANCELLED');

create function public.enforce_phone_verification_operation_identity()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id is distinct from old.user_id
    or (old.phone_hmac is not null and new.phone_hmac is distinct from old.phone_hmac)
    or (old.phone_hmac is null and new.phone_hmac is not null and old.status <> 'INITIALIZED')
  then raise exception 'PHONE_VERIFICATION_OPERATION_IDENTITY_IMMUTABLE' using errcode = '22023'; end if;
  return new;
end; $$;

create trigger phone_verification_operation_identity_immutable
before update on public.phone_verification_operations
for each row execute function public.enforce_phone_verification_operation_identity();

alter table public.account_verifications
  add column verification_operation_id uuid
  references public.phone_verification_operations(id) on delete restrict;

create unique index account_verifications_verification_operation_uidx
  on public.account_verifications (verification_operation_id)
  where verification_operation_id is not null;

alter table public.account_verifications
  add constraint account_verifications_operation_owner_fk
  foreign key (verification_operation_id, user_id)
  references public.phone_verification_operations (id, user_id)
  on delete restrict;

alter table public.phone_verification_challenges
  add column otp_ciphertext text,
  add column otp_nonce text,
  add constraint phone_verification_challenges_otp_ciphertext_check
    check (otp_ciphertext is null or char_length(otp_ciphertext) between 16 and 256),
  add constraint phone_verification_challenges_otp_nonce_check
    check (otp_nonce is null or char_length(otp_nonce) between 12 and 64),
  add constraint phone_verification_challenges_otp_encryption_pair_check
    check ((otp_ciphertext is null) = (otp_nonce is null));

alter table public.phone_verification_operations enable row level security;
alter table public.phone_verification_attempts enable row level security;
revoke all on table public.phone_verification_operations,
  public.phone_verification_attempts from public, anon, authenticated;

create or replace function public.create_phone_verification_challenge_v2(
  target_user_id uuid, target_operation_id uuid, target_phone_hmac text,
  target_phone_ciphertext text, target_phone_nonce text, target_otp_digest text,
  target_otp_ciphertext text, target_otp_nonce text,
  target_ip_hmac text default null
) returns table (
  operation_id uuid, operation_status text, challenge_expires_at timestamptz,
  challenge_resend_available_at timestamptz, should_send boolean, result_code text,
  delivery_attempt_id uuid, delivery_lease_expires_at timestamptz,
  persisted_phone_ciphertext text, persisted_phone_nonce text,
  persisted_otp_ciphertext text, persisted_otp_nonce text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  operation public.phone_verification_operations%rowtype;
  challenge public.phone_verification_challenges%rowtype;
  now_at timestamptz := clock_timestamp();
begin
  if target_user_id is null or target_operation_id is null or target_phone_hmac is null
    or target_phone_ciphertext is null or target_phone_nonce is null or target_otp_digest is null
    or target_otp_ciphertext is null or target_otp_nonce is null
  then raise exception 'PHONE_VERIFICATION_INVALID_INPUT' using errcode = '22023'; end if;

  insert into public.phone_verification_operations (id, user_id)
  values (target_operation_id, target_user_id) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  select * into operation from public.phone_verification_operations
    where id = target_operation_id for update;

  if operation.user_id <> target_user_id
    or (operation.phone_hmac is not null and operation.phone_hmac <> target_phone_hmac)
  then raise exception 'PHONE_VERIFICATION_OPERATION_CONFLICT' using errcode = '22023'; end if;

  if operation.status <> 'INITIALIZED' then
    select * into challenge from public.phone_verification_challenges
      where id = target_operation_id and user_id = target_user_id for update;
    if operation.status = 'DELIVERY_PENDING'
      and operation.delivery_lease_expires_at <= now_at then
      if challenge.id is null then
        update public.phone_verification_operations set status = 'FAILED',
          result_code = 'challenge_missing', updated_at = now_at, terminal_at = now_at,
          delivery_attempt_id = null, delivery_lease_expires_at = null
        where id = target_operation_id returning * into operation;
        return query select operation.id, operation.status::text, null::timestamptz,
          null::timestamptz, false, operation.result_code, null::uuid, null::timestamptz,
          null::text, null::text, null::text, null::text;
        return;
      end if;
      if challenge.status <> 'DELIVERY_PENDING' or challenge.expires_at <= now_at
        or challenge.invalidated_at is not null or challenge.consumed_at is not null
        or challenge.otp_ciphertext is null or challenge.otp_nonce is null then
        update public.phone_verification_challenges set
          status = case when expires_at <= now_at then 'EXPIRED'::public.phone_verification_challenge_status
            when status = 'DELIVERY_PENDING' then 'INVALIDATED'::public.phone_verification_challenge_status
            else status end,
          invalidated_at = case when expires_at > now_at and status = 'DELIVERY_PENDING'
            then now_at else invalidated_at end,
          last_error_category = case when expires_at <= now_at then 'expired' else 'challenge_invalid' end,
          otp_ciphertext = null, otp_nonce = null
        where id = target_operation_id and user_id = target_user_id;
        update public.phone_verification_operations set status = 'FAILED',
          result_code = case when challenge.expires_at <= now_at then 'expired' else 'challenge_invalid' end,
          updated_at = now_at, terminal_at = now_at,
          delivery_attempt_id = null, delivery_lease_expires_at = null
        where id = target_operation_id returning * into operation;
        return query select operation.id, operation.status::text, challenge.expires_at,
          challenge.resend_available_at, false, operation.result_code,
          null::uuid, null::timestamptz, null::text, null::text, null::text, null::text;
        return;
      end if;
      update public.phone_verification_operations set delivery_attempt_id = gen_random_uuid(),
        delivery_lease_expires_at = now_at + interval '2 minutes', updated_at = now_at
      where id = target_operation_id returning * into operation;
      return query select operation.id, operation.status::text, challenge.expires_at,
        challenge.resend_available_at, true, operation.result_code,
        operation.delivery_attempt_id, operation.delivery_lease_expires_at,
        challenge.phone_ciphertext, challenge.phone_nonce,
        challenge.otp_ciphertext, challenge.otp_nonce;
      return;
    end if;
    return query select operation.id, operation.status::text, challenge.expires_at,
      challenge.resend_available_at, false, operation.result_code,
      operation.delivery_attempt_id, operation.delivery_lease_expires_at,
      null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Account-first serialization prevents VERIFY(A)/CREATE(B) lock inversion.
  perform 1 from public.phone_verification_operations previous
    where previous.user_id = target_user_id and previous.id <> target_operation_id
      and previous.status in ('INITIALIZED','DELIVERY_PENDING','PENDING')
    order by previous.id for update;
  update public.phone_verification_challenges set status = 'INVALIDATED',
    invalidated_at = now_at, last_error_category = 'superseded',
    otp_ciphertext = null, otp_nonce = null
    where user_id = target_user_id and id <> target_operation_id
      and status in ('DELIVERY_PENDING','PENDING');
  update public.phone_verification_operations set status = 'FAILED',
    result_code = 'superseded', updated_at = now_at, terminal_at = now_at,
    delivery_attempt_id = null, delivery_lease_expires_at = null
    where user_id = target_user_id and id <> target_operation_id
      and status in ('INITIALIZED','DELIVERY_PENDING','PENDING');
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-number:' || target_phone_hmac, 0));
  if target_ip_hmac is not null then
    perform pg_advisory_xact_lock(hashtextextended('phone-otp-ip:' || target_ip_hmac, 0));
  end if;

  if (select count(*) from public.phone_verification_rate_events e where e.user_id = target_user_id and e.action = 'REQUEST' and e.created_at >= now_at - interval '15 minutes') >= 3
    or (select count(*) from public.phone_verification_rate_events e where e.user_id = target_user_id and e.action = 'REQUEST' and e.created_at >= now_at - interval '1 hour') >= 5
    or (select count(*) from public.phone_verification_rate_events e where e.user_id = target_user_id and e.action = 'REQUEST' and e.created_at >= now_at - interval '1 day') >= 10
    or (select count(*) from public.phone_verification_rate_events e where e.phone_hmac = target_phone_hmac and e.action = 'REQUEST' and e.created_at >= now_at - interval '15 minutes') >= 3
    or (select count(*) from public.phone_verification_rate_events e where e.phone_hmac = target_phone_hmac and e.action = 'REQUEST' and e.created_at >= now_at - interval '1 hour') >= 5
    or (select count(*) from public.phone_verification_rate_events e where e.phone_hmac = target_phone_hmac and e.action = 'REQUEST' and e.created_at >= now_at - interval '1 day') >= 10
    or (target_ip_hmac is not null and (select count(*) from public.phone_verification_rate_events e where e.ip_hmac = target_ip_hmac and e.action = 'REQUEST' and e.created_at >= now_at - interval '1 hour') >= 10)
  then raise exception 'PHONE_VERIFICATION_RATE_LIMITED' using errcode = 'P0001'; end if;

  if exists (select 1 from public.phone_verification_challenges c
    where (c.user_id = target_user_id or c.phone_hmac = target_phone_hmac)
      and c.created_at > now_at - interval '60 seconds')
  then raise exception 'PHONE_VERIFICATION_COOLDOWN' using errcode = 'P0001'; end if;

  update public.phone_verification_challenges set
    status = case when expires_at <= now_at then 'EXPIRED' else 'INVALIDATED' end,
    invalidated_at = case when expires_at <= now_at then invalidated_at else now_at end,
    last_error_category = case when expires_at <= now_at then 'expired' else 'superseded' end
  where user_id = target_user_id and status in ('DELIVERY_PENDING', 'PENDING');

  insert into public.phone_verification_rate_events (user_id, phone_hmac, ip_hmac, action, created_at)
    values (target_user_id, target_phone_hmac, target_ip_hmac, 'REQUEST', now_at);
  insert into public.phone_verification_challenges (
    id, user_id, phone_hmac, phone_ciphertext, phone_nonce, otp_digest, otp_ciphertext, otp_nonce,
    idempotency_key, expires_at, resend_available_at, created_at
  ) values (
    target_operation_id, target_user_id, target_phone_hmac, target_phone_ciphertext,
    target_phone_nonce, target_otp_digest, target_otp_ciphertext, target_otp_nonce, target_operation_id,
    now_at + interval '10 minutes', now_at + interval '60 seconds', now_at
  );
  update public.phone_verification_operations set phone_hmac = target_phone_hmac,
    status = 'DELIVERY_PENDING', updated_at = now_at,
    delivery_attempt_id = gen_random_uuid(), delivery_lease_expires_at = now_at + interval '2 minutes'
    where id = target_operation_id returning * into operation;
  return query select target_operation_id, 'DELIVERY_PENDING'::text,
    now_at + interval '10 minutes', now_at + interval '60 seconds', true, null::text,
    operation.delivery_attempt_id, operation.delivery_lease_expires_at,
    target_phone_ciphertext, target_phone_nonce, target_otp_ciphertext, target_otp_nonce;
end; $$;

create or replace function public.mark_phone_verification_delivery_v2(
  target_user_id uuid, target_operation_id uuid, target_delivery_attempt_id uuid,
  delivery_succeeded boolean,
  target_provider_reference_hash text default null, target_error_category text default null
) returns table (operation_status text, result_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare operation public.phone_verification_operations%rowtype; now_at timestamptz := clock_timestamp(); affected integer;
begin
  insert into public.phone_verification_operations (id, user_id, status, result_code, terminal_at)
    values (target_operation_id, target_user_id, 'CANCELLED', 'not_started', now_at)
    on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  select * into operation from public.phone_verification_operations where id = target_operation_id for update;
  if operation.user_id <> target_user_id then raise exception 'PHONE_VERIFICATION_OPERATION_CONFLICT' using errcode = '22023'; end if;
  if operation.status = 'DELIVERY_PENDING' then
    if operation.delivery_attempt_id is distinct from target_delivery_attempt_id
      or operation.delivery_lease_expires_at <= now_at then
      raise exception 'PHONE_VERIFICATION_DELIVERY_STALE' using errcode = 'P0001'; end if;
        update public.phone_verification_challenges set
      provider_message_reference_hash = case when delivery_succeeded then target_provider_reference_hash else null end,
      last_error_category = case when delivery_succeeded then null else coalesce(target_error_category, 'provider') end,
      status = case when delivery_succeeded then 'PENDING' else 'DELIVERY_FAILED' end,
      invalidated_at = case when delivery_succeeded then invalidated_at else now_at end,
      otp_ciphertext = null, otp_nonce = null
    where id = target_operation_id and user_id = target_user_id and status = 'DELIVERY_PENDING';
    get diagnostics affected = row_count;
    if affected <> 1 then
      raise exception 'PHONE_VERIFICATION_DELIVERY_CHALLENGE_CONFLICT' using errcode = 'P0001';
    end if;
    update public.phone_verification_operations set
      status = case when delivery_succeeded then 'PENDING' else 'DELIVERY_FAILED' end,
      result_code = case when delivery_succeeded then null else 'delivery_failed' end,
      updated_at = now_at, terminal_at = case when delivery_succeeded then null else now_at end,
      delivery_completed_attempt_id = target_delivery_attempt_id,
      delivery_attempt_id = null, delivery_lease_expires_at = null
    where id = target_operation_id;
  elsif (delivery_succeeded and (operation.status <> 'PENDING'
      or operation.delivery_completed_attempt_id is distinct from target_delivery_attempt_id))
    or (not delivery_succeeded and (operation.status <> 'DELIVERY_FAILED'
      or operation.delivery_completed_attempt_id is distinct from target_delivery_attempt_id)) then
    raise exception 'PHONE_VERIFICATION_DELIVERY_CONFLICT' using errcode = 'P0001';
  end if;
  return query select o.status::text, o.result_code from public.phone_verification_operations o where o.id = target_operation_id;
end; $$;

create or replace function public.verify_phone_verification_challenge_v2(
  target_user_id uuid, target_operation_id uuid, target_attempt_id uuid,
  target_candidate_fingerprint text, target_phone_hmac text, target_phone_e164 text
) returns table (operation_status text, result_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  operation public.phone_verification_operations%rowtype;
  challenge public.phone_verification_challenges%rowtype;
  attempt public.phone_verification_attempts%rowtype;
  now_at timestamptz := clock_timestamp(); outcome text;
begin
  if target_operation_id is null or target_attempt_id is null or target_candidate_fingerprint is null then
    raise exception 'PHONE_VERIFICATION_INVALID_INPUT' using errcode = '22023'; end if;
  insert into public.phone_verification_operations (id, user_id, status, result_code, terminal_at)
    values (target_operation_id, target_user_id, 'CANCELLED', 'not_started', now_at)
    on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  select * into operation from public.phone_verification_operations where id = target_operation_id for update;
  if operation.user_id <> target_user_id then raise exception 'PHONE_VERIFICATION_OPERATION_CONFLICT' using errcode = '22023'; end if;
  select * into attempt from public.phone_verification_attempts
    where operation_id = target_operation_id and attempt_id = target_attempt_id for update;
  if found then
    if attempt.candidate_fingerprint <> target_candidate_fingerprint then
      raise exception 'PHONE_VERIFICATION_ATTEMPT_CONFLICT' using errcode = '22023'; end if;
    return query select operation.status::text, attempt.result_code; return;
  end if;
  if operation.status <> 'PENDING' then
    outcome := case operation.status when 'CANCELLED' then 'cancelled' when 'COMPLETED' then 'verified'
      when 'FAILED' then coalesce(operation.result_code, 'unavailable') else lower(operation.status::text) end;
    insert into public.phone_verification_attempts values
      (target_operation_id, target_attempt_id, target_candidate_fingerprint, outcome, now_at, now_at);
    return query select operation.status::text, outcome; return;
  end if;
  select * into challenge from public.phone_verification_challenges
    where id = target_operation_id and user_id = target_user_id for update;
  if not found then outcome := 'not_found';
  elsif challenge.status <> 'PENDING' then
    outcome := case challenge.status when 'EXPIRED' then 'expired' when 'LOCKED' then 'locked'
      when 'CONSUMED' then 'verified' else 'cancelled' end;
  else
    perform pg_advisory_xact_lock(hashtextextended('phone-otp-number:' || challenge.phone_hmac, 0));
    if challenge.expires_at <= now_at then outcome := 'expired';
    elsif challenge.attempt_count >= challenge.max_attempts then outcome := 'locked';
    elsif (select count(*) from public.phone_verification_rate_events e where e.user_id = target_user_id and e.action = 'VERIFY' and e.created_at >= now_at - interval '1 hour') >= 20
      or (select count(*) from public.phone_verification_rate_events e where e.phone_hmac = challenge.phone_hmac and e.action = 'VERIFY' and e.created_at >= now_at - interval '1 hour') >= 20
    then outcome := 'rate_limited';
    else
      insert into public.phone_verification_rate_events (user_id, phone_hmac, action, created_at)
        values (target_user_id, challenge.phone_hmac, 'VERIFY', now_at);
      if challenge.phone_hmac <> target_phone_hmac or challenge.otp_digest <> target_candidate_fingerprint then
        outcome := case when challenge.attempt_count + 1 >= challenge.max_attempts then 'locked' else 'invalid_code' end;
        update public.phone_verification_challenges set attempt_count = attempt_count + 1,
          status = case when outcome = 'locked' then 'LOCKED' else status end,
          invalidated_at = case when outcome = 'locked' then now_at else invalidated_at end,
          last_error_category = outcome where id = target_operation_id;
      elsif target_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then outcome := 'invalid_phone';
      elsif exists (select 1 from public.account_verifications v where v.phone_e164 = target_phone_e164
        and v.phone_verified_at is not null and v.user_id <> target_user_id) then outcome := 'phone_unavailable';
      else outcome := 'verified'; end if;
    end if;
  end if;
  insert into public.phone_verification_attempts values
    (target_operation_id, target_attempt_id, target_candidate_fingerprint, outcome, now_at, now_at);
  if outcome = 'verified' then
    begin
      insert into public.account_verifications (user_id, phone_e164, phone_verified_at, verification_source, updated_at, verification_operation_id)
        values (target_user_id, target_phone_e164, now_at, 'safemelink_phone_otp', now_at, target_operation_id)
      on conflict (user_id) do update set phone_e164 = excluded.phone_e164,
        phone_verified_at = excluded.phone_verified_at, verification_source = excluded.verification_source,
        updated_at = excluded.updated_at, verification_operation_id = excluded.verification_operation_id;
    exception when unique_violation then outcome := 'phone_unavailable';
    end;
  end if;
  if outcome = 'verified' then
    update public.phone_verification_challenges set status = 'CONSUMED', consumed_at = now_at,
      last_error_category = null, otp_ciphertext = null, otp_nonce = null
      where id = target_operation_id;
    update public.phone_verification_operations set status = 'COMPLETED', result_code = 'verified', updated_at = now_at, terminal_at = now_at where id = target_operation_id;
  elsif outcome in ('expired','locked','phone_unavailable','not_found','invalid_phone') then
    update public.phone_verification_challenges set
      status = case when outcome = 'expired' then 'EXPIRED'
        when outcome = 'locked' then 'LOCKED' else 'INVALIDATED' end,
      invalidated_at = case when outcome = 'expired' then invalidated_at else now_at end,
      last_error_category = outcome, otp_ciphertext = null, otp_nonce = null
    where id = target_operation_id and user_id = target_user_id
      and status in ('DELIVERY_PENDING','PENDING');
    update public.phone_verification_operations set status = 'FAILED', result_code = outcome, updated_at = now_at, terminal_at = now_at where id = target_operation_id;
    update public.phone_verification_attempts set result_code = outcome where operation_id = target_operation_id and attempt_id = target_attempt_id;
  end if;
  return query select o.status::text, a.result_code from public.phone_verification_operations o
    join public.phone_verification_attempts a on a.operation_id = o.id and a.attempt_id = target_attempt_id
    where o.id = target_operation_id;
end; $$;

create or replace function public.cancel_phone_verification_operation_v2(
  target_user_id uuid, target_operation_id uuid
) returns table (operation_status text, result_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare operation public.phone_verification_operations%rowtype; now_at timestamptz := clock_timestamp();
begin
  insert into public.phone_verification_operations (id, user_id, status, result_code, terminal_at)
    values (target_operation_id, target_user_id, 'CANCELLED', 'cancelled', now_at) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  select * into operation from public.phone_verification_operations where id = target_operation_id for update;
  if operation.user_id <> target_user_id then raise exception 'PHONE_VERIFICATION_OPERATION_CONFLICT' using errcode = '22023'; end if;
  if operation.status not in ('COMPLETED','DELIVERY_FAILED','FAILED','CANCELLED') then
    update public.phone_verification_challenges set status = 'INVALIDATED', invalidated_at = now_at,
      last_error_category = 'cancelled', otp_ciphertext = null, otp_nonce = null
      where id = target_operation_id and user_id = target_user_id
      and status in ('DELIVERY_PENDING','PENDING');
    update public.phone_verification_operations set status = 'CANCELLED', result_code = 'cancelled',
      updated_at = now_at, terminal_at = now_at,
      delivery_attempt_id = null, delivery_lease_expires_at = null where id = target_operation_id;
  end if;
  return query select o.status::text, o.result_code from public.phone_verification_operations o where o.id = target_operation_id;
end; $$;

create or replace function public.finalize_phone_verification_test_operation_v2(
  target_user_id uuid, target_operation_id uuid
) returns table (operation_status text, result_code text, cleanup_completed boolean)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare operation public.phone_verification_operations%rowtype; now_at timestamptz := clock_timestamp(); disposable boolean;
begin
  select coalesce((raw_app_meta_data ->> 'safemelink_disposable')::boolean, false)
      and raw_app_meta_data ->> 'safemelink_test_purpose' = 'phone_otp_runtime_disposable'
    into disposable from auth.users where id = target_user_id;
  if disposable is distinct from true then raise exception 'PHONE_VERIFICATION_TEST_ACCOUNT_REQUIRED' using errcode = '42501'; end if;
  insert into public.phone_verification_operations (id, user_id, status, result_code, terminal_at)
    values (target_operation_id, target_user_id, 'CANCELLED', 'cancelled', now_at) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtextextended('phone-otp-user:' || target_user_id::text, 0));
  select * into operation from public.phone_verification_operations where id = target_operation_id for update;
  if operation.user_id <> target_user_id then raise exception 'PHONE_VERIFICATION_OPERATION_CONFLICT' using errcode = '22023'; end if;
  delete from public.account_verifications where user_id = target_user_id and verification_operation_id = target_operation_id;
  delete from public.phone_verification_challenges where id = target_operation_id and user_id = target_user_id;
  update public.phone_verification_operations set status = 'CANCELLED',
    result_code = 'cancelled',
    updated_at = now_at, terminal_at = coalesce(terminal_at, now_at), cleanup_completed_at = now_at,
    delivery_attempt_id = null, delivery_lease_expires_at = null
    where id = target_operation_id;
  return query select o.status::text, o.result_code, o.cleanup_completed_at is not null
    from public.phone_verification_operations o where o.id = target_operation_id;
end; $$;

create or replace function public.get_phone_verification_operation_status_v2(
  target_user_id uuid, target_operation_id uuid, target_attempt_id uuid default null
) returns table (
  operation_id uuid, operation_status text, result_code text, attempt_result_code text,
  cleanup_completed boolean, created_at timestamptz, updated_at timestamptz, terminal_at timestamptz,
  challenge_expires_at timestamptz, challenge_resend_available_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.phone_verification_operations o where o.id = target_operation_id and o.user_id = target_user_id) then
    return query select target_operation_id, 'NOT_STARTED'::text, 'not_started'::text, null::text,
      false, null::timestamptz, null::timestamptz, null::timestamptz,
      null::timestamptz, null::timestamptz; return;
  end if;
  return query select o.id, o.status::text, o.result_code, a.result_code,
    o.cleanup_completed_at is not null, o.created_at, o.updated_at, o.terminal_at,
    c.expires_at, c.resend_available_at
  from public.phone_verification_operations o left join public.phone_verification_attempts a
    on a.operation_id = o.id and a.attempt_id = target_attempt_id
  left join public.phone_verification_challenges c on c.id = o.id and c.user_id = o.user_id
  where o.id = target_operation_id and o.user_id = target_user_id;
end; $$;

revoke all on function public.create_phone_verification_challenge_v2(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.mark_phone_verification_delivery_v2(uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
revoke all on function public.verify_phone_verification_challenge_v2(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.cancel_phone_verification_operation_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_phone_verification_test_operation_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_phone_verification_operation_status_v2(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_phone_verification_challenge_v2(uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.mark_phone_verification_delivery_v2(uuid,uuid,uuid,boolean,text,text) to service_role;
grant execute on function public.verify_phone_verification_challenge_v2(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.cancel_phone_verification_operation_v2(uuid,uuid) to service_role;
grant execute on function public.finalize_phone_verification_test_operation_v2(uuid,uuid) to service_role;
grant execute on function public.get_phone_verification_operation_status_v2(uuid,uuid,uuid) to service_role;
revoke all on function public.enforce_phone_verification_operation_identity() from public,anon,authenticated;

commit;
