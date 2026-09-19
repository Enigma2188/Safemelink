begin;

-- Distinct consent and ephemeral presence; neither table is readable by clients.
create table public.neighborhood_discovery_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  invite_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.neighborhood_discovery_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coarse_position extensions.geography(Point, 4326) not null,
  accuracy_meters double precision not null check (accuracy_meters between 0 and 100),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > observed_at)
);
create index neighborhood_discovery_presence_position_idx
  on public.neighborhood_discovery_presence using gist(coarse_position);
create index neighborhood_discovery_presence_expiry_idx
  on public.neighborhood_discovery_presence(expires_at);
create table public.neighborhood_nearby_invite_runs (
  network_id uuid not null references public.neighborhood_networks(id) on delete cascade,
  admin_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  primary key(network_id, admin_id)
);
alter table public.neighborhood_invitations add column source text not null default 'TOKEN'
  constraint neighborhood_invitations_source_check check(source in ('TOKEN','NEARBY'));

alter table public.neighborhood_discovery_preferences enable row level security;
alter table public.neighborhood_discovery_presence enable row level security;
alter table public.neighborhood_nearby_invite_runs enable row level security;
revoke all on public.neighborhood_discovery_preferences, public.neighborhood_discovery_presence,
  public.neighborhood_nearby_invite_runs from public, anon, authenticated;

create function public.get_my_neighborhood_discovery_preference()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.invite_opt_in from public.neighborhood_discovery_preferences p
    where p.user_id = auth.uid()), false)
  where auth.uid() is not null;
$$;

