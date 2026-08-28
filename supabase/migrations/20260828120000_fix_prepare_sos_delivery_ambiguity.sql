begin;

-- Qualify the eligible CTE distance explicitly. In PL/pgSQL the unqualified
-- name collided with the distance_meters RETURNS TABLE output variable and
-- could fail only when the function was executed.
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
  selected_radius_meters integer := 5000;
  desired_nearby_recipients constant integer := 5;
  maximum_nearby_recipients constant integer := 25;
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

  with eligible as (
      select
        presence.user_id,
        2 * 6371000 * asin(sqrt(least(1::double precision, greatest(
          0::double precision,
          power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
          + cos(radians(target_sos.latitude)) * cos(radians(presence.latitude))
          * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
        )))) as distance_meters
      from public.sos_network_presence presence
      join public.radar_preferences preferences
        on preferences.user_id = presence.user_id
       and preferences.sos_network_enabled = true
      where presence.user_id <> target_sos.user_id
        and presence.is_active = true
        and presence.observed_at >= now() - interval '30 minutes'
        and presence.updated_at >= now() - interval '30 minutes'
        and presence.accuracy <= 100
    )
    select case
      when count(*) filter (where eligible.distance_meters <= 1000)
        >= desired_nearby_recipients then 1000
      when count(*) filter (where eligible.distance_meters <= 3000)
        >= desired_nearby_recipients then 3000
      else 5000
    end
    into selected_radius_meters
    from eligible;

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
      ranked.user_id,
      ranked.distance_meters,
      'detected'::public.nearby_alert_status,
      now()
    from (
      select
        presence.user_id,
        round(2 * 6371000 * asin(sqrt(least(1::double precision, greatest(
          0::double precision,
          power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
          + cos(radians(target_sos.latitude)) * cos(radians(presence.latitude))
          * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
        )))))::integer as distance_meters,
        (2 * 6371000 * asin(sqrt(least(1::double precision, greatest(
          0::double precision,
          power(sin(radians(presence.latitude - target_sos.latitude) / 2), 2)
          + cos(radians(target_sos.latitude)) * cos(radians(presence.latitude))
          * power(sin(radians(presence.longitude - target_sos.longitude) / 2), 2)
        )))))
          + case
              when presence.observed_at >= now() - interval '5 minutes' then 0
              when presence.observed_at >= now() - interval '15 minutes' then 1000
              else 3000
            end
          + extract(epoch from (now() - presence.observed_at)) * 2
          + presence.accuracy * 5 as reliability_score
      from public.sos_network_presence presence
      join public.radar_preferences preferences
        on preferences.user_id = presence.user_id
       and preferences.sos_network_enabled = true
      where presence.user_id <> target_sos.user_id
        and presence.is_active = true
        and presence.observed_at >= now() - interval '30 minutes'
        and presence.updated_at >= now() - interval '30 minutes'
        and presence.accuracy <= 100
    ) ranked
    where ranked.distance_meters <= selected_radius_meters
    order by ranked.reliability_score asc, ranked.distance_meters asc, ranked.user_id asc
    limit maximum_nearby_recipients
  on conflict (sos_id, nearby_user_id) do update
  set distance_meters = excluded.distance_meters,
      status = 'detected'::public.nearby_alert_status,
      created_at = excluded.created_at;

  return query
  with trusted_recipients as (
    select contact.linked_profile_id as user_id,
      true as trusted,
      false as nearby,
      null::integer as distance
    from public.trusted_contacts contact
    where contact.user_id = target_sos.user_id
      and contact.linked_profile_id is not null
      and contact.linked_profile_id <> target_sos.user_id
  ),
  nearby_recipients as (
    select alert.nearby_user_id,
      false,
      true,
      greatest(0, round(alert.distance_meters))::integer
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
  select combined.user_id,
    bool_or(combined.trusted),
    bool_or(combined.nearby),
    min(combined.distance)
  from combined_recipients combined
  group by combined.user_id;
end;
$$;

revoke all on function public.prepare_sos_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_sos_delivery(uuid) to service_role;

commit;
