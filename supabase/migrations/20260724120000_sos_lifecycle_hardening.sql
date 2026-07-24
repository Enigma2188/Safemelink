begin;

-- All SOS mutations are performed through the transition RPCs below.
drop policy if exists "sos_update_own" on public.sos;

create or replace function public.get_sos_status(target_sos_id uuid)
returns table (
  sos_id uuid,
  sos_status public.sos_status,
  is_owner boolean,
  accepted_by_me boolean,
  sos_updated_at timestamptz,
  sos_closed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target.id,
    target.status,
    target.user_id = auth.uid(),
    coalesce(target.accepted_by = auth.uid(), false),
    target.updated_at,
    target.closed_at
  from public.sos target
  where target.id = target_sos_id
    and auth.uid() is not null
    and (
      target.user_id = auth.uid()
      or exists (
        select 1
        from public.trusted_contacts trusted_contact
        where trusted_contact.user_id = target.user_id
          and trusted_contact.linked_profile_id = auth.uid()
      )
    );
$$;

create or replace function public.accept_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sos_status public.sos_status,
  is_owner boolean,
  accepted_by_me boolean,
  sos_updated_at timestamptz,
  sos_closed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_sos public.sos%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
  into target_sos
  from public.sos target
  where target.id = target_sos_id
  for update;

  if not found or not exists (
    select 1
    from public.trusted_contacts trusted_contact
    where trusted_contact.user_id = target_sos.user_id
      and trusted_contact.linked_profile_id = current_user_id
  ) then
    raise exception 'SOS not found or not authorized.' using errcode = '42501';
  end if;

  if target_sos.user_id = current_user_id then
    raise exception 'The SOS owner cannot accept their own SOS.' using errcode = '42501';
  end if;

  if target_sos.status = 'accepted' and target_sos.accepted_by = current_user_id then
    return query
    select
      target_sos.id,
      target_sos.status,
      false,
      true,
      target_sos.updated_at,
      target_sos.closed_at;
    return;
  end if;

  if target_sos.status <> 'open' then
    raise exception 'Invalid SOS transition to accepted.' using errcode = '55000';
  end if;

  update public.sos target
  set status = 'accepted',
      accepted_by = current_user_id
  where target.id = target_sos.id
  returning * into target_sos;

  return query
  select
    target_sos.id,
    target_sos.status,
    false,
    true,
    target_sos.updated_at,
    target_sos.closed_at;
end;
$$;

create or replace function public.close_my_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sos_status public.sos_status,
  is_owner boolean,
  accepted_by_me boolean,
  sos_updated_at timestamptz,
  sos_closed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_sos public.sos%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
  into target_sos
  from public.sos target
  where target.id = target_sos_id
    and target.user_id = current_user_id
  for update;

  if not found then
    raise exception 'SOS not found or not authorized.' using errcode = '42501';
  end if;

  if target_sos.status = 'closed' then
    return query
    select
      target_sos.id,
      target_sos.status,
      true,
      coalesce(target_sos.accepted_by = current_user_id, false),
      target_sos.updated_at,
      target_sos.closed_at;
    return;
  end if;

  if target_sos.status not in ('open', 'accepted') then
    raise exception 'Invalid SOS transition to closed.' using errcode = '55000';
  end if;

  update public.sos target
  set status = 'closed',
      closed_at = now()
  where target.id = target_sos.id
  returning * into target_sos;

  return query
  select
    target_sos.id,
    target_sos.status,
    true,
    coalesce(target_sos.accepted_by = current_user_id, false),
    target_sos.updated_at,
    target_sos.closed_at;
end;
$$;

create or replace function public.cancel_my_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sos_status public.sos_status,
  is_owner boolean,
  accepted_by_me boolean,
  sos_updated_at timestamptz,
  sos_closed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_sos public.sos%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
  into target_sos
  from public.sos target
  where target.id = target_sos_id
    and target.user_id = current_user_id
  for update;

  if not found then
    raise exception 'SOS not found or not authorized.' using errcode = '42501';
  end if;

  if target_sos.status = 'cancelled' then
    return query
    select
      target_sos.id,
      target_sos.status,
      true,
      coalesce(target_sos.accepted_by = current_user_id, false),
      target_sos.updated_at,
      target_sos.closed_at;
    return;
  end if;

  if target_sos.status not in ('open', 'accepted') then
    raise exception 'Invalid SOS transition to cancelled.' using errcode = '55000';
  end if;

  update public.sos target
  set status = 'cancelled',
      closed_at = now()
  where target.id = target_sos.id
  returning * into target_sos;

  return query
  select
    target_sos.id,
    target_sos.status,
    true,
    coalesce(target_sos.accepted_by = current_user_id, false),
    target_sos.updated_at,
    target_sos.closed_at;
end;
$$;

-- Sensitive received details remain available only while the emergency is active.
create or replace function public.get_received_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sender_display_name text,
  sos_status public.sos_status,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  event_time timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target.id,
    coalesce(nullif(trim(sender_profile.nickname), ''), 'Contatto SafeMeLink'),
    target.status,
    target.latitude,
    target.longitude,
    target.accuracy,
    coalesce(target.device_time, target.created_at)
  from public.sos target
  join public.profiles sender_profile on sender_profile.id = target.user_id
  where target.id = target_sos_id
    and target.status in ('open', 'accepted')
    and auth.uid() is not null
    and exists (
      select 1
      from public.trusted_contacts trusted_contact
      where trusted_contact.user_id = target.user_id
        and trusted_contact.linked_profile_id = auth.uid()
    );
$$;

revoke all on function public.get_sos_status(uuid) from public;
revoke all on function public.accept_sos(uuid) from public;
revoke all on function public.close_my_sos(uuid) from public;
revoke all on function public.cancel_my_sos(uuid) from public;
revoke all on function public.get_received_sos(uuid) from public;

grant execute on function public.get_sos_status(uuid) to authenticated;
grant execute on function public.accept_sos(uuid) to authenticated;
grant execute on function public.close_my_sos(uuid) to authenticated;
grant execute on function public.cancel_my_sos(uuid) to authenticated;
grant execute on function public.get_received_sos(uuid) to authenticated;

commit;
