begin;

create table if not exists public.neighborhood_discussions (
  id uuid primary key default gen_random_uuid(),
  network_id uuid not null references public.neighborhood_networks(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 100),
  category text not null check (category in ('Sicurezza','Aiuto','Informazioni','Altro')),
  is_general boolean not null default false,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.neighborhood_messages (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.neighborhood_discussions(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists neighborhood_discussions_network_updated_idx
  on public.neighborhood_discussions(network_id, updated_at desc);
create unique index if not exists neighborhood_discussions_one_general_idx
  on public.neighborhood_discussions(network_id) where is_general;
create index if not exists neighborhood_messages_discussion_created_idx
  on public.neighborhood_messages(discussion_id, created_at asc);

alter table public.neighborhood_discussions enable row level security;
alter table public.neighborhood_messages enable row level security;
revoke all on public.neighborhood_discussions, public.neighborhood_messages from public, anon, authenticated;

create or replace function public.list_my_neighborhood_discussions()
returns table(
  discussion_id uuid, network_id uuid, title text, category text,
  author_nickname text, status text, is_general boolean,
  can_close boolean, message_count bigint, last_message text, updated_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_id uuid := auth.uid(); member_network_id uuid;
begin
  if actor_id is null then raise exception using errcode='42501', message='Authentication required.'; end if;
  select m.network_id into member_network_id
  from public.neighborhood_members m
  join public.neighborhood_networks n on n.id=m.network_id and n.status='active'
  where m.user_id=actor_id limit 1;
  if member_network_id is null then return; end if;
  insert into public.neighborhood_discussions(network_id,author_user_id,title,category,is_general)
  values(member_network_id,actor_id,'Generale','Informazioni',true)
  on conflict (network_id) where is_general do nothing;
  return query
  select d.id,d.network_id,d.title,d.category,
    coalesce(nullif(btrim(p.nickname),''),'Utente SafeMeLink'),d.status,d.is_general,
    (d.author_user_id=actor_id or exists(select 1 from public.neighborhood_members am
      where am.network_id=d.network_id and am.user_id=actor_id and am.role='admin')),
    (select count(*) from public.neighborhood_messages msg where msg.discussion_id=d.id),
    (select left(msg.body,140) from public.neighborhood_messages msg where msg.discussion_id=d.id order by msg.created_at desc limit 1),
    d.updated_at
  from public.neighborhood_discussions d
  join public.profiles p on p.id=d.author_user_id
  where d.network_id=member_network_id
  order by d.is_general desc,d.updated_at desc,d.id desc;
end;
$$;

create or replace function public.create_neighborhood_discussion(target_network_id uuid,target_title text,target_category text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_id uuid := auth.uid(); discussion_id uuid;
begin
  if actor_id is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  if target_title is null or char_length(btrim(target_title)) not between 3 and 100 then raise exception using errcode='22023',message='Titolo non valido.'; end if;
  if target_category not in ('Sicurezza','Aiuto','Informazioni','Altro') then raise exception using errcode='22023',message='Categoria non valida.'; end if;
  if not exists(select 1 from public.neighborhood_members m join public.neighborhood_networks n on n.id=m.network_id and n.status='active' where m.network_id=target_network_id and m.user_id=actor_id) then
    raise exception using errcode='42501',message='Membership required.';
  end if;
  insert into public.neighborhood_discussions(network_id,author_user_id,title,category)
  values(target_network_id,btrim(target_title),target_category) returning id into discussion_id;
  return discussion_id;
end;
$$;

create or replace function public.list_neighborhood_messages(target_discussion_id uuid)
returns table(message_id uuid, author_nickname text, body text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select msg.id,coalesce(nullif(btrim(p.nickname),''),'Utente SafeMeLink'),msg.body,msg.created_at
  from public.neighborhood_messages msg
  join public.neighborhood_discussions d on d.id=msg.discussion_id
  join public.neighborhood_members m on m.network_id=d.network_id and m.user_id=auth.uid()
  join public.profiles p on p.id=msg.author_user_id
  where msg.discussion_id=target_discussion_id and d.status in ('open','closed') and auth.uid() is not null
  order by msg.created_at asc,msg.id asc;
$$;

create or replace function public.create_neighborhood_message(target_discussion_id uuid,target_body text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_id uuid := auth.uid(); message_id uuid;
begin
  if actor_id is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  if target_body is null or char_length(btrim(target_body)) not between 1 and 2000 then raise exception using errcode='22023',message='Messaggio non valido.'; end if;
  if (select count(*) from public.neighborhood_messages msg where msg.author_user_id=actor_id and msg.created_at >= now()-interval '1 minute') >= 20 then
    raise exception using errcode='42900',message='Troppi messaggi. Riprova tra poco.';
  end if;
  if not exists(select 1 from public.neighborhood_discussions d join public.neighborhood_members m on m.network_id=d.network_id and m.user_id=actor_id where d.id=target_discussion_id and d.status='open') then
    raise exception using errcode='42501',message='Discussione non disponibile.';
  end if;
  insert into public.neighborhood_messages(discussion_id,author_user_id,body)
  values(target_discussion_id,actor_id,btrim(target_body)) returning id into message_id;
  update public.neighborhood_discussions set updated_at=now() where id=target_discussion_id;
  return message_id;
end;
$$;

create or replace function public.close_neighborhood_discussion(target_discussion_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.neighborhood_discussions d set status='closed',closed_at=now(),updated_at=now()
  where d.id=target_discussion_id and (d.author_user_id=auth.uid() or exists(select 1 from public.neighborhood_members m where m.network_id=d.network_id and m.user_id=auth.uid() and m.role='admin'));
  return found;
end;
$$;

revoke all on function public.list_my_neighborhood_discussions() from public,anon,authenticated;
revoke all on function public.create_neighborhood_discussion(uuid,text,text) from public,anon,authenticated;
revoke all on function public.list_neighborhood_messages(uuid) from public,anon,authenticated;
revoke all on function public.create_neighborhood_message(uuid,text) from public,anon,authenticated;
revoke all on function public.close_neighborhood_discussion(uuid) from public,anon,authenticated;
grant execute on function public.list_my_neighborhood_discussions() to authenticated;
grant execute on function public.create_neighborhood_discussion(uuid,text,text) to authenticated;
grant execute on function public.list_neighborhood_messages(uuid) to authenticated;
grant execute on function public.create_neighborhood_message(uuid,text) to authenticated;
grant execute on function public.close_neighborhood_discussion(uuid) to authenticated;
commit;
