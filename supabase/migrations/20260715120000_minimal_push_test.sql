begin;

alter table public.trusted_contacts
  add column linked_profile_id uuid
  references public.profiles(id)
  on delete set null;

create index trusted_contacts_linked_profile_idx
  on public.trusted_contacts (linked_profile_id)
  where linked_profile_id is not null;

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  device_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_push_tokens_platform
    check (platform in ('android', 'ios'))
);

create index device_push_tokens_user_active_idx
  on public.device_push_tokens (user_id, active);

create trigger set_device_push_tokens_updated_at
before update on public.device_push_tokens
for each row execute function public.set_updated_at();

alter table public.device_push_tokens enable row level security;

create policy "device_push_tokens_select_own"
on public.device_push_tokens
for select
to authenticated
using (user_id = auth.uid());

create policy "device_push_tokens_insert_own"
on public.device_push_tokens
for insert
to authenticated
with check (user_id = auth.uid());

create policy "device_push_tokens_update_own"
on public.device_push_tokens
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "device_push_tokens_delete_own"
on public.device_push_tokens
for delete
to authenticated
using (user_id = auth.uid());

commit;
