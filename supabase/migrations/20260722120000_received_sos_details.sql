begin;

create or replace function public.get_received_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sender_display_name text,
  sos_status public.sos_status,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  event_time timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.id,
    coalesce(nullif(trim(p.nickname), ''), 'Contatto SafeMeLink'),
    s.status,
    s.latitude,
    s.longitude,
    s.accuracy,
    coalesce(s.device_time, s.created_at)
  from public.sos s
  join public.profiles p on p.id = s.user_id
  where s.id = target_sos_id
    and auth.uid() is not null
    and exists (
      select 1
      from public.trusted_contacts tc
      where tc.user_id = s.user_id
        and tc.linked_profile_id = auth.uid()
    );
$$;

revoke all on function public.get_received_sos(uuid) from public;
grant execute on function public.get_received_sos(uuid) to authenticated;

commit;
