begin;

-- Additive, explicit outcome contract. No coordinate data is returned.
-- Ordering is by validated observation timestamp, not proof of physical freshness.
create or replace function public.update_my_active_sos_location_result(
  target_sos_id uuid,
  position_latitude double precision,
  position_longitude double precision,
  position_accuracy double precision,
  position_observed_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  locked_sos public.sos%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  -- Preserve the existing coordinate/accuracy and clock-skew validation.
  if target_sos_id is null
     or position_latitude is null or position_latitude not between -90 and 90
     or position_longitude is null or position_longitude not between -180 and 180
     or position_accuracy is null or position_accuracy < 0 or position_accuracy > 100
     or position_observed_at is null
     or position_observed_at < now() - interval '10 minutes'
     or position_observed_at > now() + interval '2 minutes' then
    raise exception 'Invalid SOS location.' using errcode = '22023';
  end if;

  -- Only lock an owned row. The same row lock serializes concurrent updates
  -- and status transitions; do not perform an unlocked existence pre-check.
  select target.* into locked_sos
  from public.sos as target
  where target.id = target_sos_id and target.user_id = current_user_id
  for update;
  if not found then
    raise exception 'SOS unavailable or not authorized.'
      using errcode = '42501', detail = 'SOS_LOCATION_OWNER_SCOPE';
  end if;
  if locked_sos.status not in ('open', 'accepted') then return 'inactive'; end if;
  if locked_sos.location_updated_at is not null
     and position_observed_at <= locked_sos.location_updated_at then
    return 'stale';
  end if;

  update public.sos as target
  set latitude = position_latitude,
      longitude = position_longitude,
      accuracy = position_accuracy,
      location_updated_at = position_observed_at,
      updated_at = now()
  where target.id = target_sos_id
    and target.user_id = current_user_id
    and target.status in ('open', 'accepted')
    and (target.location_updated_at is null
         or position_observed_at > target.location_updated_at);
  if not found then
    -- Under the retained row lock this is not an ordinary stale/no-op outcome.
    -- A trigger suppressing the update must not be reported as accepted.
    raise exception 'SOS location update not confirmed.' using errcode = '40001';
  end if;
  return 'updated';
end;
$$;

revoke all on function public.update_my_active_sos_location_result(
  uuid, double precision, double precision, double precision, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_my_active_sos_location_result(
  uuid, double precision, double precision, double precision, timestamptz
) to authenticated;

-- Backward-compatible signature and boolean semantics for installed APKs:
-- true = owned active SOS (including an ignored stale fix), false = unavailable
-- or terminal. Validation/authentication/network errors remain errors.
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
  outcome text;
  error_detail text;
begin
  outcome := public.update_my_active_sos_location_result(
    target_sos_id, position_latitude, position_longitude,
    position_accuracy, position_observed_at
  );
  return outcome in ('updated', 'stale');
exception
  -- The old API returned false for a missing or foreign SOS. Preserve that
  -- behaviour without disclosing whether a foreign row exists.
  when insufficient_privilege then
    get stacked diagnostics error_detail = pg_exception_detail;
    if error_detail = 'SOS_LOCATION_OWNER_SCOPE' then return false; end if;
    -- Unexpected SQL/EXECUTE privilege failures are errors, not inactive SOS.
    raise;
end;
$$;

revoke all on function public.update_my_active_sos_location(
  uuid, double precision, double precision, double precision, timestamptz
) from public, anon;
grant execute on function public.update_my_active_sos_location(
  uuid, double precision, double precision, double precision, timestamptz
) to authenticated;

commit;
