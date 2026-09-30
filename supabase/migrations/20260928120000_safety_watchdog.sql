begin;

-- LOCAL PHASE 7 ONLY. No scheduler or HTTP call is installed by this migration.
create table if not exists public.safety_watchdog_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  mode text not null check (mode in ('CHECKPOINT', 'HOME_RETURN')),
  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'AWAITING_CONFIRMATION', 'COMPLETE', 'CANCELLED', 'ESCALATED')),
  generation integer not null default 1 check (generation between 1 and 10),
  duration_minutes integer not null check (duration_minutes between 1 and 10080),
  repeat_total integer not null default 1 check (repeat_total between 1 and 10),
  repeat_completed integer not null default 0 check (repeat_completed between 0 and 10),
  retry_after timestamptz not null default '-infinity',
  processor_failures integer not null default 0 check (processor_failures >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  next_check_at timestamptz not null,
  confirmation_deadline_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  escalated_at timestamptz,
  operation_id uuid not null default gen_random_uuid() unique,
  sos_id uuid,
  unique (user_id, request_id),
  check (mode = 'CHECKPOINT' or repeat_total = 1),
  check (mode <> 'CHECKPOINT' or duration_minutes <= 779),
  check (repeat_completed <= repeat_total and generation <= repeat_total),
  check (confirmation_deadline_at = next_check_at + interval '30 seconds'),
  check ((state = 'ESCALATED') = (sos_id is not null)),
  check ((state = 'ESCALATED') = (escalated_at is not null)),
  check ((state = 'CANCELLED') = (cancelled_at is not null)),
  check (state <> 'COMPLETE' or repeat_completed = repeat_total)
);
create unique index if not exists safety_watchdog_one_active_owner
  on public.safety_watchdog_sessions(user_id) where state in ('ACTIVE', 'AWAITING_CONFIRMATION');
create index if not exists safety_watchdog_owner_created on public.safety_watchdog_sessions(user_id, created_at);
create index if not exists safety_watchdog_due
  on public.safety_watchdog_sessions ((greatest(retry_after, case when state = 'ACTIVE' then next_check_at else confirmation_deadline_at end)), id)
  where state in ('ACTIVE', 'AWAITING_CONFIRMATION');

create table if not exists public.safety_watchdog_outbox (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.safety_watchdog_sessions(id) on delete cascade,
  generation integer not null,
  kind text not null check (kind in ('SAFETY_CHECK_DUE', 'SOS_DISPATCH')),
  state text not null default 'PENDING' check (state in ('PENDING', 'CLAIMED', 'JOURNALED', 'ATTEMPTED', 'ACCEPTED', 'OBSOLETE', 'UNKNOWN', 'FAILED')),
  created_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default clock_timestamp(),
  claim_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 5),
  unique(session_id, generation, kind)
);
create index if not exists safety_watchdog_outbox_due on public.safety_watchdog_outbox(available_at)
  where state in ('PENDING', 'CLAIMED');
create index if not exists safety_watchdog_outbox_lease on public.safety_watchdog_outbox(lease_until)
  where state in ('CLAIMED', 'ATTEMPTED');
alter table public.safety_watchdog_sessions enable row level security;
alter table public.safety_watchdog_outbox enable row level security;
revoke all on public.safety_watchdog_sessions, public.safety_watchdog_outbox from public, anon, authenticated, service_role;

create or replace function public.start_my_safety_watchdog(p_request_id uuid, p_mode text, p_duration_minutes integer, p_repeat_total integer default 1)
returns public.safety_watchdog_sessions
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.safety_watchdog_sessions%rowtype;
  v_now timestamptz;
