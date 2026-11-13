-- LOCAL ONLY / NOT APPLIED. Requires NETWORK 03/11, 07/11 and 08/11.
-- No public activation, production policy, legacy writer, transport or scheduler.
begin;
do $$ begin
  if current_user<>'postgres' or to_regclass('public.network_social_operations_v2') is null then
    raise exception 'Controlled postgres role and social dependencies required'; end if;
  if has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE')
    or has_schema_privilege('anon','extensions','CREATE') or has_schema_privilege('authenticated','extensions','CREATE') then
    raise exception 'Untrusted schema CREATE requires review'; end if;
end $$;

-- Technical cancellation fences, not public content. No automatic expiry: removing a
-- fence could reauthorize a late request. Retention/maintenance requires explicit review.
create table public.network_operation_fences_v2 (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('EVENT','SOCIAL')),
  operation_id uuid not null,
  primary key(user_id,kind,operation_id)
);
-- Classification only: body, author, consent, expiry and review remain in the existing
-- moderated social comment. There is no second copy of the text or new social system.
create table public.network_author_update_links_v2 (
  comment_id uuid primary key references public.network_social_comments_v2(public_id) on delete cascade,
  event_id uuid not null references public.network_events_v2(public_id)
);
create index network_author_update_links_event_idx on public.network_author_update_links_v2(event_id,comment_id);
alter table public.network_operation_fences_v2 enable row level security;
alter table public.network_author_update_links_v2 enable row level security;
revoke all on table public.network_operation_fences_v2,public.network_author_update_links_v2 from public,anon,authenticated,service_role;

create function public.network_operation_fence_guard_v2()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare actor uuid; domain text;
begin
  if tg_table_name='network_events_v2' then actor:=new.author_user_id;domain:='EVENT';
  elsif tg_table_name='network_social_operations_v2' then actor:=new.user_id;domain:='SOCIAL';
  else raise exception 'Unexpected operation target' using errcode='42501'; end if;
  -- Same actor lock as both original writers; social side effects are rolled back
  -- with their receipt INSERT if a fence wins. No partial vote/comment is committed.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  if exists(select 1 from public.network_operation_fences_v2 f
    where f.user_id=actor and f.kind=domain and f.operation_id=new.operation_id) then
    raise exception 'Operation explicitly fenced' using errcode='42501'; end if;
  return new;
end $$;
create trigger network_event_fence_v2 before insert on public.network_events_v2
  for each row execute function public.network_operation_fence_guard_v2();
create trigger network_social_fence_v2 before insert on public.network_social_operations_v2
  for each row execute function public.network_operation_fence_guard_v2();

