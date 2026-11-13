-- LOCAL ONLY. Requires 03/11 and 07/11. No seed, activation, transport or legacy change.
begin;
do $$ begin
  if current_user<>'postgres' or to_regclass('public.network_events_v2') is null then
    raise exception 'Controlled postgres role and event V2 schema required'; end if;
  if has_schema_privilege('anon','public','CREATE') is distinct from false
    or has_schema_privilege('authenticated','public','CREATE') is distinct from false
    or has_schema_privilege('anon','extensions','CREATE') is distinct from false
    or has_schema_privilege('authenticated','extensions','CREATE') is distinct from false then
    raise exception 'Untrusted schema CREATE requires separate review'; end if;
end $$;

-- No production precision, moderation SLA or retention is selected here.
create table public.network_social_policies_v2 (
  territory_id uuid primary key references public.network_event_policies_v2(territory_id),
  enabled boolean not null default false,
  policy_version text, approval_ref text, moderation_ref text, retention_ref text,
  retain_for interval check (retain_for>interval '0'),
  writes_hour integer check (writes_hour between 1 and 100),
  writes_day integer check (writes_day between 1 and 1000),
  check (not enabled or (nullif(btrim(policy_version),'') is not null
    and nullif(btrim(approval_ref),'') is not null and nullif(btrim(moderation_ref),'') is not null
    and nullif(btrim(retention_ref),'') is not null and retain_for is not null
    and writes_hour is not null and writes_day>=writes_hour) is true)
);
create table public.network_social_votes_v2 (
  event_id uuid not null references public.network_events_v2(public_id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('CONFIRMED','NO_LONGER_PRESENT')),
  policy_version text not null, valid_until timestamptz not null,
  primary key(event_id,user_id)
);
create table public.network_social_follows_v2 (
  event_id uuid not null references public.network_events_v2(public_id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_version text not null, valid_until timestamptz not null,
  primary key(event_id,user_id)
);
create table public.network_social_comments_v2 (
  public_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.network_events_v2(public_id),
  author_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check(char_length(btrim(nickname)) between 2 and 40),
  body text not null check(char_length(btrim(body)) between 2 and 1000),
  policy_version text not null,
  moderation_state text not null default 'PENDING' check(moderation_state in ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  revision integer not null default 1 check(revision>0), review_ref text,
  created_at timestamptz not null default clock_timestamp(), valid_until timestamptz not null,
  check (moderation_state<>'APPROVED' or nullif(btrim(review_ref),'') is not null)
);
-- Immutable receipts, not a second copy of comment bodies. Replay never reapplies an older action.
create table public.network_social_operations_v2 (
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null, event_id uuid not null references public.network_events_v2(public_id),
  action text not null check(action in ('VOTE','FOLLOW','COMMENT')),
  value text, comment_id uuid references public.network_social_comments_v2(public_id),
  created_at timestamptz not null default clock_timestamp(), primary key(user_id,operation_id)
);
create index network_social_operations_actor_time_idx on public.network_social_operations_v2(user_id,created_at desc);
create index network_social_comments_page_idx on public.network_social_comments_v2(event_id,created_at desc,public_id desc);
create index network_social_comments_queue_idx on public.network_social_comments_v2(created_at,public_id) where moderation_state='PENDING';
create index network_social_comments_activity_idx on public.network_social_comments_v2(created_at desc,public_id desc) where moderation_state='APPROVED';
create index network_social_follows_owner_idx on public.network_social_follows_v2(user_id,event_id);

alter table public.network_social_policies_v2 enable row level security;
alter table public.network_social_votes_v2 enable row level security;
alter table public.network_social_follows_v2 enable row level security;
alter table public.network_social_comments_v2 enable row level security;
alter table public.network_social_operations_v2 enable row level security;
revoke all on public.network_social_policies_v2,public.network_social_votes_v2,public.network_social_follows_v2,
  public.network_social_comments_v2,public.network_social_operations_v2 from public,anon,authenticated,service_role;
grant select,insert,update on public.network_social_policies_v2 to service_role;

create function public.network_social_actor_allowed_v2(actor uuid,territory uuid)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select (actor is not null and public.network_user_is_eligible(actor) is true
    and public.network_user_is_restricted(actor,'read') is false
    and public.network_user_is_restricted(actor,'publish') is false
    and exists(select 1 from public.network_event_policies_v2 p
      join public.network_preferences n on n.user_id=actor and n.accepted_at is not null
        and n.network_terms_version=p.required_terms_version
      where p.territory_id=territory and p.enabled and (p.access_mode='NETWORK' or exists(
        select 1 from public.network_event_members_v2 m where m.user_id=actor and m.territory_id=territory
          and m.policy_version=p.policy_version and m.revoked_at is null and m.valid_until>statement_timestamp())))) is true;
$$;
create function public.network_social_require_v2(target_event uuid)
returns public.network_events_v2 language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare e public.network_events_v2%rowtype; p public.network_event_policies_v2%rowtype;
begin
  if auth.uid() is null then raise exception 'Social unavailable' using errcode='42501'; end if;
  select * into e from public.network_events_v2 where public_id=target_event;
  if not found then raise exception 'Social unavailable' using errcode='42501'; end if;
  p:=public.network_event_require_access_v2(e.territory_id,'read');
  if public.network_event_is_public_v2(e,p) is distinct from true or not exists(
    select 1 from public.network_social_policies_v2 s where s.territory_id=e.territory_id and s.enabled) then
    raise exception 'Social unavailable' using errcode='42501'; end if;
  return e;
end $$;

-- Every row is rechecked for current reader, parent, policy and contributor access.
create function public.get_network_social_v2(target_event uuid,before_created timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare evt public.network_events_v2%rowtype; pol public.network_event_policies_v2%rowtype; result jsonb;
begin
  evt:=public.network_social_require_v2(target_event);
  if (before_created is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  pol:=public.network_event_require_access_v2(evt.territory_id,'read');
  perform public.network_event_take_read_v2(pol.read_limit_minute);
  select jsonb_build_object('eventId',e.public_id,'validUntil',to_char(least(e.expires_at,e.purge_after,
    (select min(x.valid_until) from (
      select v.valid_until from public.network_social_votes_v2 v where v.event_id=e.public_id and v.policy_version=s.policy_version
        and v.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(v.user_id,e.territory_id)
      union all select f.valid_until from public.network_social_follows_v2 f where f.event_id=e.public_id and f.user_id=auth.uid()
        and f.policy_version=s.policy_version and f.valid_until>statement_timestamp()
      union all select c.valid_until from public.network_social_comments_v2 c where c.event_id=e.public_id and c.policy_version=s.policy_version
        and c.moderation_state='APPROVED' and c.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(c.author_id,e.territory_id)
    ) x)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmedCount',(select count(*) from public.network_social_votes_v2 v where v.event_id=e.public_id and v.kind='CONFIRMED'
      and v.policy_version=s.policy_version and v.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(v.user_id,e.territory_id)),
    'noLongerPresentCount',(select count(*) from public.network_social_votes_v2 v where v.event_id=e.public_id and v.kind='NO_LONGER_PRESENT'
      and v.policy_version=s.policy_version and v.valid_until>statement_timestamp() and public.network_social_actor_allowed_v2(v.user_id,e.territory_id)),
    'myVote',(select v.kind from public.network_social_votes_v2 v where v.event_id=e.public_id and v.user_id=auth.uid()
      and v.policy_version=s.policy_version and v.valid_until>statement_timestamp()),
    'following',exists(select 1 from public.network_social_follows_v2 f where f.event_id=e.public_id and f.user_id=auth.uid()
      and f.policy_version=s.policy_version and f.valid_until>statement_timestamp()),
    'comments',coalesce((select jsonb_agg(jsonb_build_object('publicId',c.public_id,'nickname',c.nickname,'body',c.body,
      'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'canWithdraw',c.author_id=auth.uid()) order by c.created_at desc,c.public_id desc)
      from (select c.* from public.network_social_comments_v2 c where c.event_id=e.public_id and c.moderation_state='APPROVED'
        and c.policy_version=s.policy_version and c.valid_until>statement_timestamp()
        and public.network_social_actor_allowed_v2(c.author_id,e.territory_id)
        and (before_created is null or (c.created_at,c.public_id)<(before_created,before_id))
        order by c.created_at desc,c.public_id desc limit 50) c),'[]'::jsonb)) into result
    from public.network_events_v2 e join public.network_event_policies_v2 p on p.territory_id=e.territory_id
    join public.network_social_policies_v2 s on s.territory_id=e.territory_id and s.enabled
    where e.public_id=target_event and public.network_event_is_public_v2(e,p);
  if result is null then raise exception 'Social unavailable' using errcode='42501'; end if;
  return result;
end $$;

create function public.mutate_network_social_v2(target_event uuid,target_operation uuid,action_kind text,action_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare actor uuid:=auth.uid(); e public.network_events_v2%rowtype; s public.network_social_policies_v2%rowtype;
  op public.network_social_operations_v2%rowtype; cid uuid; nick text; cutoff timestamptz:=clock_timestamp();
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if target_operation is null or action_kind is null or action_kind not in ('VOTE','FOLLOW','COMMENT')
    or (action_kind='VOTE' and (action_value is null or action_value not in ('CONFIRMED','NO_LONGER_PRESENT','NONE')))
    or (action_kind='FOLLOW' and (action_value is null or action_value not in ('ON','OFF')))
    or (action_kind='COMMENT' and (action_value is null or char_length(btrim(action_value)) not between 2 and 1000)) then
    raise exception 'Invalid social action' using errcode='22023'; end if;
  if action_kind='COMMENT' then action_value:=btrim(action_value); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,7011));
  e:=public.network_social_require_v2(target_event);
  select * into s from public.network_social_policies_v2 where territory_id=e.territory_id and enabled for share;
  perform 1 from public.network_event_policies_v2 where territory_id=e.territory_id for share;
  select * into e from public.network_events_v2 where public_id=target_event for update;
  -- Recheck after each lock wait; never trust the earlier composite event.
  if s.territory_id is null or public.network_social_actor_allowed_v2(actor,e.territory_id) is distinct from true then
    raise exception 'Social unavailable' using errcode='42501'; end if;
  e:=public.network_social_require_v2(target_event);
  select * into op from public.network_social_operations_v2 where user_id=actor and operation_id=target_operation;
  if found then
    if op.event_id is distinct from target_event or op.action is distinct from action_kind
      or (action_kind<>'COMMENT' and op.value is distinct from action_value)
      or (action_kind='COMMENT' and not exists(select 1 from public.network_social_comments_v2 c
        where c.public_id=op.comment_id and c.author_id=actor and c.body=action_value)) then
      raise exception 'Operation conflict' using errcode='22023'; end if;
    return jsonb_build_object('operationId',target_operation,'eventId',target_event,'action',action_kind,
      'commentId',op.comment_id,'replayed',true);
  end if;
  cutoff:=clock_timestamp();
  if (e.status<>'ACTIVE' and not (action_kind='FOLLOW' and action_value='OFF') and not (action_kind='VOTE' and action_value='NONE'))
    or e.expires_at<=cutoff or e.purge_after<=cutoff then
    raise exception 'Event no longer active' using errcode='42501'; end if;
  if (select count(*) from public.network_social_operations_v2 where user_id=actor and created_at>cutoff-interval '1 hour')>=s.writes_hour
    or (select count(*) from public.network_social_operations_v2 where user_id=actor and created_at>cutoff-interval '24 hours')>=s.writes_day then
    raise exception 'Social rate limit' using errcode='54000'; end if;
  if action_kind='VOTE' then
    if action_value='NONE' then delete from public.network_social_votes_v2 where event_id=target_event and user_id=actor;
    else insert into public.network_social_votes_v2(event_id,user_id,kind,policy_version,valid_until)
      values(target_event,actor,action_value,s.policy_version,least(e.purge_after,cutoff+s.retain_for))
      on conflict(event_id,user_id) do update set kind=excluded.kind,policy_version=excluded.policy_version,valid_until=excluded.valid_until;
    end if;
  elsif action_kind='FOLLOW' then
    if action_value='OFF' then delete from public.network_social_follows_v2 where event_id=target_event and user_id=actor;
    else insert into public.network_social_follows_v2(event_id,user_id,policy_version,valid_until)
      values(target_event,actor,s.policy_version,least(e.purge_after,cutoff+s.retain_for))
      on conflict(event_id,user_id) do update set policy_version=excluded.policy_version,valid_until=excluded.valid_until;
    end if;
  else
    if exists(select 1 from public.network_social_comments_v2 where author_id=actor and event_id=target_event
      and body=action_value and created_at>cutoff-interval '10 minutes') then
      raise exception 'Duplicate comment' using errcode='23505'; end if;
    select nickname into nick from public.profiles where id=actor;
    insert into public.network_social_comments_v2(event_id,author_id,nickname,body,policy_version,valid_until)
      values(target_event,actor,nick,action_value,s.policy_version,least(e.purge_after,cutoff+s.retain_for)) returning public_id into cid;
  end if;
  insert into public.network_social_operations_v2(user_id,operation_id,event_id,action,value,comment_id)
    values(actor,target_operation,target_event,action_kind,case when action_kind='COMMENT' then null else action_value end,cid);
  return jsonb_build_object('operationId',target_operation,'eventId',target_event,'action',action_kind,'commentId',cid,'replayed',false);
end $$;

-- Privacy cleanup remains possible after gates/access loss; no read of hidden parent data.
create function public.get_my_network_social_operation_v2(target_operation uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.network_event_take_read_v2(120);
  return (select jsonb_build_object('operationId',o.operation_id,'eventId',o.event_id,'action',o.action,
    'commentId',o.comment_id,'replayed',true) from public.network_social_operations_v2 o
    where o.user_id=auth.uid() and o.operation_id=target_operation);
  -- NULL is not proof of failure: the original request may still be pending.
end $$;

create function public.remove_my_network_social_v2(target_event uuid,target_comment uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7011));
  if target_comment is null then
    delete from public.network_social_follows_v2 where event_id=target_event and user_id=auth.uid();
    delete from public.network_social_votes_v2 where event_id=target_event and user_id=auth.uid();
  else update public.network_social_comments_v2 set moderation_state='WITHDRAWN',revision=revision+1,review_ref=null
    where public_id=target_comment and event_id=target_event and author_id=auth.uid() and moderation_state<>'WITHDRAWN';
  end if;
end $$;

create function public.review_network_comment_v2(target_comment uuid,expected_revision integer,decision text,review_reference text)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp set lock_timeout='3s' as $$
declare c public.network_social_comments_v2%rowtype; evt public.network_events_v2%rowtype;
begin
  if decision is null or decision not in ('APPROVED','REJECTED','WITHDRAWN') or nullif(btrim(review_reference),'') is null then
    raise exception 'Invalid review' using errcode='22023'; end if;
  select * into c from public.network_social_comments_v2 where public_id=target_comment;
  if not found then raise exception 'Comment unavailable' using errcode='42501'; end if;
  perform 1 from public.network_social_policies_v2 s join public.network_events_v2 e on e.territory_id=s.territory_id
    where e.public_id=c.event_id for share of s;
  perform 1 from public.network_event_policies_v2 p join public.network_events_v2 e on e.territory_id=p.territory_id
    where e.public_id=c.event_id for share of p;
  select * into evt from public.network_events_v2 where public_id=c.event_id for update;
  select * into c from public.network_social_comments_v2 where public_id=target_comment for update;
  if c.revision is distinct from expected_revision then raise exception 'Stale review' using errcode='40001'; end if;
  if c.moderation_state='WITHDRAWN' then raise exception 'Terminal comment' using errcode='22023'; end if;
  if decision='APPROVED' and (c.valid_until<=clock_timestamp() or evt.expires_at<=clock_timestamp() or evt.purge_after<=clock_timestamp()
    or evt.moderation_state<>'APPROVED' or not exists(select 1 from public.network_social_policies_v2 s
      join public.network_event_policies_v2 p on p.territory_id=s.territory_id
      where s.territory_id=evt.territory_id and s.enabled and p.enabled and s.policy_version=c.policy_version
        and p.policy_version=evt.location_policy_version)
    or public.network_social_actor_allowed_v2(c.author_id,evt.territory_id) is distinct from true) then
    raise exception 'Comment not publishable' using errcode='42501'; end if;
  update public.network_social_comments_v2 set moderation_state=decision,review_ref=btrim(review_reference),revision=revision+1
    where public_id=target_comment;
end $$;

create function public.list_network_comment_review_v2(before_created timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if (before_created is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('publicId',c.public_id,'eventId',c.event_id,'body',c.body,'nickname',c.nickname,
    'revision',c.revision,'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    order by c.created_at desc,c.public_id desc),'[]'::jsonb) from (
      select c.* from public.network_social_comments_v2 c join public.network_events_v2 e on e.public_id=c.event_id
      join public.network_social_policies_v2 s on s.territory_id=e.territory_id and s.enabled
      where c.moderation_state='PENDING' and c.valid_until>statement_timestamp() and e.expires_at>statement_timestamp()
        and c.policy_version=s.policy_version and (before_created is null or (c.created_at,c.public_id)<(before_created,before_id))
      order by c.created_at desc,c.public_id desc limit 50) c);
end $$;

-- Activity is derived from currently readable comments, not a permanent copy of withdrawn content.
create function public.list_network_social_activity_v2(target_territory uuid,followed_only boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pol public.network_event_policies_v2%rowtype;
begin
  pol:=public.network_event_require_access_v2(target_territory,'read');
  if followed_only is null then raise exception 'Invalid activity filter' using errcode='22023'; end if;
  perform public.network_event_take_read_v2(pol.read_limit_minute);
  return (select coalesce(jsonb_agg(jsonb_build_object('publicId',a.public_id,'eventId',a.event_id,
    'kind','COMMENT_APPROVED','createdAt',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(a.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    order by a.created_at desc,a.public_id desc),'[]'::jsonb) from (
      select c.public_id,c.event_id,c.created_at,least(c.valid_until,e.expires_at,e.purge_after) as valid_until from public.network_social_comments_v2 c
      join public.network_events_v2 e on e.public_id=c.event_id
      join public.network_event_policies_v2 p on p.territory_id=e.territory_id
      join public.network_social_policies_v2 s on s.territory_id=e.territory_id and s.enabled
      where e.territory_id=target_territory and public.network_event_is_public_v2(e,p)
        and c.moderation_state='APPROVED' and c.policy_version=s.policy_version and c.valid_until>statement_timestamp()
        and public.network_social_actor_allowed_v2(c.author_id,e.territory_id)
        and (not followed_only or exists(select 1 from public.network_social_follows_v2 f where f.user_id=auth.uid()
          and f.event_id=e.public_id and f.policy_version=s.policy_version and f.valid_until>statement_timestamp()))
      order by c.created_at desc,c.public_id desc limit 50) a);
end $$;

revoke all on function public.network_social_actor_allowed_v2(uuid,uuid),public.network_social_require_v2(uuid),
  public.get_network_social_v2(uuid,timestamptz,uuid),public.mutate_network_social_v2(uuid,uuid,text,text),
  public.get_my_network_social_operation_v2(uuid),
  public.remove_my_network_social_v2(uuid,uuid),public.review_network_comment_v2(uuid,integer,text,text),
  public.list_network_comment_review_v2(timestamptz,uuid),public.list_network_social_activity_v2(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_network_social_v2(uuid,timestamptz,uuid),public.mutate_network_social_v2(uuid,uuid,text,text),
  public.get_my_network_social_operation_v2(uuid),
  public.remove_my_network_social_v2(uuid,uuid),public.list_network_social_activity_v2(uuid,boolean) to authenticated;
grant execute on function public.review_network_comment_v2(uuid,integer,text,text),public.list_network_comment_review_v2(timestamptz,uuid) to service_role;
commit;
