-- MUTATING / dedicated fixture. COMMIT required to share an existing SOS.
-- Default BLOCKED. External Development identity/host-worker checks required.
begin;
do $$ declare verified_ref text := null; workers_stopped boolean := false;
begin
  if verified_ref is distinct from 'lwkxufnbjrpsehdkfmgy' or workers_stopped is distinct from true then
    raise exception 'BLOCKED: Development identity and inactive workers must be verified externally';
  end if;
  if to_regclass('public.safemelink_phase13_fixture') is not null then raise exception 'Existing fixture: inspect, do not overwrite'; end if;
end $$;
create table public.safemelink_phase13_fixture (
  owner_id uuid primary key,sos_id uuid unique not null,base_time timestamptz not null,
  scenario text not null check(scenario in ('newer_first','older_first','closure_first','gps_first','a_rollback')),
  b_result text,contention_verified boolean not null default false
);
revoke all on public.safemelink_phase13_fixture from public,anon,authenticated,service_role;
-- Change ONLY scenario for each fresh setup.
insert into public.safemelink_phase13_fixture values(gen_random_uuid(),gen_random_uuid(),clock_timestamp()-interval '1 minute','newer_first',null,false);
insert into auth.users(id,email) select f.owner_id,'phase13-concurrency-'||f.owner_id::text||'@example.invalid' from public.safemelink_phase13_fixture as f;
insert into public.profiles(id) select f.owner_id from public.safemelink_phase13_fixture as f on conflict(id) do nothing;
insert into public.sos(id,user_id,latitude,longitude,accuracy,location_updated_at)
select f.sos_id,f.owner_id,1,2,10,f.base_time from public.safemelink_phase13_fixture as f;
commit;