create function public.set_my_neighborhood_discovery_preference(enabled boolean, expected_user_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception using errcode='42501', message='Authentication required.'; end if;
  if actor_id is distinct from expected_user_id then raise exception using errcode='42501', message='Account changed.'; end if;
  if enabled is null then raise exception using errcode='22023', message='Invalid preference.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text,0));
  insert into public.neighborhood_discovery_preferences(user_id,invite_opt_in)
  values(actor_id,enabled) on conflict(user_id) do update
  set invite_opt_in=excluded.invite_opt_in,updated_at=now();
  if not enabled then
    delete from public.neighborhood_discovery_presence where user_id=actor_id;
  end if;
  return enabled;
end;
$$;

-- The single latest observation is snapped to a ~100 m metric grid. The
-- submitted precise fix is never persisted; there is no location history.
create function public.publish_my_neighborhood_discovery_presence(
  position_latitude double precision, position_longitude double precision,
  position_accuracy double precision, position_observed_at timestamptz,
  expected_user_id uuid, invite_origin boolean)
returns boolean language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare actor_id uuid := auth.uid(); snapped extensions.geography(Point,4326);
  discoverable boolean;
begin
  if actor_id is null then raise exception using errcode='42501', message='Authentication required.'; end if;
  if actor_id is distinct from expected_user_id then raise exception using errcode='42501', message='Account changed.'; end if;
  if position_latitude is null or position_latitude not between -90 and 90
    or position_longitude is null or position_longitude not between -180 and 180
    or position_accuracy is null or position_accuracy not between 0 and 100
    or position_observed_at is null or position_observed_at < now()-interval '2 minutes'
    or position_observed_at > now()+interval '30 seconds' then
    raise exception using errcode='22023', message='Fresh location required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text,0));
  delete from public.neighborhood_discovery_presence where expires_at <= now();
  -- Members/admins may supply an invite origin without becoming discoverable.
  discoverable := coalesce((select p.invite_opt_in from public.neighborhood_discovery_preferences p
      where p.user_id=actor_id),false);
  if not discoverable
    and (invite_origin is distinct from true or not exists(select 1 from public.neighborhood_members m
      join public.neighborhood_networks n on n.id=m.network_id and n.status='active'
      where m.user_id=actor_id and m.role='admin')) then
    raise exception using errcode='42501', message='Discovery unavailable.';
  end if;
  snapped := extensions.ST_Transform(extensions.ST_SnapToGrid(
    extensions.ST_Transform(extensions.ST_SetSRID(extensions.ST_MakePoint(position_longitude,position_latitude),4326),3857),100),4326)::extensions.geography;
  insert into public.neighborhood_discovery_presence(user_id,coarse_position,accuracy_meters,observed_at,expires_at)
  values(actor_id,snapped,position_accuracy,position_observed_at,
    position_observed_at + case when discoverable then interval '6 hours' else interval '2 minutes' end)
  on conflict(user_id) do update set coarse_position=excluded.coarse_position,
    accuracy_meters=excluded.accuracy_meters,observed_at=excluded.observed_at,expires_at=excluded.expires_at
    where excluded.observed_at >= neighborhood_discovery_presence.observed_at;
  return true;
end;
$$;

-- No coordinates, recipients, distance or count are returned to the admin.
create function public.invite_nearby_neighborhood_users(target_network_id uuid, expected_user_id uuid)
returns boolean language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare actor_id uuid := auth.uid(); origin_position extensions.geography(Point,4326);
  slot_count integer; room integer; candidate record; sent integer := 0;
begin
  if actor_id is null then raise exception using errcode='42501', message='Authentication required.'; end if;
  if actor_id is distinct from expected_user_id then raise exception using errcode='42501', message='Account changed.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text,0));
  perform 1 from public.neighborhood_networks n where n.id=target_network_id and n.status='active' for update;
  if not found or not exists(select 1 from public.neighborhood_members m
    where m.network_id=target_network_id and m.user_id=actor_id and m.role='admin') then
    raise exception using errcode='42501', message='Invitation unavailable.';
  end if;
  select p.coarse_position into origin_position from public.neighborhood_discovery_presence p
  where p.user_id=actor_id and p.observed_at >= now()-interval '2 minutes'
    and p.expires_at>now();
  if origin_position is null then raise exception using errcode='22023', message='Fresh location required.'; end if;
  if exists(select 1 from public.neighborhood_nearby_invite_runs r
    where r.network_id=target_network_id and r.admin_id=actor_id
      and r.attempted_at>now()-interval '30 minutes') then
    raise exception using errcode='42900', message='Please try again later.';
  end if;
  if (select count(*) from public.neighborhood_invitations i
      where i.invited_by=actor_id and i.created_at>=now()-interval '1 hour') >= 10
    or (select count(*) from public.neighborhood_invite_attempts a
      where a.actor_user_id=actor_id and a.attempted_at>=now()-interval '10 minutes') >= 10 then
    raise exception using errcode='42900', message='Please try again later.';
  end if;
  update public.neighborhood_invitations set status='expired',responded_at=now()
    where status='pending' and expires_at<=now();
  select count(*) into slot_count from public.neighborhood_invitations i
    where i.network_id=target_network_id and i.status='pending';
  room := least(10,20-slot_count,10-(select count(*) from public.neighborhood_invitations i
    where i.invited_by=actor_id and i.created_at>=now()-interval '1 hour'));
  if room <= 0 then raise exception using errcode='42900', message='Please try again later.'; end if;
  insert into public.neighborhood_invite_attempts(actor_user_id) values(actor_id);
  insert into public.neighborhood_nearby_invite_runs(network_id,admin_id)
    values(target_network_id,actor_id) on conflict(network_id,admin_id) do update set attempted_at=now();
  for candidate in
    select p.user_id from public.neighborhood_discovery_presence p
    join public.neighborhood_discovery_preferences pref on pref.user_id=p.user_id and pref.invite_opt_in
    where p.user_id<>actor_id and p.expires_at>now()
      and p.observed_at>=now()-interval '6 hours' and p.accuracy_meters<=100
      and extensions.ST_DWithin(p.coarse_position,origin_position,500)
      and not exists(select 1 from public.neighborhood_members m
        join public.neighborhood_networks n on n.id=m.network_id and n.status='active'
        where m.user_id=p.user_id)
      and not exists(select 1 from public.neighborhood_invitations i
        where i.network_id=target_network_id and i.invited_user_id=p.user_id and i.status='pending')
      and not exists(select 1 from public.neighborhood_invitations i
        where i.network_id=target_network_id and i.invited_user_id=p.user_id
          and i.source='NEARBY' and i.created_at>now()-interval '7 days')
    order by p.observed_at desc,p.user_id
  loop
    exit when sent>=room;
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.user_id::text,0)) then continue; end if;
    -- Recheck after candidate lock: membership/consent may have changed.
    if not exists(select 1 from public.neighborhood_discovery_presence p
       join public.neighborhood_discovery_preferences pref on pref.user_id=p.user_id and pref.invite_opt_in
       where p.user_id=candidate.user_id and p.expires_at>now()
         and extensions.ST_DWithin(p.coarse_position,origin_position,500))
       or exists(select 1 from public.neighborhood_members m where m.user_id=candidate.user_id)
       or exists(select 1 from public.neighborhood_invitations i where i.network_id=target_network_id
           and i.invited_user_id=candidate.user_id and i.status='pending') then continue; end if;
    insert into public.neighborhood_invitations(network_id,invited_user_id,invited_by,source)
      values(target_network_id,candidate.user_id,actor_id,'NEARBY')
      on conflict do nothing;
    if found then sent:=sent+1; end if;
  end loop;
  -- An admin who did not opt in used this observation only as invite origin.
  if not coalesce((select pref.invite_opt_in from public.neighborhood_discovery_preferences pref
      where pref.user_id=actor_id),false) then
    delete from public.neighborhood_discovery_presence where user_id=actor_id;
  end if;
  -- A uniform result also hides the zero/non-zero result from a modified client.
  return true;
