begin;

-- Fail before DDL if the fixed definer cannot work with FORCE RLS.
do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles as r
    where r.rolname='postgres' and (r.rolsuper or r.rolbypassrls)) then
    raise exception 'Required protected definer role unavailable';
  end if;
end $$;

-- Additive: legacy emergency_profiles and all existing RPC signatures stay intact.
create table public.emergency_private_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ice_name text check (ice_name is null or char_length(ice_name) between 1 and 100),
  ice_relation text check (ice_relation is null or char_length(ice_relation) between 1 and 100),
  ice_phone text check (ice_phone is null or ice_phone ~ '^\+[1-9][0-9]{6,14}$'),
  stalking text check (stalking is null or char_length(stalking) between 1 and 1000),
  domestic_violence text check (domestic_violence is null or char_length(domestic_violence) between 1 and 1000),
  other_risk text check (other_risk is null or char_length(other_risk) between 1 and 1000),
  instructions text check (instructions is null or char_length(instructions) between 1 and 2000),
  share_ice boolean not null default false,
  share_ice_phone boolean not null default false,
  share_safety boolean not null default false,
  updated_at timestamptz not null default now(),
  check (not share_ice or ice_name is not null),
  check (not share_ice_phone or (share_ice and ice_phone is not null)),
  check (not share_safety or coalesce(stalking,domestic_violence,other_risk,instructions) is not null)
);
alter table public.emergency_private_details enable row level security;
alter table public.emergency_private_details force row level security;
alter table public.emergency_private_details owner to postgres;
revoke all on table public.emergency_private_details from public,anon,authenticated,service_role;
comment on table public.emergency_private_details is
  'Optional user declarations. Separate explicit ICE/phone/safety consent. No community exposure.';

create function public.get_my_emergency_private_details(expected_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor_id uuid := auth.uid(); result_value jsonb;
begin
  if actor_id is null or actor_id is distinct from expected_owner_id then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select to_jsonb(d) into result_value from public.emergency_private_details as d where d.user_id=actor_id;
  return result_value; -- A missing private record does not enable any consent.
end;
$$;

create function public.update_my_emergency_private_details(
  expected_owner_id uuid, next_ice_name text, next_ice_relation text, next_ice_phone text,
  next_stalking text, next_domestic_violence text, next_other_risk text, next_instructions text,
  next_share_ice boolean, next_share_ice_phone boolean, next_share_safety boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor_id uuid := auth.uid(); result_value jsonb;
begin
  if actor_id is null or actor_id is distinct from expected_owner_id then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  insert into public.emergency_private_details as d (
    user_id,ice_name,ice_relation,ice_phone,stalking,domestic_violence,other_risk,instructions,
    share_ice,share_ice_phone,share_safety,updated_at
  ) values (
    actor_id,nullif(btrim(next_ice_name),''),nullif(btrim(next_ice_relation),''),nullif(btrim(next_ice_phone),''),
    nullif(btrim(next_stalking),''),nullif(btrim(next_domestic_violence),''),nullif(btrim(next_other_risk),''),
    nullif(btrim(next_instructions),''),next_share_ice,next_share_ice_phone,next_share_safety,now()
  ) on conflict (user_id) do update set
    ice_name=excluded.ice_name,ice_relation=excluded.ice_relation,ice_phone=excluded.ice_phone,
    stalking=excluded.stalking,domestic_violence=excluded.domestic_violence,other_risk=excluded.other_risk,
    instructions=excluded.instructions,share_ice=excluded.share_ice,share_ice_phone=excluded.share_ice_phone,
    share_safety=excluded.share_safety,updated_at=excluded.updated_at
  returning to_jsonb(d) into result_value;
  return result_value;
end;
$$;

create function public.delete_my_emergency_private_details(expected_owner_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or actor_id is distinct from expected_owner_id then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  delete from public.emergency_private_details as d where d.user_id=actor_id;
end;
$$;

create function public.get_received_sos_private_details(target_sos_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'sos_id',s.id,'declared_by_user',true,
    'share_ice',d.share_ice,'share_ice_phone',d.share_ice_phone,'share_safety',d.share_safety,
    'ice_name',case when d.share_ice then d.ice_name end,
    'ice_relation',case when d.share_ice then d.ice_relation end,
    'ice_phone',case when d.share_ice and d.share_ice_phone then d.ice_phone end,
    'stalking',case when d.share_safety then d.stalking end,
    'domestic_violence',case when d.share_safety then d.domestic_violence end,
    'other_risk',case when d.share_safety then d.other_risk end,
    'instructions',case when d.share_safety then d.instructions end
  ) from public.sos as s join public.emergency_private_details as d on d.user_id=s.user_id
  where s.id=target_sos_id and s.status in ('open','accepted') and auth.uid() is not null
    and exists (select 1 from public.trusted_contacts as tc
      where tc.user_id=s.user_id and tc.linked_profile_id=auth.uid())
    and (d.share_ice or d.share_safety);
$$;

alter function public.get_my_emergency_private_details(uuid) owner to postgres;
alter function public.update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) owner to postgres;
alter function public.delete_my_emergency_private_details(uuid) owner to postgres;
alter function public.get_received_sos_private_details(uuid) owner to postgres;
revoke all on function public.get_my_emergency_private_details(uuid) from public,anon,authenticated,service_role;
revoke all on function public.update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.delete_my_emergency_private_details(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_received_sos_private_details(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_emergency_private_details(uuid) to authenticated;
grant execute on function public.update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean) to authenticated;
grant execute on function public.delete_my_emergency_private_details(uuid) to authenticated;
grant execute on function public.get_received_sos_private_details(uuid) to authenticated;
commit;
