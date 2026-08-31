begin;

-- Recover active SOS notifications when the recipient opens SafeMeLink normally.
-- The inbox exposes only identifiers and timestamps; sensitive location remains
-- protected by get_received_sos and is returned only while the SOS is active.
create or replace function public.list_my_active_received_sos()
returns table (
  sos_id uuid,
  event_time timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target.id,
    coalesce(target.device_time, target.created_at)
  from public.sos target
  where auth.uid() is not null
    and target.user_id <> auth.uid()
    and target.status in ('open', 'accepted')
    and (
      exists (
        select 1
        from public.trusted_contacts trusted_contact
        where trusted_contact.user_id = target.user_id
          and trusted_contact.linked_profile_id = auth.uid()
      )
      or exists (
        select 1
        from public.nearby_alerts nearby_alert
        where nearby_alert.sos_id = target.id
          and nearby_alert.source_user_id = target.user_id
          and nearby_alert.nearby_user_id = auth.uid()
          and nearby_alert.status in ('detected', 'acknowledged')
      )
    )
  order by coalesce(target.device_time, target.created_at) desc
  limit 20;
$$;

revoke all on function public.list_my_active_received_sos() from public, anon;
grant execute on function public.list_my_active_received_sos() to authenticated;

commit;
