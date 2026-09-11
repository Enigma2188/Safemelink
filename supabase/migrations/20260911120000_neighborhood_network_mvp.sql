begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.neighborhood_networks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint neighborhood_networks_name_check
    check (char_length(btrim(name)) between 3 and 60),
  constraint neighborhood_networks_status_check
    check (status in ('active', 'disabled'))
);

create table if not exists public.neighborhood_members (
  id uuid not null default gen_random_uuid(),
  network_id uuid not null references public.neighborhood_networks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (network_id, user_id),
  constraint neighborhood_members_id_key unique (id),
  constraint neighborhood_members_role_check check (role in ('admin', 'member'))
);

create table if not exists public.neighborhood_invitations (
  id uuid primary key default gen_random_uuid(),
  network_id uuid not null references public.neighborhood_networks(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint neighborhood_invitations_status_check
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  constraint neighborhood_invitations_expiry_check check (expires_at > created_at),
  constraint neighborhood_invitations_response_check check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

create table if not exists public.neighborhood_invite_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint neighborhood_invite_tokens_expiry_check check (expires_at > created_at),
  constraint neighborhood_invite_tokens_used_check check (used_at is null or used_at >= created_at)
);

create table if not exists public.neighborhood_invite_attempts (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists neighborhood_members_user_idx
  on public.neighborhood_members (user_id, joined_at desc);
create index if not exists neighborhood_invitations_invitee_idx
  on public.neighborhood_invitations (invited_user_id, status, created_at desc);
create index if not exists neighborhood_invitations_network_idx
  on public.neighborhood_invitations (network_id, status, created_at desc);
create index if not exists neighborhood_invitations_pending_expiry_idx
  on public.neighborhood_invitations (expires_at)
  where status = 'pending';
create unique index if not exists neighborhood_invitations_pending_unique_idx
  on public.neighborhood_invitations (network_id, invited_user_id)
  where status = 'pending';
create index if not exists neighborhood_invite_attempts_actor_time_idx
  on public.neighborhood_invite_attempts (actor_user_id, attempted_at desc);

drop trigger if exists set_neighborhood_networks_updated_at on public.neighborhood_networks;
create trigger set_neighborhood_networks_updated_at
before update on public.neighborhood_networks
for each row execute function public.set_updated_at();

alter table public.neighborhood_networks enable row level security;
alter table public.neighborhood_members enable row level security;
alter table public.neighborhood_invitations enable row level security;
alter table public.neighborhood_invite_tokens enable row level security;
alter table public.neighborhood_invite_attempts enable row level security;

revoke all on public.neighborhood_networks from public, anon, authenticated;
revoke all on public.neighborhood_members from public, anon, authenticated;
revoke all on public.neighborhood_invitations from public, anon, authenticated;
revoke all on public.neighborhood_invite_tokens from public, anon, authenticated;
revoke all on public.neighborhood_invite_attempts from public, anon, authenticated;
revoke all on sequence public.neighborhood_invite_attempts_id_seq from public, anon, authenticated;

create or replace function public.create_neighborhood_network(target_name text)
returns table (network_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_name text := btrim(target_name);
  created_network_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if char_length(normalized_name) not between 3 and 60 then
    raise exception using errcode = '22023', message = 'Neighborhood name must contain 3 to 60 characters.';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = actor_id and nullif(btrim(p.nickname), '') is not null
  ) then
    raise exception using errcode = '22023', message = 'A nickname is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if exists (
    select 1
    from public.neighborhood_members m
    join public.neighborhood_networks n on n.id = m.network_id
    where m.user_id = actor_id and n.status = 'active'
  ) then
    raise exception using errcode = '23505', message = 'User already belongs to a neighborhood network.';
  end if;

  insert into public.neighborhood_networks (name, created_by)
  values (normalized_name, actor_id)
  returning id into created_network_id;
  insert into public.neighborhood_members (network_id, user_id, role)
  values (created_network_id, actor_id, 'admin');
  return query select created_network_id;
end;
$$;

create or replace function public.get_my_neighborhood_overview()
returns table (
  network_id uuid,
  network_name text,
  my_role text,
  member_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select n.id, n.name, m.role, count(all_members.user_id), n.created_at
  from public.neighborhood_members m
  join public.neighborhood_networks n on n.id = m.network_id and n.status = 'active'
  join public.neighborhood_members all_members on all_members.network_id = n.id
  where m.user_id = auth.uid()
  group by n.id, n.name, m.role, n.created_at
  order by n.created_at asc;
$$;

create or replace function public.list_my_neighborhood_members(target_network_id uuid)
returns table (
  membership_id uuid,
  nickname text,
  member_role text,
  joined_at timestamptz,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.neighborhood_members
    where network_id = target_network_id and user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Neighborhood membership required.';
  end if;
  return query
  select m.id, coalesce(nullif(btrim(p.nickname), ''), 'Utente SafeMeLink'), m.role,
    m.joined_at, m.user_id = auth.uid()
  from public.neighborhood_members m
  join public.profiles p on p.id = m.user_id
  where m.network_id = target_network_id
  order by case when m.role = 'admin' then 0 else 1 end, lower(p.nickname), m.joined_at;
end;
$$;

create or replace function public.list_my_neighborhood_invitations()
returns table (
  invitation_id uuid,
  direction text,
  network_id uuid,
  network_name text,
  counterpart_nickname text,
  invitation_status text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  update public.neighborhood_invitations
  set status = 'expired', responded_at = now()
  where status = 'pending' and expires_at <= now();

  return query
  select i.id,
    case when i.invited_user_id = auth.uid() then 'received' else 'sent' end,
    n.id, n.name,
    coalesce(nullif(btrim(counterpart.nickname), ''), 'Utente SafeMeLink'),
    i.status, i.created_at, i.expires_at
  from public.neighborhood_invitations i
  join public.neighborhood_networks n on n.id = i.network_id and n.status = 'active'
  join public.profiles counterpart on counterpart.id = case
    when i.invited_user_id = auth.uid() then i.invited_by else i.invited_user_id end
  where i.status = 'pending'
    and (
      i.invited_user_id = auth.uid()
      or exists (
        select 1 from public.neighborhood_members m
        where m.network_id = i.network_id and m.user_id = auth.uid() and m.role = 'admin'
      )
    )
  order by i.created_at desc;
end;
$$;

create or replace function public.generate_my_neighborhood_invite_token()
returns table (invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  raw_token text;
  token_expiry timestamptz := now() + interval '24 hours';
  previous_created_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = actor_id and nullif(btrim(p.nickname), '') is not null
  ) then
    raise exception using errcode = '22023', message = 'A nickname is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if exists (
    select 1 from public.neighborhood_members m
    join public.neighborhood_networks n on n.id = m.network_id
    where m.user_id = actor_id and n.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'Invite token unavailable.';
  end if;
  select created_at into previous_created_at
  from public.neighborhood_invite_tokens where user_id = actor_id;
  if previous_created_at > now() - interval '1 minute' then
    raise exception using errcode = '42900', message = 'Invite token regeneration rate limited.';
  end if;

  raw_token := 'NQ-' || upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.neighborhood_invite_tokens (
    user_id, token_hash, created_at, expires_at, used_at
  ) values (
    actor_id, digest(raw_token, 'sha256'), now(), token_expiry, null
  )
  on conflict (user_id) do update set
    token_hash = excluded.token_hash,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at,
    used_at = null;
  return query select raw_token, token_expiry;
end;
$$;

create or replace function public.create_neighborhood_invitation(
  target_network_id uuid,
  target_invite_token text
)
returns table (invitation_id uuid, invitation_created boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_token text := upper(btrim(target_invite_token));
  target_user_id uuid;
  created_invitation_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));

  delete from public.neighborhood_invite_attempts
  where actor_user_id = actor_id and attempted_at < now() - interval '24 hours';
  if (select count(*) from public.neighborhood_invite_attempts
      where actor_user_id = actor_id and attempted_at >= now() - interval '10 minutes') >= 10 then
    return query select null::uuid, false;
    return;
  end if;
  insert into public.neighborhood_invite_attempts (actor_user_id) values (actor_id);

  update public.neighborhood_invitations
  set status = 'expired', responded_at = now()
  where status = 'pending' and expires_at <= now();

  perform 1 from public.neighborhood_networks
  where id = target_network_id and status = 'active' for update;
  if not found or not exists (
    select 1 from public.neighborhood_members
    where network_id = target_network_id and user_id = actor_id and role = 'admin'
  ) then
    return query select null::uuid, false;
    return;
  end if;
  if normalized_token !~ '^NQ-[0-9A-F]{32}$' then
    return query select null::uuid, false;
    return;
  end if;
  if (select count(*) from public.neighborhood_invitations
      where invited_by = actor_id and created_at >= now() - interval '1 hour') >= 10 then
    return query select null::uuid, false;
    return;
  end if;
  if (select count(*) from public.neighborhood_invitations
      where network_id = target_network_id and status = 'pending') >= 20 then
    return query select null::uuid, false;
    return;
  end if;

  select user_id into target_user_id
  from public.neighborhood_invite_tokens
  where token_hash = digest(normalized_token, 'sha256')
    and used_at is null and expires_at > now()
  for update;
  if target_user_id is null or target_user_id = actor_id then
    return query select null::uuid, false;
    return;
  end if;
  if exists (
    select 1 from public.neighborhood_members m
    join public.neighborhood_networks n on n.id = m.network_id
    where m.user_id = target_user_id and n.status = 'active'
  ) or exists (
    select 1 from public.neighborhood_invitations
    where network_id = target_network_id and invited_user_id = target_user_id and status = 'pending'
  ) then
    return query select null::uuid, false;
    return;
  end if;

  insert into public.neighborhood_invitations (network_id, invited_user_id, invited_by)
  values (target_network_id, target_user_id, actor_id)
  returning id into created_invitation_id;
  update public.neighborhood_invite_tokens set used_at = now()
  where user_id = target_user_id;
  return query select created_invitation_id, true;
end;
$$;

create or replace function public.respond_to_neighborhood_invitation(
  target_invitation_id uuid,
  accept_invitation boolean
)
returns table (network_id uuid, invitation_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  selected_invitation public.neighborhood_invitations%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  update public.neighborhood_invitations
  set status = 'expired', responded_at = now()
  where invited_user_id = actor_id and status = 'pending' and expires_at <= now();

  select * into selected_invitation
  from public.neighborhood_invitations
  where id = target_invitation_id and invited_user_id = actor_id
  for update;
  if not found then
    return query select null::uuid, 'unavailable'::text;
    return;
  end if;
  if selected_invitation.status <> 'pending' then
    return query select selected_invitation.network_id, selected_invitation.status;
    return;
  end if;

  if accept_invitation then
    if exists (
      select 1 from public.neighborhood_members m
      join public.neighborhood_networks n on n.id = m.network_id
      where m.user_id = actor_id and n.status = 'active'
    ) then
      return query select selected_invitation.network_id, 'unavailable'::text;
      return;
    end if;
    insert into public.neighborhood_members (network_id, user_id, role)
    values (selected_invitation.network_id, actor_id, 'member');
    update public.neighborhood_invitations set status = 'accepted', responded_at = now()
    where id = target_invitation_id;
    return query select selected_invitation.network_id, 'accepted'::text;
  else
    update public.neighborhood_invitations set status = 'declined', responded_at = now()
    where id = target_invitation_id;
    return query select selected_invitation.network_id, 'declined'::text;
  end if;
end;
$$;

create or replace function public.cancel_neighborhood_invitation(target_invitation_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  current_status text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  update public.neighborhood_invitations set status = 'expired', responded_at = now()
  where status = 'pending' and expires_at <= now();
  update public.neighborhood_invitations i set status = 'cancelled', responded_at = now()
  where i.id = target_invitation_id and i.status = 'pending'
    and exists (
      select 1 from public.neighborhood_members m
      where m.network_id = i.network_id and m.user_id = actor_id and m.role = 'admin'
    )
  returning i.status into current_status;
  if current_status = 'cancelled' then return current_status; end if;
  select i.status into current_status from public.neighborhood_invitations i
  where i.id = target_invitation_id
    and exists (
      select 1 from public.neighborhood_members m
      where m.network_id = i.network_id and m.user_id = actor_id and m.role = 'admin'
    );
  return coalesce(current_status, 'unavailable');
end;
$$;

create or replace function public.remove_neighborhood_member(
  target_network_id uuid,
  target_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  perform 1 from public.neighborhood_networks where id = target_network_id for update;
  if not exists (
    select 1 from public.neighborhood_members
    where network_id = target_network_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'Neighborhood administrator required.';
  end if;
  delete from public.neighborhood_members
  where network_id = target_network_id and id = target_membership_id and role = 'member';
  if not found then
    raise exception using errcode = 'P0002', message = 'Removable member not found.';
  end if;
end;
$$;

create or replace function public.leave_neighborhood_network(target_network_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  members_count bigint;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  perform 1 from public.neighborhood_networks where id = target_network_id for update;
  select role into actor_role from public.neighborhood_members
  where network_id = target_network_id and user_id = actor_id;
  if actor_role is null then
    raise exception using errcode = 'P0002', message = 'Neighborhood membership not found.';
  end if;
  if actor_role = 'admin' then
    select count(*) into members_count from public.neighborhood_members
    where network_id = target_network_id;
    if members_count > 1 then
      raise exception using errcode = '22023', message = 'Administrator must remove members before leaving.';
    end if;
    delete from public.neighborhood_networks where id = target_network_id;
  else
    delete from public.neighborhood_members
    where network_id = target_network_id and user_id = actor_id;
  end if;
end;
$$;

revoke all on function public.create_neighborhood_network(text) from public, anon;
revoke all on function public.get_my_neighborhood_overview() from public, anon;
revoke all on function public.list_my_neighborhood_members(uuid) from public, anon;
revoke all on function public.list_my_neighborhood_invitations() from public, anon;
revoke all on function public.generate_my_neighborhood_invite_token() from public, anon;
revoke all on function public.create_neighborhood_invitation(uuid, text) from public, anon;
revoke all on function public.respond_to_neighborhood_invitation(uuid, boolean) from public, anon;
revoke all on function public.cancel_neighborhood_invitation(uuid) from public, anon;
revoke all on function public.remove_neighborhood_member(uuid, uuid) from public, anon;
revoke all on function public.leave_neighborhood_network(uuid) from public, anon;

grant execute on function public.create_neighborhood_network(text) to authenticated;
grant execute on function public.get_my_neighborhood_overview() to authenticated;
grant execute on function public.list_my_neighborhood_members(uuid) to authenticated;
grant execute on function public.list_my_neighborhood_invitations() to authenticated;
grant execute on function public.generate_my_neighborhood_invite_token() to authenticated;
grant execute on function public.create_neighborhood_invitation(uuid, text) to authenticated;
grant execute on function public.respond_to_neighborhood_invitation(uuid, boolean) to authenticated;
grant execute on function public.cancel_neighborhood_invitation(uuid) to authenticated;
grant execute on function public.remove_neighborhood_member(uuid, uuid) to authenticated;
grant execute on function public.leave_neighborhood_network(uuid) to authenticated;

commit;
