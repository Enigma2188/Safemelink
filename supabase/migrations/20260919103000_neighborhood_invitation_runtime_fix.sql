begin;

create or replace function public.list_my_neighborhood_invitations()
returns table(invitation_id uuid,direction text,network_id uuid,network_name text,
  counterpart_nickname text,invitation_status text,created_at timestamptz,expires_at timestamptz,
  invitation_source text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  update public.neighborhood_invitations as ni
    set status='expired',responded_at=now()
    where ni.status='pending' and ni.expires_at<=now();
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

revoke all on function public.list_my_neighborhood_invitations() from public,anon;
grant execute on function public.list_my_neighborhood_invitations() to authenticated;

commit;
