begin;

-- Phase 7C: additive, DORMANT. No client, scheduler, consumer or legacy guard.
-- Only explicitly allowlisted Development accounts can call the new paths.
create table public.safety_sos_v2_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false
);
create table public.safety_sos_v2_operations (
  operation_id uuid primary key,
  user_id uuid not null,
  canonical_sos_id uuid not null,
  origin text not null check (origin in ('manual', 'watchdog')),
  result text not null check (result in ('created', 'reused_active')),
  created_at timestamptz not null default clock_timestamp()
  -- No cascading FKs: deletion of an SOS/account must not release operation IDs.
);
create index safety_sos_v2_operations_owner on public.safety_sos_v2_operations(user_id, created_at);
create index safety_sos_v2_operations_sos on public.safety_sos_v2_operations(canonical_sos_id);
create table public.safety_watchdog_v2_resolutions (
  session_id uuid not null,
  generation integer not null check (generation between 1 and 10),
  user_id uuid not null,
  operation_id uuid not null unique references public.safety_sos_v2_operations(operation_id),
  canonical_sos_id uuid not null,
  outcome text not null check (outcome in ('ABSORBED', 'ESCALATED')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, generation)
);
alter table public.safety_sos_v2_accounts enable row level security;
alter table public.safety_sos_v2_operations enable row level security;
alter table public.safety_watchdog_v2_resolutions enable row level security;
revoke all on public.safety_sos_v2_accounts, public.safety_sos_v2_operations,
  public.safety_watchdog_v2_resolutions from public, anon, authenticated, service_role;

-- Extend ONLY the watchdog state vocabulary. Existing ESCALATED/CANCELLED
-- consistency checks remain intact. ABSORBED has no escalation timestamp/sos_id;
-- its authoritative SOS binding lives in safety_watchdog_v2_resolutions.
alter table public.safety_watchdog_sessions drop constraint safety_watchdog_sessions_state_check;
alter table public.safety_watchdog_sessions add constraint safety_watchdog_sessions_state_check
  check (state in ('ACTIVE','AWAITING_CONFIRMATION','COMPLETE','CANCELLED','ESCALATED','ABSORBED'));

create function public.safety_sos_v2_immutable_journal()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'Safety journal is immutable.' using errcode = '55000';
end;
$$;
create trigger safety_sos_v2_operations_immutable before update on public.safety_sos_v2_operations
  for each row execute function public.safety_sos_v2_immutable_journal();
create trigger safety_watchdog_v2_resolutions_immutable before update on public.safety_watchdog_v2_resolutions
  for each row execute function public.safety_sos_v2_immutable_journal();

-- One owner per transaction. try-lock avoids cross-owner batch lock cycles;
-- caller retries the WHOLE transaction with the SAME operation ID on 40001.
-- Reentrant for the processor -> canonical helper call.
create function public.safety_sos_v2_lock_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_user_id is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('watchdog-owner:' || p_user_id::text, 0)) then
    raise exception 'Safety account busy; retry transaction.' using errcode = '40001';
  end if;
  if not exists (select 1 from public.safety_sos_v2_accounts a where a.user_id = p_user_id and a.enabled) then
    raise exception 'Safety V2 is disabled.' using errcode = '55000';
  end if;
end;
$$;

