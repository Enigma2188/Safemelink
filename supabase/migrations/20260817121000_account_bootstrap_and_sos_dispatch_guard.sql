begin;

-- Privacy-safe defaults for every future Radar preference row.
alter table public.radar_preferences
  alter column visible_to_nearby set default false;

-- A new Auth user receives both the required profile and explicit network
-- defaults in the same database transaction as account creation.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do nothing;

  insert into public.radar_preferences (
    user_id,
    radar_enabled,
    visible_to_nearby,
    show_nickname,
    public_nickname
  ) values (
    new.id,
    false,
    false,
    false,
    null
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Existing accounts keep their choices. Only missing preference rows receive
-- the conservative defaults.
insert into public.radar_preferences (
  user_id,
  radar_enabled,
  visible_to_nearby,
  show_nickname,
  public_nickname
)
select
  profile.id,
  false,
  false,
  false,
  null
from public.profiles profile
on conflict (user_id) do nothing;

-- Idempotent authenticated fallback used at session bootstrap. It repairs a
-- missing profile/default row without exposing auth.users or accepting a
-- caller-provided user identifier.
create or replace function public.initialize_my_account()
returns table (
  profile_id uuid,
  radar_enabled boolean,
  visible_to_nearby boolean,
  show_nickname boolean
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

  insert into public.profiles (id)
  values (current_user_id)
  on conflict (id) do nothing;

  insert into public.radar_preferences (
    user_id,
    radar_enabled,
    visible_to_nearby,
    show_nickname,
    public_nickname
  ) values (
    current_user_id,
    false,
    false,
    false,
    null
  )
  on conflict (user_id) do nothing;

  return query
  select
    profile.id,
    preferences.radar_enabled,
    preferences.visible_to_nearby,
    preferences.show_nickname
  from public.profiles profile
  join public.radar_preferences preferences
    on preferences.user_id = profile.id
  where profile.id = current_user_id;
end;
$$;

revoke all on function public.initialize_my_account() from public, anon;
grant execute on function public.initialize_my_account() to authenticated;

-- One server-side claim makes SOS push dispatch idempotent and applies a small
-- MVP abuse guard without preventing local emergency fallback.
alter table public.sos
  add column push_dispatched_at timestamptz;

create index sos_push_dispatch_rate_idx
  on public.sos (user_id, push_dispatched_at desc)
  where push_dispatched_at is not null;

create or replace function public.claim_sos_push_dispatch(target_sos_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_sos public.sos%rowtype;
  recent_dispatch_count integer;
begin
  if target_sos_id is null then
    raise exception 'SOS identifier is required.' using errcode = '22023';
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

  select count(*)
  into recent_dispatch_count
  from public.sos recent_sos
  where recent_sos.user_id = target_sos.user_id
    and recent_sos.push_dispatched_at >= now() - interval '5 minutes';

  if recent_dispatch_count >= 3 then
    return 'rate_limited';
  end if;

  update public.sos target
  set push_dispatched_at = now()
  where target.id = target_sos.id;

  return 'claimed';
end;
$$;

revoke all on function public.claim_sos_push_dispatch(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_sos_push_dispatch(uuid) to service_role;

-- A selected responder may still read the non-sensitive terminal status after
-- their nearby_alert row becomes expired. Precise details remain protected by
-- get_received_sos, which only exposes active emergencies.
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
      or exists (
        select 1
        from public.nearby_alerts nearby_alert
        where nearby_alert.sos_id = target.id
          and nearby_alert.source_user_id = target.user_id
          and nearby_alert.nearby_user_id = auth.uid()
          and nearby_alert.status in ('detected', 'acknowledged', 'expired')
      )
    );
$$;

revoke all on function public.get_sos_status(uuid) from public;
grant execute on function public.get_sos_status(uuid) to authenticated;

-- Keep authorization history without leaving terminal emergencies marked as
-- actively actionable. Physical retention can be introduced later according
-- to the product's operational and legal retention policy.
create or replace function public.expire_nearby_alerts_on_sos_terminal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('closed', 'cancelled')
     and new.status is distinct from old.status then
    update public.nearby_alerts nearby_alert
    set status = 'expired'
    where nearby_alert.sos_id = new.id
      and nearby_alert.status in ('detected', 'acknowledged');
  end if;

  return new;
end;
$$;

create trigger expire_nearby_alerts_on_sos_terminal
after update of status on public.sos
for each row execute function public.expire_nearby_alerts_on_sos_terminal();

revoke all on function public.expire_nearby_alerts_on_sos_terminal() from public;

commit;
