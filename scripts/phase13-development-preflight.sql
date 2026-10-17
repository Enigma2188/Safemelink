-- READ ONLY. Run only after external Management API project/hostname verification:
-- Development lwkxufnbjrpsehdkfmgy. SQL alone cannot establish project identity.
begin read only;
select version() as database_version;
select n.nspname,p.proname,p.prokind,pg_get_function_identity_arguments(p.oid) as signature,
  pg_get_function_result(p.oid) as return_type,
  pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'update_my_active_sos_location','update_my_active_sos_location_result',
  'get_my_emergency_private_details','update_my_emergency_private_details',
  'delete_my_emergency_private_details','get_received_sos_private_details',
  'get_received_sos_emergency_profile','get_my_emergency_profile','update_my_emergency_profile');
select c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as auth_select,
  has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as auth_write,
  has_table_privilege('service_role',c.oid,'SELECT') as service_select
from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('sos','emergency_profiles','emergency_private_details');
select r.rolname,r.rolsuper,r.rolbypassrls from pg_catalog.pg_roles as r where r.rolname='postgres';
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_catalog.pg_policies where schemaname='public' and tablename in ('sos','emergency_profiles','emergency_private_details');
select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger as t join pg_catalog.pg_class as c on c.oid=t.tgrelid
join pg_catalog.pg_namespace as n on n.oid=c.relnamespace
where not t.tgisinternal and ((n.nspname='public' and c.relname in ('profiles','sos','trusted_contacts','emergency_private_details'))
  or (n.nspname='auth' and c.relname='users'));
select to_regclass('public.safemelink_phase13_fixture') as residual_fixture;
rollback;
