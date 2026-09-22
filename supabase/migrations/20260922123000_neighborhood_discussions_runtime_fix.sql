begin;

create or replace function public.list_my_neighborhood_discussions()
returns table(
  discussion_id uuid, network_id uuid, title text, category text,
  author_nickname text, status text, is_general boolean,
  can_close boolean, message_count bigint, last_message text, updated_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_id uuid := auth.uid();
  member_network_id uuid;
begin
  if actor_id is null then
    raise exception using errcode='42501', message='Authentication required.';
  end if;

  select m.network_id
  into member_network_id
  from public.neighborhood_members as m
  join public.neighborhood_networks as n
    on n.id = m.network_id
   and n.status = 'active'
  where m.user_id = actor_id
  limit 1;

  if member_network_id is null then
    return;
  end if;

  insert into public.neighborhood_discussions as nd (
    network_id,
    author_user_id,
    title,
    category,
    is_general
  )
  values (
    member_network_id,
    actor_id,
    'Generale',
    'Informazioni',
    true
  )
  on conflict do nothing;

  return query
  select
    d.id,
    d.network_id,
    d.title,
    d.category,
    coalesce(nullif(btrim(p.nickname), ''), 'Utente SafeMeLink'),
    d.status,
    d.is_general,
    (
      d.author_user_id = actor_id
      or exists (
        select 1
        from public.neighborhood_members as am
        where am.network_id = d.network_id
          and am.user_id = actor_id
          and am.role = 'admin'
      )
    ),
    (
      select count(*)
      from public.neighborhood_messages as msg
      where msg.discussion_id = d.id
    ),
    (
      select left(msg.body, 140)
      from public.neighborhood_messages as msg
      where msg.discussion_id = d.id
      order by msg.created_at desc
      limit 1
    ),
    d.updated_at
  from public.neighborhood_discussions as d
  join public.profiles as p on p.id = d.author_user_id
  where d.network_id = member_network_id
  order by d.is_general desc, d.updated_at desc, d.id desc;
end;
$$;

revoke all on function public.list_my_neighborhood_discussions() from public, anon, authenticated;
grant execute on function public.list_my_neighborhood_discussions() to authenticated;

commit;
