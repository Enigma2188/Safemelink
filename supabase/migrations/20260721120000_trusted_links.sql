begin;

create extension if not exists pgcrypto;

create or replace function public.generate_profile_public_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  loop
    candidate := 'SML-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.profiles where public_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

alter table public.profiles
  add column public_code text,
  add constraint profiles_public_code_format
    check (public_code ~ '^SML-[0-9A-F]{8}$'),
  add constraint profiles_public_code_unique unique (public_code);

do $$
declare
  profile_row record;
begin
  for profile_row in
    select id from public.profiles where public_code is null
  loop
    update public.profiles
    set public_code = public.generate_profile_public_code()
    where id = profile_row.id;
  end loop;
end;
$$;

alter table public.profiles
  alter column public_code set default public.generate_profile_public_code(),
  alter column public_code set not null;

create or replace function public.prevent_profile_public_code_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.public_code is distinct from old.public_code then
    raise exception 'Il codice pubblico SafeMeLink non può essere modificato.';
  end if;

  return new;
end;
$$;

create trigger prevent_profile_public_code_change
before update of public_code on public.profiles
for each row execute function public.prevent_profile_public_code_change();

alter table public.trusted_contacts
  drop constraint trusted_contacts_phone_not_empty,
  drop constraint trusted_contacts_priority_range,
  alter column phone drop not null,
  alter column priority type integer,
  add constraint trusted_contacts_phone_valid
    check (phone is null or char_length(trim(phone)) >= 6);

create unique index trusted_contacts_unique_linked_profile_idx
  on public.trusted_contacts (user_id, linked_profile_id)
  where linked_profile_id is not null;

create table public.trusted_contact_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trusted_contact_requests_status
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  constraint trusted_contact_requests_no_self
    check (requester_user_id <> recipient_user_id)
);

create unique index trusted_contact_requests_unique_pending_idx
  on public.trusted_contact_requests (
    least(requester_user_id, recipient_user_id),
    greatest(requester_user_id, recipient_user_id)
  )
  where status = 'pending';

create index trusted_contact_requests_requester_created_idx
  on public.trusted_contact_requests (requester_user_id, created_at desc);

create index trusted_contact_requests_recipient_created_idx
  on public.trusted_contact_requests (recipient_user_id, created_at desc);

create trigger set_trusted_contact_requests_updated_at
before update on public.trusted_contact_requests
for each row execute function public.set_updated_at();

alter table public.trusted_contact_requests enable row level security;

create policy "trusted_contact_requests_select_participant"
on public.trusted_contact_requests
for select
to authenticated
using (
  requester_user_id = auth.uid()
  or recipient_user_id = auth.uid()
);

