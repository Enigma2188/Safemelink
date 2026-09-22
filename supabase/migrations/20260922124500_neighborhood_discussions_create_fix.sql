begin;

create or replace function public.create_neighborhood_discussion(
  target_network_id uuid,
  target_title text,
  target_category text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  discussion_id uuid;
begin
  if actor_id is null then
    raise exception using errcode='42501', message='Authentication required.';
  end if;

  if target_title is null
     or char_length(btrim(target_title)) not between 3 and 100 then
    raise exception using errcode='22023', message='Titolo non valido.';
  end if;

  if target_category not in ('Sicurezza','Aiuto','Informazioni','Altro') then
    raise exception using errcode='22023', message='Categoria non valida.';
  end if;

  if not exists (
    select 1
    from public.neighborhood_members as m
    join public.neighborhood_networks as n
      on n.id = m.network_id
     and n.status = 'active'
    where m.network_id = target_network_id
      and m.user_id = actor_id
  ) then
    raise exception using errcode='42501', message='Membership required.';
  end if;

  insert into public.neighborhood_discussions as nd (
    network_id,
    author_user_id,
    title,
    category
  )
  values (
    target_network_id,
    actor_id,
    btrim(target_title),
    target_category
  )
  returning nd.id into discussion_id;

  return discussion_id;
end;
$$;

revoke all on function public.create_neighborhood_discussion(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_neighborhood_discussion(uuid, text, text)
  to authenticated;

commit;