-- Internal only: account -> session -> operation locks -> SOS -> outbox.
-- NO changes to legacy create_my_safety_sos, its journal, or direct sos INSERT.
create function public.safety_sos_v2_create_or_reuse(
  p_user_id uuid, p_operation_id uuid, p_origin text, p_session_id uuid,
  p_latitude double precision, p_longitude double precision,
  p_accuracy double precision, p_observed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_session public.safety_watchdog_sessions%rowtype;
  v_operation public.safety_sos_v2_operations%rowtype;
  v_sos public.sos%rowtype;
  v_operation_lock uuid;
  v_result text;
  v_lifecycle text;
  v_has_session boolean;
begin
  perform public.safety_sos_v2_lock_account(p_user_id);
  if p_operation_id is null or p_origin is null or p_origin not in ('manual','watchdog')
    or (p_origin = 'watchdog') <> (p_session_id is not null) then
    raise exception 'Invalid safety operation.' using errcode = '22023';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
    or (p_latitude is not null and not (p_latitude between -90 and 90))
    or (p_longitude is not null and not (p_longitude between -180 and 180))
    or (p_accuracy is not null and (p_accuracy < 0 or p_accuracy in ('NaN'::double precision,'Infinity'::double precision)))
    or (p_observed_at is not null and not isfinite(p_observed_at)) then
    raise exception 'Invalid position.' using errcode = '22023';
  end if;

  select w.* into v_session from public.safety_watchdog_sessions w
    where w.user_id = p_user_id and
      ((p_session_id is not null and w.id = p_session_id) or
       (p_session_id is null and w.state in ('ACTIVE','AWAITING_CONFIRMATION')))
    for update;
  v_has_session := found;
  if p_origin = 'watchdog' and (not v_has_session or v_session.operation_id <> p_operation_id) then
    raise exception 'Watchdog unavailable.' using errcode = '42501';
  end if;

  -- Serialize absent journal rows too, including a manual request absorbing T2.
  -- Nonblocking operation locks also avoid malicious cross-account lock cycles.
  for v_operation_lock in
    select distinct x.id from unnest(array[p_operation_id,
      case when v_has_session then v_session.operation_id else null end]) as x(id)
      where x.id is not null order by x.id
  loop
    if not pg_try_advisory_xact_lock(hashtextextended('safety-v2-operation:' || v_operation_lock::text, 0)) then
      raise exception 'Safety operation busy; retry transaction.' using errcode = '40001';
    end if;
    if exists(select 1 from public.safety_sos_v2_operations j
      where j.operation_id = v_operation_lock and j.user_id <> p_user_id) then
      raise exception 'Safety operation unavailable.' using errcode = '42501';
    end if;
    if exists(select 1 from public.safety_sos_operations j where j.operation_id = v_operation_lock) then
      raise exception 'Legacy operation identifier reserved.' using errcode = '55000';
    end if;
  end loop;

  select j.* into v_operation from public.safety_sos_v2_operations j where j.operation_id = p_operation_id;
  if found then
    -- Replay NEVER absorbs a later session or recreates a terminal/deleted SOS.
    select s.* into v_sos from public.sos s
      where s.id = v_operation.canonical_sos_id and s.user_id = p_user_id for update;
    v_lifecycle := case when not found then 'missing'
      when v_sos.status in ('open','accepted') then 'active' else 'terminal' end;
    return jsonb_build_object('outcome','replayed','operation_result',v_operation.result,
      'sos_id',v_operation.canonical_sos_id,'status',v_sos.status,'lifecycle',v_lifecycle,
      'sos',case when v_lifecycle = 'missing' then null else to_jsonb(v_sos) end);
  end if;
  if p_origin = 'watchdog' and (v_session.state not in ('ACTIVE','AWAITING_CONFIRMATION')
    or clock_timestamp() < v_session.confirmation_deadline_at) then
    raise exception 'Watchdog not due.' using errcode = '55000';
  end if;
  if v_has_session and exists(select 1 from public.safety_sos_v2_operations j
    where j.operation_id = v_session.operation_id) then
    raise exception 'Inconsistent watchdog journal.' using errcode = '55000';
  end if;
  -- No arbitrary winner if legacy data already contains parallel emergencies.
  if (select count(*) from public.sos s where s.user_id = p_user_id and s.status in ('open','accepted')) > 1 then
    raise exception 'Multiple active emergencies require reconciliation.' using errcode = '55000';
  end if;
  select s.* into v_sos from public.sos s where s.user_id = p_user_id
    and s.status in ('open','accepted') for update;
  if found then
    v_result := 'reused_active'; -- Do not UPDATE lifecycle, location or dispatch.
  else
    insert into public.sos(user_id,latitude,longitude,accuracy,device_time,location_updated_at)
      values(p_user_id,p_latitude,p_longitude,p_accuracy,null,
        case when p_latitude is null then null else p_observed_at end)
      returning * into v_sos;
    v_result := 'created';
  end if;
  insert into public.safety_sos_v2_operations(operation_id,user_id,canonical_sos_id,origin,result)
    values(p_operation_id,p_user_id,v_sos.id,p_origin,v_result);

  if v_has_session then
    if v_session.operation_id <> p_operation_id then
      insert into public.safety_sos_v2_operations(operation_id,user_id,canonical_sos_id,origin,result)
        values(v_session.operation_id,p_user_id,v_sos.id,'watchdog','reused_active');
    end if;
    insert into public.safety_watchdog_v2_resolutions(session_id,generation,user_id,operation_id,canonical_sos_id,outcome)
      values(v_session.id,v_session.generation,p_user_id,v_session.operation_id,v_sos.id,
        case when p_origin = 'watchdog' then 'ESCALATED' else 'ABSORBED' end);
    update public.safety_watchdog_sessions w set
      state = case when p_origin = 'watchdog' then 'ESCALATED' else 'ABSORBED' end,
      sos_id = case when p_origin = 'watchdog' then v_sos.id else null end,
      escalated_at = case when p_origin = 'watchdog' then clock_timestamp() else null end,
      updated_at = clock_timestamp() where w.id = v_session.id;
    update public.safety_watchdog_outbox o set state = 'OBSOLETE'
      where o.session_id = v_session.id and o.generation = v_session.generation
        and o.kind = 'SAFETY_CHECK_DUE' and o.state in ('PENDING','CLAIMED');
    -- Reuse NEVER schedules a second dispatch; delivery remains canonical.
    if p_origin = 'watchdog' and v_result = 'created' then
      insert into public.safety_watchdog_outbox(session_id,generation,kind)
        values(v_session.id,v_session.generation,'SOS_DISPATCH');
    end if;
  end if;
  return jsonb_build_object('outcome',v_result,'operation_result',v_result,
    'sos_id',v_sos.id,'status',v_sos.status,'lifecycle','active','sos',to_jsonb(v_sos));
end;
$$;

create function public.create_or_reuse_my_sos_v2(
  p_operation_id uuid, p_latitude double precision default null,
  p_longitude double precision default null, p_accuracy double precision default null,
  p_observed_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  return public.safety_sos_v2_create_or_reuse(auth.uid(),p_operation_id,'manual',null,
    p_latitude,p_longitude,p_accuracy,p_observed_at);
end;
$$;

-- Explicit session: one account per call, no row-first cursor/batch inversion.
-- Selection is nonlocking; account and then session are locked and revalidated.
-- Consumer must retry 40001/40P01 with bounded backoff in a NEW transaction.
create function public.process_safety_watchdog_v2(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_owner uuid; v_session public.safety_watchdog_sessions%rowtype;
begin
  select w.user_id into v_owner from public.safety_watchdog_sessions w where w.id = p_session_id;
  if not found then raise exception 'Watchdog unavailable.' using errcode = 'P0002'; end if;
  perform public.safety_sos_v2_lock_account(v_owner);
  select w.* into v_session from public.safety_watchdog_sessions w
    where w.id = p_session_id and w.user_id = v_owner for update skip locked;
  if not found then return jsonb_build_object('outcome','busy'); end if;
  if v_session.state not in ('ACTIVE','AWAITING_CONFIRMATION') then
    if exists(select 1 from public.safety_watchdog_v2_resolutions r
      where r.session_id = v_session.id and r.generation = v_session.generation) then
      return public.safety_sos_v2_create_or_reuse(v_owner,v_session.operation_id,'watchdog',v_session.id,null,null,null,null)
        || jsonb_build_object('watchdog_state',v_session.state);
    end if;
    return jsonb_build_object('outcome','terminal','state',v_session.state);
  end if;
  if clock_timestamp() < greatest(v_session.retry_after,v_session.next_check_at) then
    return jsonb_build_object('outcome','not_due');
  end if;
  if clock_timestamp() >= v_session.confirmation_deadline_at then
    return public.safety_sos_v2_create_or_reuse(v_owner,v_session.operation_id,'watchdog',v_session.id,null,null,null,null);
  end if;
  if v_session.state = 'ACTIVE' then
    update public.safety_watchdog_sessions w set state = 'AWAITING_CONFIRMATION',updated_at = clock_timestamp()
      where w.id = v_session.id;
    insert into public.safety_watchdog_outbox(session_id,generation,kind)
      values(v_session.id,v_session.generation,'SAFETY_CHECK_DUE') on conflict do nothing;
  end if;
  return jsonb_build_object('outcome','awaiting_confirmation');
end;
$$;

-- New opt-in closure adapter; legacy close/cancel RPCs are NOT replaced.
create function public.finish_my_sos_v2(p_sos_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_owner uuid := auth.uid(); v_sos public.sos%rowtype;
begin
  perform public.safety_sos_v2_lock_account(v_owner);
  if p_status is null or p_status not in ('closed','cancelled') then
    raise exception 'Invalid terminal status.' using errcode = '22023';
  end if;
  perform 1 from public.safety_watchdog_sessions w
    where w.user_id = v_owner and w.state in ('ACTIVE','AWAITING_CONFIRMATION') for update;
  if found then raise exception 'Unabsorbed watchdog requires reconciliation.' using errcode = '55000'; end if;
  select s.* into v_sos from public.sos s where s.id = p_sos_id and s.user_id = v_owner for update;
  if not found then raise exception 'SOS unavailable.' using errcode = '42501'; end if;
  if p_status = 'closed' then perform public.close_my_sos(p_sos_id);
  else perform public.cancel_my_sos(p_sos_id); end if;
  select s.* into v_sos from public.sos s where s.id = p_sos_id and s.user_id = v_owner;
  return jsonb_build_object('sos_id',v_sos.id,'status',v_sos.status,'lifecycle','terminal','sos',to_jsonb(v_sos));
end;
$$;

revoke all on function public.safety_sos_v2_immutable_journal(), public.safety_sos_v2_lock_account(uuid),
  public.safety_sos_v2_create_or_reuse(uuid,uuid,text,uuid,double precision,double precision,double precision,timestamptz),
  public.create_or_reuse_my_sos_v2(uuid,double precision,double precision,double precision,timestamptz),
  public.process_safety_watchdog_v2(uuid), public.finish_my_sos_v2(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.create_or_reuse_my_sos_v2(uuid,double precision,double precision,double precision,timestamptz),
  public.finish_my_sos_v2(uuid,text) to authenticated;
grant execute on function public.process_safety_watchdog_v2(uuid) to service_role;

commit;