create function public.resolve_my_network_operation_v2(target_kind text,target_operation uuid,prevent_late boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare actor uuid:=auth.uid(); identifier uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if target_kind is null or target_kind not in ('EVENT','SOCIAL') or target_operation is null or prevent_late is null then
    raise exception 'Invalid operation' using errcode='22023'; end if;
  perform public.network_event_take_read_v2(120);
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  if target_kind='EVENT' then
    select e.public_id into identifier from public.network_events_v2 e where e.author_user_id=actor and e.operation_id=target_operation;
  else
    select o.event_id into identifier from public.network_social_operations_v2 o where o.user_id=actor and o.operation_id=target_operation;
  end if;
  if identifier is not null then return jsonb_build_object('state','FOUND','publicId',identifier); end if;
  if exists(select 1 from public.network_operation_fences_v2 where user_id=actor and kind=target_kind and operation_id=target_operation) then
    return jsonb_build_object('state','FENCED','publicId',null); end if;
  if not prevent_late then return jsonb_build_object('state','UNKNOWN','publicId',null); end if;
  -- A bounded, non-content ledger. Never silently delete old fences to make room.
  if (select count(*) from public.network_operation_fences_v2 where user_id=actor)>=256 then
    raise exception 'Operation recovery capacity reached; review required' using errcode='54000'; end if;
  insert into public.network_operation_fences_v2(user_id,kind,operation_id) values(actor,target_kind,target_operation);
  return jsonb_build_object('state','FENCED','publicId',null);
end $$;

create function public.publish_network_author_update_v2(target_event uuid,target_operation uuid,update_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare actor uuid:=auth.uid(); e public.network_events_v2%rowtype; receipt jsonb; existing uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if target_operation is null or update_body is null or char_length(btrim(update_body)) not between 2 and 300 then
    raise exception 'Invalid author update' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  select * into e from public.network_events_v2 where public_id=target_event and author_user_id=actor;
  if not found then raise exception 'Author update unavailable' using errcode='42501'; end if;
  select comment_id into existing from public.network_social_operations_v2 where user_id=actor and operation_id=target_operation;
  if found and not exists(select 1 from public.network_author_update_links_v2 where comment_id=existing and event_id=target_event) then
    raise exception 'Operation kind conflict' using errcode='22023'; end if;
  -- Existing moderation, idempotency, rate limits, account/parent gates and PENDING.
  receipt:=public.mutate_network_social_v2(target_event,target_operation,'COMMENT',btrim(update_body));
  insert into public.network_author_update_links_v2(comment_id,event_id)
    values((receipt->>'commentId')::uuid,target_event) on conflict(comment_id) do nothing;
  return receipt;
end $$;

create function public.get_network_author_updates_v2(target_event uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare e public.network_events_v2%rowtype; policy public.network_event_policies_v2%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into e from public.network_events_v2 where public_id=target_event;
  if not found then raise exception 'Event unavailable' using errcode='42501'; end if;
  policy:=public.network_event_require_access_v2(e.territory_id,'read');
  perform public.network_event_take_read_v2(policy.read_limit_minute);
  select jsonb_build_object('eventId',n.public_id,'revision',n.revision,
    'validUntil',to_char(least(n.expires_at,n.purge_after,(select min(c.valid_until)
      from public.network_author_update_links_v2 l join public.network_social_comments_v2 c on c.public_id=l.comment_id
      join public.network_social_policies_v2 s on s.territory_id=n.territory_id and s.enabled
      where l.event_id=n.public_id and c.event_id=n.public_id and c.author_id=n.author_user_id
        and c.policy_version=s.policy_version and c.moderation_state='APPROVED' and c.valid_until>statement_timestamp()
        and public.network_social_actor_allowed_v2(c.author_id,n.territory_id))) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updates',coalesce((select jsonb_agg(jsonb_build_object('publicId',x.public_id,'authorRole','AUTHOR','body',x.body,
      'createdAt',to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by x.created_at,x.public_id)
      from (select c.* from public.network_author_update_links_v2 l join public.network_social_comments_v2 c on c.public_id=l.comment_id
        join public.network_social_policies_v2 s on s.territory_id=n.territory_id and s.enabled
        where l.event_id=n.public_id and c.event_id=n.public_id and c.author_id=n.author_user_id
          and c.policy_version=s.policy_version and c.moderation_state='APPROVED' and c.valid_until>statement_timestamp()
          and public.network_social_actor_allowed_v2(c.author_id,n.territory_id)
        order by c.created_at desc,c.public_id desc limit 50) x),'[]'::jsonb)) into result
    from public.network_events_v2 n where n.public_id=target_event and public.network_event_is_public_v2(n,policy);
  if result is null then raise exception 'Event unavailable' using errcode='42501'; end if;
  return result;
end $$;

create index network_events_owner_page_v2 on public.network_events_v2(author_user_id,created_at desc,public_id desc);
create function public.list_my_network_events_v2(page_size integer default 20,before_created timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if page_size is null or page_size not between 1 and 50 or (before_created is null)<>(before_id is null) then
    raise exception 'Invalid owner page' using errcode='22023'; end if;
  perform public.network_event_take_read_v2(120);
  -- Cleanup metadata only, even after publication access is revoked. No text/coordinates,
  -- caller-supplied account, author identifier, nickname or public marker is returned.
  return (select coalesce(jsonb_agg(jsonb_build_object('publicId',e.public_id,'categoryId',e.category_id,'status',e.status,
    'publicationState',e.moderation_state,'createdAt',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by e.created_at desc,e.public_id desc),'[]'::jsonb)
    from (select * from public.network_events_v2 where author_user_id=auth.uid()
      and (before_created is null or (created_at,public_id)<(before_created,before_id))
      order by created_at desc,public_id desc limit page_size) e);
end $$;

revoke all on function public.network_operation_fence_guard_v2(),public.resolve_my_network_operation_v2(text,uuid,boolean),
  public.publish_network_author_update_v2(uuid,uuid,text),public.get_network_author_updates_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_my_network_events_v2(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_my_network_operation_v2(text,uuid,boolean),
  public.publish_network_author_update_v2(uuid,uuid,text),public.get_network_author_updates_v2(uuid),public.list_my_network_events_v2(integer,timestamptz,uuid) to authenticated;
commit;