begin
  if v_actor is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  if p_request_id is null or p_mode is null or p_mode not in ('CHECKPOINT', 'HOME_RETURN')
    or p_duration_minutes is null or p_duration_minutes not between 1 and 10080
    or (p_mode = 'CHECKPOINT' and p_duration_minutes > 779)
    or p_repeat_total is null or p_repeat_total not between 1 and 10
    or (p_mode = 'HOME_RETURN' and p_repeat_total <> 1) then
    raise exception 'Invalid watchdog configuration.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('watchdog-owner:' || v_actor::text, 0));
  select s.* into v_row from public.safety_watchdog_sessions s where s.user_id = v_actor and s.request_id = p_request_id;
  if found then
    if v_row.mode <> p_mode or v_row.duration_minutes <> p_duration_minutes or v_row.repeat_total <> p_repeat_total then
      raise exception 'Request identifier reused.' using errcode = '22023';
    end if;
    return v_row; -- Even a terminal session is never re-armed by a retry.
  end if;
  if exists (select 1 from public.sos s where s.user_id = v_actor and s.status in ('open', 'accepted')) then
    raise exception 'SOS already active.' using errcode = '55000';
  end if;
  -- Bound start/cancel churn without pruning durable idempotency records.
  if (select count(*) from public.safety_watchdog_sessions s where s.user_id = v_actor and s.created_at > clock_timestamp() - interval '1 hour') >= 30 then
    raise exception 'Watchdog start rate exceeded.' using errcode = '54000';
  end if;
  v_now := clock_timestamp();
  insert into public.safety_watchdog_sessions(user_id, request_id, mode, duration_minutes, repeat_total, created_at, updated_at, next_check_at, confirmation_deadline_at)
  values(v_actor, p_request_id, p_mode, p_duration_minutes, p_repeat_total, v_now, v_now,
    v_now + make_interval(mins => p_duration_minutes), v_now + make_interval(mins => p_duration_minutes) + interval '30 seconds')
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.get_my_safety_watchdog(p_session_id uuid default null)
returns public.safety_watchdog_sessions
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_row public.safety_watchdog_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  select s.* into v_row from public.safety_watchdog_sessions s where s.user_id = auth.uid()
    and (s.id = p_session_id or (p_session_id is null and s.state in ('ACTIVE', 'AWAITING_CONFIRMATION')));
  if not found then raise exception 'Watchdog unavailable.' using errcode = '42501'; end if;
  return v_row;
end;
$$;

create or replace function public.confirm_my_safety_watchdog(p_session_id uuid, p_generation integer)
returns public.safety_watchdog_sessions
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_row public.safety_watchdog_sessions%rowtype; v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  select s.* into v_row from public.safety_watchdog_sessions s where s.id = p_session_id and s.user_id = auth.uid() for update;
  if not found then raise exception 'Watchdog unavailable.' using errcode = '42501'; end if;
  -- Linearization timestamp AFTER the lock; client/transaction start time cannot backdate consent.
  v_now := clock_timestamp();
  if p_generation is null or p_generation <> v_row.generation then raise exception 'Stale generation.' using errcode = '40001'; end if;
  if v_row.state = 'COMPLETE' then return v_row; end if;
  if v_row.state not in ('ACTIVE', 'AWAITING_CONFIRMATION') or v_now < v_row.next_check_at or v_now >= v_row.confirmation_deadline_at then
    raise exception 'Confirmation window closed.' using errcode = '55000';
  end if;
  update public.safety_watchdog_outbox o set state = 'OBSOLETE'
    where o.session_id = v_row.id and o.generation = v_row.generation and o.kind = 'SAFETY_CHECK_DUE' and o.state in ('PENDING', 'CLAIMED');
  update public.safety_watchdog_sessions s set
    repeat_completed = s.repeat_completed + 1, confirmed_at = v_now, updated_at = v_now,
    state = case when s.repeat_completed + 1 = s.repeat_total then 'COMPLETE' else 'ACTIVE' end,
    generation = case when s.repeat_completed + 1 = s.repeat_total then s.generation else s.generation + 1 end,
    operation_id = case when s.repeat_completed + 1 = s.repeat_total then s.operation_id else gen_random_uuid() end,
    next_check_at = case when s.repeat_completed + 1 = s.repeat_total then s.next_check_at else v_now + make_interval(mins => s.duration_minutes) end,
    confirmation_deadline_at = case when s.repeat_completed + 1 = s.repeat_total then s.confirmation_deadline_at else v_now + make_interval(mins => s.duration_minutes) + interval '30 seconds' end
    where s.id = v_row.id returning s.* into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_my_safety_watchdog(p_session_id uuid, p_generation integer)
