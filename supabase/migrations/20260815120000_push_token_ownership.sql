begin;

create or replace function public.claim_my_device_push_token(
  target_expo_push_token text,
  target_platform text,
  target_device_name text default null
)
returns table (
  id uuid,
  user_id uuid,
  active boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if target_expo_push_token is null
     or target_expo_push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Invalid Expo push token.' using errcode = '22023';
  end if;

  if target_platform is null or target_platform not in ('android', 'ios') then
    raise exception 'Invalid push platform.' using errcode = '22023';
  end if;

  delete from public.device_push_tokens tokens
  where tokens.expo_push_token = target_expo_push_token
    and tokens.user_id <> current_user_id;

  return query
  insert into public.device_push_tokens (
    user_id,
    expo_push_token,
    platform,
    device_name,
    active,
    updated_at
  ) values (
    current_user_id,
    target_expo_push_token,
    target_platform,
    nullif(trim(target_device_name), ''),
    true,
    now()
  )
  on conflict (expo_push_token) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      device_name = excluded.device_name,
      active = true,
      updated_at = now()
  returning
    device_push_tokens.id,
    device_push_tokens.user_id,
    device_push_tokens.active,
    device_push_tokens.updated_at;
end;
$$;

revoke all on function public.claim_my_device_push_token(text, text, text) from public;
grant execute on function public.claim_my_device_push_token(text, text, text) to authenticated;

commit;
