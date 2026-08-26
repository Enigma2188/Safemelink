begin;

-- A dispatch claim is a short lease, not proof that Expo was contacted.
-- Existing push_dispatched_at values remain completed dispatches.
alter table public.sos
  add column if not exists push_dispatch_claim_id uuid,
  add column if not exists push_dispatch_claimed_at timestamptz,
  add column if not exists push_dispatch_attempted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sos'::regclass
      and conname = 'sos_push_dispatch_claim_consistency'
  ) then
    alter table public.sos
      add constraint sos_push_dispatch_claim_consistency check (
        (push_dispatch_claim_id is null) = (push_dispatch_claimed_at is null)
        and (push_dispatch_attempted_at is null or push_dispatch_claim_id is not null)
      );
  end if;
end;
$$;

create index if not exists sos_push_dispatch_claim_idx
  on public.sos (push_dispatch_claimed_at)
  where push_dispatch_claim_id is not null;

create or replace function public.claim_sos_push_dispatch(
  target_sos_id uuid,
  requested_claim_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_sos public.sos%rowtype;
  recent_dispatch_count integer;
begin
  if target_sos_id is null or requested_claim_id is null then
    raise exception 'SOS and claim identifiers are required.' using errcode = '22023';
  end if;

  select target.*
  into target_sos
  from public.sos target
  where target.id = target_sos_id
    and target.status = 'open'
  for update;

  if not found then
    return 'unavailable';
  end if;

  if target_sos.push_dispatched_at is not null then
    return 'already_dispatched';
  end if;

  if target_sos.push_dispatch_claim_id is not null then
    if target_sos.push_dispatch_attempted_at is not null then
      return 'attempt_in_progress';
    end if;

    if target_sos.push_dispatch_claimed_at >= now() - interval '2 minutes' then
      return 'in_progress';
    end if;
  end if;

  select count(*)
  into recent_dispatch_count
  from public.sos recent_sos
  where recent_sos.user_id = target_sos.user_id
    and recent_sos.push_dispatched_at >= now() - interval '5 minutes';

  if recent_dispatch_count >= 3 then
    return 'rate_limited';
  end if;

  update public.sos target
  set push_dispatch_claim_id = requested_claim_id,
      push_dispatch_claimed_at = now(),
      push_dispatch_attempted_at = null
  where target.id = target_sos.id;

  return 'claimed';
end;
$$;

create or replace function public.mark_sos_push_dispatch_attempted(
  target_sos_id uuid,
  expected_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sos target
  set push_dispatch_attempted_at = coalesce(target.push_dispatch_attempted_at, now())
  where target.id = target_sos_id
    and target.status = 'open'
    and target.push_dispatched_at is null
    and target.push_dispatch_claim_id = expected_claim_id;

  return found;
end;
$$;

create or replace function public.complete_sos_push_dispatch(
  target_sos_id uuid,
  expected_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sos target
  set push_dispatched_at = now(),
      push_dispatch_claim_id = null,
      push_dispatch_claimed_at = null,
      push_dispatch_attempted_at = null
  where target.id = target_sos_id
    and target.push_dispatched_at is null
    and target.push_dispatch_claim_id = expected_claim_id;

  return found;
end;
$$;

create or replace function public.release_sos_push_dispatch(
  target_sos_id uuid,
  expected_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sos target
  set push_dispatch_claim_id = null,
      push_dispatch_claimed_at = null
  where target.id = target_sos_id
    and target.push_dispatched_at is null
    and target.push_dispatch_attempted_at is null
    and target.push_dispatch_claim_id = expected_claim_id;

  return found;
end;
$$;

revoke all on function public.claim_sos_push_dispatch(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_sos_push_dispatch_attempted(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_sos_push_dispatch(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_sos_push_dispatch(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_sos_push_dispatch(uuid, uuid) to service_role;
grant execute on function public.mark_sos_push_dispatch_attempted(uuid, uuid) to service_role;
grant execute on function public.complete_sos_push_dispatch(uuid, uuid) to service_role;
grant execute on function public.release_sos_push_dispatch(uuid, uuid) to service_role;

commit;
