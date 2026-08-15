begin;

drop policy "trusted_contacts_insert_own" on public.trusted_contacts;

create policy "trusted_contacts_insert_own"
on public.trusted_contacts
for insert
to authenticated
with check (
  user_id = auth.uid()
  and linked_profile_id is null
);

create or replace function public.prevent_direct_trusted_link_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.linked_profile_id is distinct from old.linked_profile_id then
    raise exception 'SafeMeLink links can only be changed through trusted request functions.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_direct_trusted_link_change
before update of linked_profile_id on public.trusted_contacts
for each row execute function public.prevent_direct_trusted_link_change();

revoke all on function public.prevent_direct_trusted_link_change() from public;

commit;
