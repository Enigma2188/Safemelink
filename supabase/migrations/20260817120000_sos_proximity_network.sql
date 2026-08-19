begin;

-- Resolve the two SafeMeLink SOS recipient classes on the server:
-- personal trusted contacts and opted-in nearby network members.
-- Nearby recipients are persisted in nearby_alerts so a notification remains
-- authorizable after the short Radar presence TTL expires.
create or replace function public.prepare_sos_delivery(target_sos_id uuid)
returns table (
  recipient_user_id uuid,
  is_trusted boolean,
  is_nearby boolean,
  distance_meters integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  target_sos public.sos%rowtype;
  sender_network_enabled boolean := false;
begin
  if target_sos_id is null then
    raise exception 'SOS identifier is required.' using errcode = '22023';
  end if;

  select target.*
  into target_sos
  from public.sos target
  where target.id = target_sos_id
    and target.status = 'open';

  if not found then
    raise exception 'Open SOS not found.' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.radar_preferences sender_preferences
    where sender_preferences.user_id = target_sos.user_id
      and sender_preferences.radar_enabled = true
      and sender_preferences.visible_to_nearby = true
  )
  into sender_network_enabled;

  if sender_network_enabled then
    insert into public.nearby_alerts (
      sos_id,
      source_user_id,
      nearby_user_id,
      distance_meters,
      status,
      created_at
    )
    select
      target_sos.id,
      target_sos.user_id,
      candidate.user_id,
      candidate.exact_distance_meters,
      'detected'::public.nearby_alert_status,
      now()
    from (
      select
        presence.user_id,
        2 * 6371000 * asin(
          sqrt(
            least(
              1::double precision,
              greatest(
                0::double precision,
                power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
                + cos(radians(target_sos.latitude))
                  * cos(radians(presence.latitude))
                  * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
              )
            )
          )
        ) as exact_distance_meters
      from public.radar_presence presence
      join public.radar_preferences preferences
        on preferences.user_id = presence.user_id
       and preferences.radar_enabled = true
       and preferences.visible_to_nearby = true
      where presence.user_id <> target_sos.user_id
        and presence.is_active = true
        and presence.updated_at >= now() - public.radar_presence_ttl()
        and presence.accuracy is not null
        and presence.accuracy <= public.radar_max_accuracy_meters()
    ) candidate
    where candidate.exact_distance_meters <= 1000
    order by candidate.exact_distance_meters asc
    limit 25
    on conflict (sos_id, nearby_user_id) do update
    set distance_meters = excluded.distance_meters,
        status = 'detected'::public.nearby_alert_status,
        created_at = excluded.created_at;
  end if;

  return query
  with trusted_recipients as (
    select
      contact.linked_profile_id as user_id,
      true as trusted,
      false as nearby,
      null::integer as distance
    from public.trusted_contacts contact
    where contact.user_id = target_sos.user_id
      and contact.linked_profile_id is not null
      and contact.linked_profile_id <> target_sos.user_id
  ),
  nearby_recipients as (
    select
      alert.nearby_user_id as user_id,
      false as trusted,
      true as nearby,
      greatest(0, round(alert.distance_meters))::integer as distance
    from public.nearby_alerts alert
    where alert.sos_id = target_sos.id
      and alert.source_user_id = target_sos.user_id
      and alert.nearby_user_id <> target_sos.user_id
      and alert.status in ('detected', 'acknowledged')
  ),
  combined_recipients as (
    select * from trusted_recipients
    union all
    select * from nearby_recipients
  )
  select
    combined.user_id,
    bool_or(combined.trusted),
    bool_or(combined.nearby),
    min(combined.distance)
  from combined_recipients combined
  group by combined.user_id;
end;
$$;

revoke all on function public.prepare_sos_delivery(uuid) from public, anon, authenticated;
grant execute on function public.prepare_sos_delivery(uuid) to service_role;

-- Owners, personal trusted contacts and the server-selected nearby responders
-- can observe the lifecycle of the same SOS event.
create or replace function public.get_sos_status(target_sos_id uuid)
returns table (
  sos_id uuid,
  sos_status public.sos_status,
  is_owner boolean,
  accepted_by_me boolean,
  sos_updated_at timestamptz,
  sos_closed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target.id,
    target.status,
    target.user_id = auth.uid(),
    coalesce(target.accepted_by = auth.uid(), false),
    target.updated_at,
    target.closed_at
  from public.sos target
  where target.id = target_sos_id
    and auth.uid() is not null
    and (
      target.user_id = auth.uid()
      or exists (
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
    );
$$;

create or replace function public.accept_sos(target_sos_id uuid)
returns table (
  sos_id uuid,
  sos_status public.sos_status,
  is_owner boolean,
  accepted_by_me boolean,
  sos_updated_at timestamptz,
  sos_closed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_sos public.sos%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
  into target_sos
  from public.sos target
  where target.id = target_sos_id
  for update;

  if not found or not (
    exists (
      select 1
      from public.trusted_contacts trusted_contact
      where trusted_contact.user_id = target_sos.user_id
        and trusted_contact.linked_profile_id = current_user_id
    )
    or exists (
      select 1
      from public.nearby_alerts nearby_alert
      where nearby_alert.sos_id = target_sos.id
        and nearby_alert.source_user_id = target_sos.user_id
        and nearby_alert.nearby_user_id = current_user_id
        and nearby_alert.status in ('detected', 'acknowledged')
    )
  ) then
    raise exception 'SOS not found or not authorized.' using errcode = '42501';
  end if;

  if target_sos.user_id = current_user_id then
    raise exception 'The SOS owner cannot accept their own SOS.' using errcode = '42501';
  end if;

  if target_sos.status = 'accepted' and target_sos.accepted_by = current_user_id then
    return query
    select
      target_sos.id,
      target_sos.status,
      false,
      true,
      target_sos.updated_at,
      target_sos.closed_at;
    return;
  end if;

  if target_sos.status <> 'open' then
    raise exception 'Invalid SOS transition to accepted.' using errcode = '55000';
  end if;

  update public.sos target
  set status = 'accepted',
      accepted_by = current_user_id
  where target.id = target_sos.id
  returning * into target_sos;

  update public.nearby_alerts nearby_alert
  set status = 'acknowledged'
  where nearby_alert.sos_id = target_sos.id
    and nearby_alert.nearby_user_id = current_user_id;

  return query
  select
    target_sos.id,
    target_sos.status,
    false,
    true,
    target_sos.updated_at,
    target_sos.closed_at;
end;
$$;

-- Precise SOS coordinates remain accessible only while the emergency is active.
-- Nearby network members receive only the sender's optional public Radar nickname;
-- personal profile names remain restricted to trusted contacts.
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
    coalesce(target.device_time, target.created_at)
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

revoke all on function public.get_sos_status(uuid) from public;
revoke all on function public.accept_sos(uuid) from public;
revoke all on function public.get_received_sos(uuid) from public;

grant execute on function public.get_sos_status(uuid) to authenticated;
grant execute on function public.accept_sos(uuid) to authenticated;
grant execute on function public.get_received_sos(uuid) to authenticated;

commit;