create or replace function public.get_my_public_code()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public_code
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.create_trusted_contact_request(target_public_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  recipient_id uuid;
  request_id uuid;
begin
  if requester_id is null then
    raise exception 'Autenticazione richiesta.';
  end if;

  if (
    select count(*)
    from public.trusted_contact_requests
    where requester_user_id = requester_id
      and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Troppe richieste. Riprova più tardi.';
  end if;

  select id into recipient_id
  from public.profiles
  where public_code = upper(trim(target_public_code));

  if recipient_id is null
    or recipient_id = requester_id
    or exists (
      select 1
      from public.trusted_contacts
      where user_id = requester_id
        and linked_profile_id = recipient_id
    ) then
    raise exception 'Impossibile inviare la richiesta con questo codice.';
  end if;

  insert into public.trusted_contact_requests (
    requester_user_id,
    recipient_user_id
  ) values (
    requester_id,
    recipient_id
  )
  returning id into request_id;

  return request_id;
exception
  when unique_violation then
    raise exception 'Esiste già una richiesta pendente tra questi utenti.';
end;
$$;

create or replace function public.list_my_trusted_contact_requests()
returns table (
  request_id uuid,
  direction text,
  request_status text,
  display_name text,
  counterpart_code text,
  request_created_at timestamptz,
  request_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.id,
    case
      when r.requester_user_id = auth.uid() then 'sent'
      else 'received'
    end,
    r.status,
    coalesce(nullif(trim(p.nickname), ''), 'SafeMeLink ' || p.public_code),
    p.public_code,
    r.created_at,
    r.updated_at
  from public.trusted_contact_requests r
  join public.profiles p
    on p.id = case
      when r.requester_user_id = auth.uid() then r.recipient_user_id
      else r.requester_user_id
    end
  where r.requester_user_id = auth.uid()
     or r.recipient_user_id = auth.uid()
  order by r.created_at desc;
$$;

create or replace function public.respond_to_trusted_contact_request(
  target_request_id uuid,
  accept_request boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  pending_request public.trusted_contact_requests%rowtype;
  requester_priority integer;
  recipient_priority integer;
  requester_name text;
  recipient_name text;
begin
  if current_user_id is null then
    raise exception 'Autenticazione richiesta.';
  end if;

  select * into pending_request
  from public.trusted_contact_requests
  where id = target_request_id
    and recipient_user_id = current_user_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Richiesta non disponibile.';
  end if;

  if not accept_request then
    update public.trusted_contact_requests
    set status = 'rejected'
    where id = pending_request.id;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(
      pending_request.requester_user_id::text,
      pending_request.recipient_user_id::text
    ), 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(greatest(
      pending_request.requester_user_id::text,
      pending_request.recipient_user_id::text
    ), 0)
  );

  select
    coalesce(nullif(trim(nickname), ''), 'SafeMeLink ' || public_code)
  into requester_name
  from public.profiles
  where id = pending_request.requester_user_id;

  select
    coalesce(nullif(trim(nickname), ''), 'SafeMeLink ' || public_code)
  into recipient_name
  from public.profiles
  where id = pending_request.recipient_user_id;

  select coalesce(max(priority), 0) + 1
  into requester_priority
  from public.trusted_contacts
  where user_id = pending_request.requester_user_id;

  select coalesce(max(priority), 0) + 1
  into recipient_priority
  from public.trusted_contacts
  where user_id = pending_request.recipient_user_id;

  insert into public.trusted_contacts (
    user_id,
    linked_profile_id,
    name,
    phone,
    priority
  ) values (
    pending_request.requester_user_id,
    pending_request.recipient_user_id,
    recipient_name,
    null,
    requester_priority
  )
  on conflict (user_id, linked_profile_id)
    where linked_profile_id is not null
  do nothing;

  insert into public.trusted_contacts (
    user_id,
    linked_profile_id,
    name,
    phone,
    priority
  ) values (
    pending_request.recipient_user_id,
    pending_request.requester_user_id,
    requester_name,
    null,
    recipient_priority
  )
  on conflict (user_id, linked_profile_id)
    where linked_profile_id is not null
  do nothing;

  update public.trusted_contact_requests
  set status = 'accepted'
  where id = pending_request.id;
end;
$$;

create or replace function public.cancel_trusted_contact_request(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.trusted_contact_requests
  set status = 'cancelled'
  where id = target_request_id
    and requester_user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Richiesta non disponibile.';
  end if;
end;
$$;

revoke all on function public.generate_profile_public_code() from public;
revoke all on function public.get_my_public_code() from public;
revoke all on function public.create_trusted_contact_request(text) from public;
revoke all on function public.list_my_trusted_contact_requests() from public;
revoke all on function public.respond_to_trusted_contact_request(uuid, boolean) from public;
revoke all on function public.cancel_trusted_contact_request(uuid) from public;

grant execute on function public.get_my_public_code() to authenticated;
grant execute on function public.create_trusted_contact_request(text) to authenticated;
grant execute on function public.list_my_trusted_contact_requests() to authenticated;
grant execute on function public.respond_to_trusted_contact_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_trusted_contact_request(uuid) to authenticated;

commit;
