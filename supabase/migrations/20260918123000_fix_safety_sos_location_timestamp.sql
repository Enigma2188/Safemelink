begin;

-- Correct Development schema drift without inventing observation timestamps.
-- Existing rows stay NULL; an existing real observation timestamp is preserved.
alter table public.sos add column if not exists location_updated_at timestamptz;
alter table public.sos alter column location_updated_at drop default;

-- Live updates carry the GPS observation time, not the lifecycle updated_at.
create or replace function public.update_my_active_sos_location(
  target_sos_id uuid,
  position_latitude double precision,
  position_longitude double precision,
  position_accuracy double precision,
  position_observed_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if target_sos_id is null
     or position_latitude is null or position_latitude not between -90 and 90
     or position_longitude is null or position_longitude not between -180 and 180
     or position_accuracy is null or position_accuracy < 0 or position_accuracy > 100
     or position_observed_at is null
     or position_observed_at < now() - interval '10 minutes'
     or position_observed_at > now() + interval '2 minutes' then
    raise exception 'Invalid SOS location.' using errcode = '22023';
  end if;

  update public.sos target
  set latitude = position_latitude,
      longitude = position_longitude,
      accuracy = position_accuracy,
      location_updated_at = position_observed_at,
      updated_at = now()
  where target.id = target_sos_id
    and target.user_id = current_user_id
    and target.status in ('open', 'accepted');

  return found;
end;
$$;

revoke all on function public.update_my_active_sos_location(
  uuid, double precision, double precision, double precision, timestamptz
) from public, anon;
grant execute on function public.update_my_active_sos_location(
  uuid, double precision, double precision, double precision, timestamptz
) to authenticated;

-- The return shape changes to expose freshness, so recreate this RPC explicitly.
drop function if exists public.get_received_sos(uuid);
create function public.get_received_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sender_display_name text,
  sos_status public.sos_status,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  event_time timestamptz,
  location_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recipient_access as (
    select
      exists (
        select 1
        from public.trusted_contacts trusted_contact
        where trusted_contact.user_id = target.user_id
          and trusted_contact.linked_profile_id = auth.uid()
      ) as trusted,
      exists (
        select 1
        from public.nearby_alerts nearby_alert
        where nearby_alert.sos_id = target.id
          and nearby_alert.source_user_id = target.user_id
          and nearby_alert.nearby_user_id = auth.uid()
          and nearby_alert.status in ('detected', 'acknowledged')
      ) as nearby
    from public.sos target
    where target.id = target_sos_id
  )
  select
    target.id,
    case
      when access.trusted then
        coalesce(nullif(trim(sender_profile.nickname), ''), 'Contatto SafeMeLink')
      when access.nearby
        and sender_preferences.show_nickname = true
        and nullif(trim(sender_preferences.public_nickname), '') is not null then
        trim(sender_preferences.public_nickname)
      else 'Utente SafeMeLink'
    end,
    target.status,
    target.latitude,
    target.longitude,
    target.accuracy,
    coalesce(target.device_time, target.created_at),
    target.location_updated_at
  from public.sos target
  join public.profiles sender_profile on sender_profile.id = target.user_id
  left join public.radar_preferences sender_preferences
    on sender_preferences.user_id = target.user_id
  cross join recipient_access access
  where target.id = target_sos_id
    and target.status in ('open', 'accepted')
    and auth.uid() is not null
    and (access.trusted or access.nearby);
$$;

revoke all on function public.get_received_sos(uuid) from public, anon;
grant execute on function public.get_received_sos(uuid) to authenticated;

commit;
