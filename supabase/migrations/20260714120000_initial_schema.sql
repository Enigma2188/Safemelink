begin;

create extension if not exists pgcrypto;

create type public.sos_status as enum ('open', 'accepted', 'closed', 'cancelled');
create type public.guardian_status as enum ('pending', 'accepted', 'rejected', 'revoked');
create type public.nearby_alert_status as enum ('detected', 'acknowledged', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  phone text,
  avatar text,
  available boolean not null default false,
  last_position jsonb,
  last_online timestamptz,
  created_at timestamptz not null default now(),
  constraint profiles_nickname_length
    check (nickname is null or char_length(trim(nickname)) between 2 and 40),
  constraint profiles_phone_length
    check (phone is null or char_length(phone) between 6 and 32)
);

create table public.sos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  device_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status public.sos_status not null default 'open',
  accepted_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  constraint sos_latitude_range check (latitude between -90 and 90),
  constraint sos_longitude_range check (longitude between -180 and 180),
  constraint sos_accuracy_nonnegative check (accuracy is null or accuracy >= 0),
  constraint sos_acceptance_consistency check (
    status <> 'accepted' or accepted_by is not null
  ),
  constraint sos_closure_consistency check (
    (status in ('closed', 'cancelled') and closed_at is not null)
    or (status not in ('closed', 'cancelled') and closed_at is null)
  ),
  constraint sos_not_accepted_by_owner check (accepted_by is null or accepted_by <> user_id)
);

create table public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  phone text not null,
  priority smallint not null,
  constraint trusted_contacts_name_not_empty check (char_length(trim(name)) > 0),
  constraint trusted_contacts_phone_not_empty check (char_length(trim(phone)) >= 6),
  constraint trusted_contacts_priority_range check (priority between 1 and 3),
  constraint trusted_contacts_unique_priority unique (user_id, priority),
  constraint trusted_contacts_unique_phone unique (user_id, phone)
);

create table public.guardian (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  status public.guardian_status not null default 'pending',
  constraint guardian_no_self_relation check (user_id <> guardian_id),
  constraint guardian_unique_relation unique (user_id, guardian_id)
);

-- Schema-only foundation for a future Radar implementation. RLS is enabled below,
-- but no access policy is intentionally granted during Phase 1.
create table public.nearby_alerts (
  id uuid primary key default gen_random_uuid(),
  sos_id uuid not null references public.sos(id) on delete cascade,
  source_user_id uuid not null references public.profiles(id) on delete cascade,
  nearby_user_id uuid not null references public.profiles(id) on delete cascade,
  distance_meters double precision not null,
  status public.nearby_alert_status not null default 'detected',
  created_at timestamptz not null default now(),
  constraint nearby_alerts_distance_nonnegative check (distance_meters >= 0),
  constraint nearby_alerts_distinct_users check (source_user_id <> nearby_user_id),
  constraint nearby_alerts_unique_detection unique (sos_id, nearby_user_id)
);

create index sos_user_created_idx on public.sos (user_id, created_at desc);
create index sos_status_created_idx on public.sos (status, created_at desc);
create index sos_accepted_by_idx on public.sos (accepted_by) where accepted_by is not null;
create index trusted_contacts_user_idx on public.trusted_contacts (user_id);
create index guardian_guardian_id_idx on public.guardian (guardian_id);
create index nearby_alerts_nearby_user_created_idx
  on public.nearby_alerts (nearby_user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_sos_updated_at
before update on public.sos
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.sos enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.guardian enable row level security;
alter table public.nearby_alerts enable row level security;

create policy "profiles_select_own"
on public.profiles for select to authenticated
using (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "sos_select_own"
on public.sos for select to authenticated
using (user_id = auth.uid());

create policy "sos_insert_own"
on public.sos for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'open'
  and accepted_by is null
  and closed_at is null
);

-- During Phase 1 only the owner can update or delete an SOS. Atomic acceptance
-- by other users will be introduced later through a dedicated database function.
create policy "sos_update_own"
on public.sos for update to authenticated
using (
  user_id = auth.uid()
  and status = 'open'
  and accepted_by is null
)
with check (
  user_id = auth.uid()
  and status in ('open', 'cancelled')
  and accepted_by is null
);

create policy "sos_delete_own"
on public.sos for delete to authenticated
using (user_id = auth.uid());

create policy "trusted_contacts_select_own"
on public.trusted_contacts for select to authenticated
using (user_id = auth.uid());

create policy "trusted_contacts_insert_own"
on public.trusted_contacts for insert to authenticated
with check (user_id = auth.uid());

create policy "trusted_contacts_update_own"
on public.trusted_contacts for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "trusted_contacts_delete_own"
on public.trusted_contacts for delete to authenticated
using (user_id = auth.uid());

create policy "guardian_select_participant"
on public.guardian for select to authenticated
using (user_id = auth.uid() or guardian_id = auth.uid());

create policy "guardian_insert_requester"
on public.guardian for insert to authenticated
with check (
  user_id = auth.uid()
  and guardian_id <> auth.uid()
  and status = 'pending'
);

create policy "guardian_delete_requester"
on public.guardian for delete to authenticated
using (user_id = auth.uid());

-- nearby_alerts deliberately has no policies: authenticated clients cannot use it
-- until the future Radar design defines server-side creation and privacy rules.

commit;