end;
$$;

-- Return source to the recipient. The admin must never see the
-- recipient identity of an unaccepted nearby invitation.
drop function public.list_my_neighborhood_invitations();
create function public.list_my_neighborhood_invitations()
returns table(invitation_id uuid,direction text,network_id uuid,network_name text,
  counterpart_nickname text,invitation_status text,created_at timestamptz,expires_at timestamptz,
  invitation_source text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  update public.neighborhood_invitations set status='expired',responded_at=now()
    where status='pending' and expires_at<=now();
  return query select i.id,
    case when i.invited_user_id=auth.uid() then 'received' else 'sent' end,
    n.id,n.name,coalesce(nullif(btrim(counterpart.nickname),''),'Utente SafeMeLink'),
    i.status,i.created_at,i.expires_at,i.source
  from public.neighborhood_invitations i
  join public.neighborhood_networks n on n.id=i.network_id and n.status='active'
  join public.profiles counterpart on counterpart.id=case when i.invited_user_id=auth.uid() then i.invited_by else i.invited_user_id end
  where i.status='pending' and (i.invited_user_id=auth.uid() or
    (i.source='TOKEN' and exists(select 1 from public.neighborhood_members m
      where m.network_id=i.network_id and m.user_id=auth.uid() and m.role='admin')))
  order by i.created_at desc;
end;
$$;

revoke all on function public.get_my_neighborhood_discovery_preference() from public,anon;
revoke all on function public.set_my_neighborhood_discovery_preference(boolean,uuid) from public,anon;
revoke all on function public.publish_my_neighborhood_discovery_presence(double precision,double precision,double precision,timestamptz,uuid,boolean) from public,anon;
revoke all on function public.invite_nearby_neighborhood_users(uuid,uuid) from public,anon;
revoke all on function public.list_my_neighborhood_invitations() from public,anon;
grant execute on function public.get_my_neighborhood_discovery_preference() to authenticated;
grant execute on function public.set_my_neighborhood_discovery_preference(boolean,uuid) to authenticated;
grant execute on function public.publish_my_neighborhood_discovery_presence(double precision,double precision,double precision,timestamptz,uuid,boolean) to authenticated;
grant execute on function public.invite_nearby_neighborhood_users(uuid,uuid) to authenticated;
grant execute on function public.list_my_neighborhood_invitations() to authenticated;
commit;
