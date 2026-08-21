begin;

alter table public.trusted_contacts
  add column if not exists phone_e164 text,
  add column if not exists preferred_channel text not null default 'sms';

alter table public.trusted_contacts
  alter column preferred_channel set default 'sms';

update public.trusted_contacts
set preferred_channel = 'sms'
where preferred_channel is null;

alter table public.trusted_contacts
  alter column preferred_channel set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.trusted_contacts'::regclass
      and conname = 'trusted_contacts_phone_e164_format'
  ) then
    alter table public.trusted_contacts
      add constraint trusted_contacts_phone_e164_format
      check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.trusted_contacts'::regclass
      and conname = 'trusted_contacts_preferred_channel_valid'
  ) then
    alter table public.trusted_contacts
      add constraint trusted_contacts_preferred_channel_valid
      check (preferred_channel in ('sms', 'whatsapp'));
  end if;
end;
$$;

with normalized as (
  select
    id,
    user_id,
    priority,
    case
      when trim(phone) like '+%'
        then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
      when trim(phone) like '00%'
        then '+' || substring(regexp_replace(phone, '[^0-9]', '', 'g') from 3)
      else null
    end as candidate
  from public.trusted_contacts
  where phone_e164 is null
    and phone is not null
),
valid_candidates as (
  select
    id,
    user_id,
    candidate,
    row_number() over (
      partition by user_id, candidate
      order by priority, id
    ) as duplicate_rank
  from normalized
  where candidate ~ '^\+[1-9][0-9]{6,14}$'
)
update public.trusted_contacts as contacts
set phone_e164 = valid_candidates.candidate
from valid_candidates
where contacts.id = valid_candidates.id
  and valid_candidates.duplicate_rank = 1;

create unique index if not exists trusted_contacts_unique_phone_e164_idx
  on public.trusted_contacts (user_id, phone_e164)
  where phone_e164 is not null;

commit;
