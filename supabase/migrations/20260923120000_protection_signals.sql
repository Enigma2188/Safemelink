-- Segnale Tutela: dati strutturati, privati e separati dal NETWORK.
create table if not exists public.protection_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_relation text not null check (subject_relation in ('SELF','WITNESSED','TOLD','PREFER_NOT_TO_SAY')),
  category text not null check (category in ('HUMILIATION','THREATS','ASSAULT','EXCLUSION','PRESSURE','CYBERBULLYING','OTHER')),
  frequency text not null check (frequency in ('ONCE','REPEATED','OFTEN','UNKNOWN')),
  place_type text not null check (place_type in ('SCHOOL','COMMUTE','SPORT','PUBLIC_PLACE','ONLINE','OTHER')),
  online_context text check (online_context is null or online_context in ('SOCIAL','CHAT','GAMING','OTHER')),
  approximate_area text,
  area_bucket text,
  needs_help text not null check (needs_help in ('NO','ADULT','DANGER_NOW')),
  trusted_contact_id uuid references public.trusted_contacts(id) on delete set null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  created_at timestamptz not null default now(),
  constraint protection_signals_online_no_area check (place_type <> 'ONLINE' or (approximate_area is null and area_bucket is null)),
  constraint protection_signals_online_context check (place_type = 'ONLINE' or online_context is null)
);

create index if not exists protection_signals_cluster_idx
  on public.protection_signals (area_bucket, category, created_at desc)
  where status = 'OPEN';
create index if not exists protection_signals_user_idx
  on public.protection_signals (user_id, created_at desc);

alter table public.protection_signals enable row level security;
revoke all on table public.protection_signals from public, anon, authenticated;

create or replace function public.create_protection_signal(
  target_subject_relation text,
  target_category text,
  target_frequency text,
  target_place_type text,
  target_online_context text,
  target_approximate_area text,
  target_area_bucket text,
  target_needs_help text,
  target_trusted_contact_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  created_id uuid;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  if target_place_type = 'ONLINE' and (target_approximate_area is not null or target_area_bucket is not null) then
    raise exception 'Online signals cannot contain location.' using errcode = '22023';
  end if;
  if target_place_type <> 'ONLINE' and target_online_context is not null then
    raise exception 'Online context is only valid for online signals.' using errcode = '22023';
  end if;
  if target_needs_help = 'DANGER_NOW' then
    raise exception 'Use the normal SafeMeLink SOS for immediate danger.' using errcode = '22023';
  end if;
  if target_trusted_contact_id is not null and not exists (
    select 1 from public.trusted_contacts tc
    where tc.id = target_trusted_contact_id and tc.user_id = actor
  ) then
    raise exception 'Trusted contact not available.' using errcode = '42501';
  end if;
  if (select count(*) from public.protection_signals ps where ps.user_id = actor and ps.created_at >= now() - interval '1 hour') >= 5 then
    raise exception 'Too many protection signals. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.protection_signals (
    user_id, subject_relation, category, frequency, place_type, online_context,
    approximate_area, area_bucket, needs_help, trusted_contact_id
  ) values (
    actor, target_subject_relation, target_category, target_frequency, target_place_type,
    target_online_context, target_approximate_area, target_area_bucket, target_needs_help,
    target_trusted_contact_id
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.get_protection_area_alert(
  target_area_bucket text,
  target_category text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct ps.user_id) >= 3
  from public.protection_signals ps
  where ps.status = 'OPEN'
    and ps.area_bucket = target_area_bucket
    and ps.category = target_category
    and ps.created_at >= now() - interval '14 days';
$$;

create or replace function public.list_protection_area_alerts(target_area_bucket text)
returns table (context_label text, category text, period_label text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case
      when ps.category in ('THREATS', 'ASSAULT', 'HUMILIATION', 'PRESSURE') then 'Comportamenti intimidatori o aggressivi'
      when ps.category = 'EXCLUSION' then 'Esclusione ripetuta'
      else 'Situazioni di tutela'
    end as context_label,
    case
      when ps.category in ('THREATS', 'ASSAULT', 'HUMILIATION', 'PRESSURE') then 'SAFETY'
      when ps.category = 'EXCLUSION' then 'EXCLUSION'
      else 'OTHER'
    end as category,
    'Negli ultimi giorni' as period_label
  from public.protection_signals ps
  where ps.status = 'OPEN'
    and ps.area_bucket = target_area_bucket
    and ps.place_type <> 'ONLINE'
    and ps.created_at >= now() - interval '14 days'
  group by 1, 2
  having count(distinct ps.user_id) >= 3;
$$;

revoke all on function public.create_protection_signal(text,text,text,text,text,text,text,text,uuid) from public, anon;
revoke all on function public.get_protection_area_alert(text,text) from public, anon;
revoke all on function public.list_protection_area_alerts(text) from public, anon;
grant execute on function public.create_protection_signal(text,text,text,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.get_protection_area_alert(text,text) to authenticated;
grant execute on function public.list_protection_area_alerts(text) to authenticated;