returns public.safety_watchdog_sessions
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_row public.safety_watchdog_sessions%rowtype; v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  select s.* into v_row from public.safety_watchdog_sessions s where s.id = p_session_id and s.user_id = auth.uid() for update;
  if not found then raise exception 'Watchdog unavailable.' using errcode = '42501'; end if;
  v_now := clock_timestamp();
  if p_generation is null or p_generation <> v_row.generation then raise exception 'Stale generation.' using errcode = '40001'; end if;
  if v_row.state = 'CANCELLED' then return v_row; end if;
  if v_row.state not in ('ACTIVE', 'AWAITING_CONFIRMATION') or v_now >= v_row.confirmation_deadline_at then
    raise exception 'Watchdog can no longer be cancelled.' using errcode = '55000';
  end if;
  update public.safety_watchdog_sessions s set state = 'CANCELLED', cancelled_at = v_now, updated_at = v_now where s.id = v_row.id returning s.* into v_row;
  update public.safety_watchdog_outbox o set state = 'OBSOLETE' where o.session_id = v_row.id and o.state in ('PENDING', 'CLAIMED');
  return v_row;
end;
$$;

create or replace function public.process_due_safety_watchdogs(p_limit integer default 100)
returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_row public.safety_watchdog_sessions%rowtype; v_now timestamptz; v_scan timestamptz := clock_timestamp(); v_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid batch size.' using errcode = '22023'; end if;
  for v_row in select s.* from public.safety_watchdog_sessions s
    where s.state in ('ACTIVE', 'AWAITING_CONFIRMATION')
      and greatest(s.retry_after, case when s.state = 'ACTIVE' then s.next_check_at else s.confirmation_deadline_at end) <= v_scan
    order by greatest(s.retry_after, case when s.state = 'ACTIVE' then s.next_check_at else s.confirmation_deadline_at end), s.id
    limit p_limit for update skip locked
  loop
    begin
    v_now := clock_timestamp();
    if v_row.state = 'ACTIVE' then
      update public.safety_watchdog_sessions s set state = 'AWAITING_CONFIRMATION', updated_at = v_now where s.id = v_row.id;
      insert into public.safety_watchdog_outbox(session_id, generation, kind)
        values(v_row.id, v_row.generation, 'SAFETY_CHECK_DUE') on conflict do nothing;
    end if;
    if v_now >= v_row.confirmation_deadline_at then
      -- Same advisory namespace as create_my_safety_sos. Atomic SOS + tombstone + state + outbox.
      perform pg_advisory_xact_lock(hashtextextended(v_row.operation_id::text, 0));
      if exists(select 1 from public.safety_sos_operations m where m.operation_id = v_row.operation_id) then
        if not exists(select 1 from public.safety_sos_operations m join public.sos s on s.id = m.sos_id
          where m.operation_id = v_row.operation_id and m.user_id = v_row.user_id and s.user_id = v_row.user_id) then
          raise exception 'Safety operation unavailable.' using errcode = '55000';
        end if;
      else
        insert into public.sos(id, user_id, latitude, longitude, device_time, location_updated_at)
          values(v_row.operation_id, v_row.user_id, null, null, null, null);
        insert into public.safety_sos_operations(operation_id, user_id, sos_id)
          values(v_row.operation_id, v_row.user_id, v_row.operation_id);
      end if;
      update public.safety_watchdog_sessions s set state = 'ESCALATED', sos_id = v_row.operation_id, escalated_at = v_now, updated_at = v_now where s.id = v_row.id;
      update public.safety_watchdog_outbox o set state = 'OBSOLETE'
        where o.session_id = v_row.id and o.kind = 'SAFETY_CHECK_DUE' and o.state in ('PENDING', 'CLAIMED');
      insert into public.safety_watchdog_outbox(session_id, generation, kind)
        values(v_row.id, v_row.generation, 'SOS_DISPATCH') on conflict do nothing;
    end if;
    v_count := v_count + 1;
    exception when others then
      -- Roll back this session's entire transition/SOS/outbox, not other sessions.
      -- Keep it actionable with bounded backoff, never mark an uncreated SOS done.
      update public.safety_watchdog_sessions s set processor_failures = s.processor_failures + 1,
        retry_after = clock_timestamp() + interval '30 seconds' * least(10, s.processor_failures + 1)
        where s.id = v_row.id;
    end;
  end loop;
  return v_count;
end;
$$;

-- Only pre-send leases are recoverable. ATTEMPTED is quarantined as UNKNOWN,
-- never blindly resent after a crash between Expo acceptance and acknowledgment.
create or replace function public.claim_safety_watchdog_outbox(p_claim_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_event public.safety_watchdog_outbox%rowtype; v_session public.safety_watchdog_sessions%rowtype;
begin
  if p_claim_id is null then raise exception 'Claim required.' using errcode = '22023'; end if;
  -- Bounded recovery/observability for workers that died without calling finish.
  with stale as (
    select o.id from public.safety_watchdog_outbox o
    where o.state in ('CLAIMED', 'ATTEMPTED') and o.lease_until < clock_timestamp()
      and (o.state = 'ATTEMPTED' or o.attempts >= 5)
    order by o.lease_until limit 100 for update skip locked
  )
  update public.safety_watchdog_outbox o set state = case when o.state = 'ATTEMPTED' then 'UNKNOWN' else 'FAILED' end
    from stale where o.id = stale.id;
  select o.* into v_event from public.safety_watchdog_outbox o
    where o.state in ('PENDING', 'CLAIMED') and o.available_at <= clock_timestamp()
      and (o.lease_until is null or o.lease_until < clock_timestamp()) and o.attempts < 5
    order by o.available_at, o.id limit 1 for update skip locked;
  if not found then return null; end if;
  select s.* into v_session from public.safety_watchdog_sessions s where s.id = v_event.session_id;
  if v_event.kind = 'SAFETY_CHECK_DUE' and (v_session.state <> 'AWAITING_CONFIRMATION' or v_session.generation <> v_event.generation or clock_timestamp() >= v_session.confirmation_deadline_at) then
    update public.safety_watchdog_outbox o set state = 'OBSOLETE' where o.id = v_event.id;
    return null;
  end if;
  update public.safety_watchdog_outbox o set state = 'CLAIMED', claim_id = p_claim_id,
    lease_until = clock_timestamp() + interval '2 minutes', attempts = o.attempts + 1 where o.id = v_event.id;
  return jsonb_build_object('id', v_event.id, 'kind', v_event.kind, 'sessionId', v_session.id,
    'generation', v_event.generation, 'mode', v_session.mode, 'ownerId', v_session.user_id,
    'sosId', v_session.sos_id, 'deadline', v_session.confirmation_deadline_at);
end;
$$;

create or replace function public.finish_safety_watchdog_outbox(p_event_id uuid, p_claim_id uuid, p_action text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_action = 'attempt' then
    update public.safety_watchdog_outbox o set state = 'ATTEMPTED'
      where o.id = p_event_id and o.claim_id = p_claim_id and o.state = 'CLAIMED' and o.lease_until > clock_timestamp()
      and (o.kind = 'SOS_DISPATCH' or exists (select 1 from public.safety_watchdog_sessions s
        where s.id = o.session_id and s.generation = o.generation and s.state = 'AWAITING_CONFIRMATION'
          and clock_timestamp() < s.confirmation_deadline_at));
  elsif p_action in ('accepted', 'unknown', 'failed', 'obsolete') then
    update public.safety_watchdog_outbox o set state = upper(p_action)
      where o.id = p_event_id and o.claim_id = p_claim_id and o.state in ('CLAIMED', 'ATTEMPTED');
  elsif p_action = 'release' then
    update public.safety_watchdog_outbox o set state = case when o.attempts >= 5 then 'FAILED' else 'PENDING' end,
      claim_id = null, lease_until = null, available_at = clock_timestamp() + interval '30 seconds' * o.attempts
      where o.id = p_event_id and o.claim_id = p_claim_id and o.state = 'CLAIMED';
  else raise exception 'Invalid action.' using errcode = '22023';
  end if;
  return found;
end;
$$;

revoke all on function public.start_my_safety_watchdog(uuid,text,integer,integer), public.get_my_safety_watchdog(uuid),
  public.confirm_my_safety_watchdog(uuid,integer), public.cancel_my_safety_watchdog(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.start_my_safety_watchdog(uuid,text,integer,integer), public.get_my_safety_watchdog(uuid),
  public.confirm_my_safety_watchdog(uuid,integer), public.cancel_my_safety_watchdog(uuid,integer) to authenticated;
revoke all on function public.process_due_safety_watchdogs(integer), public.claim_safety_watchdog_outbox(uuid),
  public.finish_safety_watchdog_outbox(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.process_due_safety_watchdogs(integer), public.claim_safety_watchdog_outbox(uuid),
  public.finish_safety_watchdog_outbox(uuid,uuid,text) to service_role;

-- Phase 7B: immutable recipient fingerprint snapshot, one durable send per device.
-- No push token/body is persisted here. Fingerprints remain private metadata.
create table if not exists public.safety_watchdog_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.safety_watchdog_outbox(id) on delete cascade,
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'PENDING' check (state in ('PENDING','CLAIMED','ATTEMPTED','ACCEPTED','REJECTED','UNKNOWN','FAILED','OBSOLETE')),
  claim_id uuid,
  lease_until timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts between 0 and 5),
  accepted_at timestamptz,
  unique(event_id,recipient_hash),
  check ((state = 'ACCEPTED') = (accepted_at is not null))
);
create index if not exists safety_watchdog_delivery_due on public.safety_watchdog_deliveries(available_at,id)
  where state in ('PENDING','CLAIMED');
create index if not exists safety_watchdog_delivery_lease on public.safety_watchdog_deliveries(lease_until)
  where state in ('CLAIMED','ATTEMPTED');
alter table public.safety_watchdog_deliveries enable row level security;
revoke all on public.safety_watchdog_deliveries from public,anon,authenticated,service_role;

create or replace function public.stage_safety_watchdog_deliveries(p_event_id uuid,p_claim_id uuid,p_hashes text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_event public.safety_watchdog_outbox%rowtype; v_s public.safety_watchdog_sessions%rowtype;
begin
  select o.* into v_event from public.safety_watchdog_outbox o where o.id=p_event_id for update;
  if not found or v_event.claim_id is distinct from p_claim_id then return false; end if;
  if v_event.state='JOURNALED' then return true; end if;
  if v_event.state<>'CLAIMED' or v_event.lease_until<=clock_timestamp() then return false; end if;
  if p_hashes is null or cardinality(p_hashes) not between 1 and 10000
    or exists(select 1 from unnest(p_hashes) h where h is null or h !~ '^[0-9a-f]{64}$') then
    raise exception 'Invalid recipient snapshot.' using errcode='22023';
  end if;
  select s.* into v_s from public.safety_watchdog_sessions s where s.id=v_event.session_id;
  if v_event.kind='SAFETY_CHECK_DUE' then
    if v_s.state<>'AWAITING_CONFIRMATION' or v_s.generation<>v_event.generation or clock_timestamp()>=v_s.confirmation_deadline_at then return false; end if;
  elsif not public.mark_sos_push_dispatch_attempted(v_s.sos_id,p_claim_id) then
    return false;
  end if;
  -- SOS dispatch reservation + immutable recipient snapshot commit together.
  insert into public.safety_watchdog_deliveries(event_id,recipient_hash)
    select p_event_id,h from unnest(p_hashes) h on conflict do nothing;
  update public.safety_watchdog_outbox o set state='JOURNALED' where o.id=p_event_id;
  return true;
end;
$$;

create or replace function public.claim_safety_watchdog_delivery(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_d public.safety_watchdog_deliveries%rowtype; v_o public.safety_watchdog_outbox%rowtype; v_s public.safety_watchdog_sessions%rowtype;
begin
  if p_claim_id is null then raise exception 'Claim required.' using errcode='22023'; end if;
  with stale as (
    select d.id from public.safety_watchdog_deliveries d
      where d.state in ('CLAIMED','ATTEMPTED') and d.lease_until<clock_timestamp()
      and (d.state='ATTEMPTED' or d.attempts>=5)
      order by d.lease_until limit 100 for update skip locked
  ) update public.safety_watchdog_deliveries d set state=case when d.state='ATTEMPTED' then 'UNKNOWN' else 'FAILED' end
    from stale where d.id=stale.id;
  select d.* into v_d from public.safety_watchdog_deliveries d
    where d.state in ('PENDING','CLAIMED') and d.available_at<=clock_timestamp()
      and (d.lease_until is null or d.lease_until<clock_timestamp()) and d.attempts<5
    order by d.available_at,d.id limit 1 for update skip locked;
  if not found then return null; end if;
  select o.* into v_o from public.safety_watchdog_outbox o where o.id=v_d.event_id;
  select s.* into v_s from public.safety_watchdog_sessions s where s.id=v_o.session_id;
  update public.safety_watchdog_deliveries d set state='CLAIMED',claim_id=p_claim_id,
    lease_until=clock_timestamp()+interval '2 minutes',attempts=d.attempts+1 where d.id=v_d.id;
  return jsonb_build_object('deliveryId',v_d.id,'recipientHash',v_d.recipient_hash,'id',v_o.id,
    'kind',v_o.kind,'sessionId',v_s.id,'generation',v_o.generation,'mode',v_s.mode,
    'ownerId',v_s.user_id,'sosId',v_s.sos_id,'deadline',v_s.confirmation_deadline_at);
end;
$$;

create or replace function public.finish_safety_watchdog_delivery(p_delivery_id uuid,p_claim_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_action='attempt' then
    update public.safety_watchdog_deliveries d set state='ATTEMPTED'
      where d.id=p_delivery_id and d.claim_id=p_claim_id and d.state='CLAIMED' and d.lease_until>clock_timestamp()
      and exists(select 1 from public.safety_watchdog_outbox o join public.safety_watchdog_sessions s on s.id=o.session_id
        where o.id=d.event_id and o.state='JOURNALED' and
          ((o.kind='SAFETY_CHECK_DUE' and s.state='AWAITING_CONFIRMATION' and s.generation=o.generation and clock_timestamp()<s.confirmation_deadline_at)
           or (o.kind='SOS_DISPATCH' and exists(select 1 from public.sos z where z.id=s.sos_id and z.status='open'))));
  elsif p_action in ('accepted','rejected','unknown') then
    update public.safety_watchdog_deliveries d set state=upper(p_action),
      accepted_at=case when p_action='accepted' then clock_timestamp() else null end
      where d.id=p_delivery_id and d.claim_id=p_claim_id and d.state='ATTEMPTED';
  elsif p_action in ('release','obsolete') then
    update public.safety_watchdog_deliveries d set state=case when p_action='obsolete' then 'OBSOLETE' when d.attempts>=5 then 'FAILED' else 'PENDING' end,
      claim_id=null,lease_until=null,available_at=clock_timestamp()+interval '5 seconds'*d.attempts
      where d.id=p_delivery_id and d.claim_id=p_claim_id and d.state='CLAIMED';
  else raise exception 'Invalid delivery action.' using errcode='22023';
  end if;
  return found;
end;
$$;

-- Parent reconciliation is independent of HTTP, so a crash after the last ACK
-- cannot strand completion. Uncertain sends never block still-pending siblings.
create or replace function public.reconcile_safety_watchdog_deliveries()
returns integer language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_o public.safety_watchdog_outbox%rowtype; v_sos uuid; v_state text; v_count integer:=0;
begin
  for v_o in select o.* from public.safety_watchdog_outbox o where o.state='JOURNALED'
    and not exists(select 1 from public.safety_watchdog_deliveries d where d.event_id=o.id and d.state in ('PENDING','CLAIMED','ATTEMPTED'))
    order by o.created_at limit 100 for update skip locked
  loop
    select case when bool_and(d.state='ACCEPTED') then 'ACCEPTED'
      when bool_or(d.state='UNKNOWN') then 'UNKNOWN' else 'FAILED' end into v_state
      from public.safety_watchdog_deliveries d where d.event_id=v_o.id;
    if v_o.kind='SOS_DISPATCH' and v_state='ACCEPTED' then
      select s.sos_id into v_sos from public.safety_watchdog_sessions s where s.id=v_o.session_id;
      if not public.complete_sos_push_dispatch(v_sos,v_o.claim_id) then continue; end if;
    end if;
    update public.safety_watchdog_outbox o set state=coalesce(v_state,'FAILED') where o.id=v_o.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.stage_safety_watchdog_deliveries(uuid,uuid,text[]),public.claim_safety_watchdog_delivery(uuid),
  public.finish_safety_watchdog_delivery(uuid,uuid,text),public.reconcile_safety_watchdog_deliveries() from public,anon,authenticated,service_role;
grant execute on function public.stage_safety_watchdog_deliveries(uuid,uuid,text[]),public.claim_safety_watchdog_delivery(uuid),
  public.finish_safety_watchdog_delivery(uuid,uuid,text),public.reconcile_safety_watchdog_deliveries() to service_role;

commit;
