-- PHASE 16A-B / READ ONLY / MANUAL SQL EDITOR ONLY. Never run on Production.
-- BEFORE RUN: verify Dashboard project reference EXACTLY lwkxufnbjrpsehdkfmgy
-- and expected database host db.lwkxufnbjrpsehdkfmgy.supabase.co.
-- This script CANNOT prove project identity from SQL or the database name.
-- Run the ENTIRE file once, in the same SQL Editor connection, as postgres.
-- No application RPCs, fixtures, DDL, writes, cron changes or external transport.
-- query_to_xml below runs ONLY fixed SELECTs against optional metadata tables.
-- No function source, cron command, SQL query text or user records are returned.
-- Save the COMPLETE JSON report. MISSING/NOT_READABLE are NOT PASS.
-- Review the report before separately authorizing even the first migration.
-- On any error: stop; issue ROLLBACK if the editor retains the transaction.

begin isolation level read committed read only;

with
expected_migrations(version, file_name) as (values
  ('20261013120000','20261013120000_sos_live_location_monotonic.sql'),
  ('20261014120000','20261014120000_emergency_private_details.sql'),
  ('20261015120000','20261015120000_ice_composite_privacy.sql'),
  ('20261016120000','20261016120000_ice_persistent_revocation.sql')
),
expected_tables(schema_name,table_name,expected_stage) as (values
  ('auth','users','BASE_REQUIRED'),
  ('public','profiles','BASE_REQUIRED'),
  ('public','sos','BASE_REQUIRED'),
  ('public','trusted_contacts','BASE_REQUIRED'),
  ('public','emergency_profiles','BASE_REQUIRED'),
  ('public','emergency_private_details','CREATED_BY_PHASE12'),
  ('public','ice_privacy_control','CREATED_BY_PHASE15')
),
tables as (
  select e.*,c.oid,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
  from expected_tables as e
  left join pg_catalog.pg_namespace as n on n.nspname=e.schema_name
  left join pg_catalog.pg_class as c on c.relnamespace=n.oid and c.relname=e.table_name
),
expected_columns(schema_name,table_name,column_name,expected_stage) as (values
  ('auth','users','id','BASE_REQUIRED'),
  ('public','profiles','id','BASE_REQUIRED'),
  ('public','sos','id','BASE_REQUIRED'),('public','sos','user_id','BASE_REQUIRED'),
  ('public','sos','status','BASE_REQUIRED'),('public','sos','latitude','BASE_REQUIRED'),
  ('public','sos','longitude','BASE_REQUIRED'),('public','sos','accuracy','BASE_REQUIRED'),
  ('public','sos','location_updated_at','BASE_REQUIRED'),('public','sos','updated_at','BASE_REQUIRED'),
  ('public','sos','closed_at','TEST_DEPENDENCY'),
  ('public','trusted_contacts','user_id','BASE_REQUIRED'),
  ('public','trusted_contacts','linked_profile_id','BASE_REQUIRED'),
  ('public','trusted_contacts','name','TEST_DEPENDENCY'),
  ('public','trusted_contacts','phone','TEST_DEPENDENCY'),
  ('public','trusted_contacts','priority','TEST_DEPENDENCY'),
  ('public','emergency_profiles','user_id','BASE_REQUIRED'),
  ('public','emergency_profiles','declared_blood_group','BASE_REQUIRED'),
  ('public','emergency_profiles','severe_allergies','BASE_REQUIRED'),
  ('public','emergency_profiles','important_conditions','BASE_REQUIRED'),
  ('public','emergency_profiles','relevant_medications','BASE_REQUIRED'),
  ('public','emergency_profiles','lifesaving_medications','BASE_REQUIRED'),
  ('public','emergency_profiles','ice_contact','BASE_REQUIRED'),
  ('public','emergency_profiles','emergency_notes','BASE_REQUIRED'),
  ('public','emergency_profiles','share_medical_data_during_sos','BASE_REQUIRED'),
  ('public','emergency_profiles','share_ice_contact_during_sos','BASE_REQUIRED'),
  ('public','emergency_profiles','updated_at','BASE_REQUIRED'),
  ('public','emergency_private_details','user_id','PHASE12'),
  ('public','emergency_private_details','ice_name','PHASE12'),
  ('public','emergency_private_details','ice_relation','PHASE12'),
  ('public','emergency_private_details','ice_phone','PHASE12'),
  ('public','emergency_private_details','stalking','PHASE12'),
  ('public','emergency_private_details','domestic_violence','PHASE12'),
  ('public','emergency_private_details','other_risk','PHASE12'),
  ('public','emergency_private_details','instructions','PHASE12'),
  ('public','emergency_private_details','share_ice','PHASE12'),
  ('public','emergency_private_details','share_ice_phone','PHASE12'),
  ('public','emergency_private_details','share_safety','PHASE12'),
  ('public','emergency_private_details','updated_at','PHASE12'),
  ('public','ice_privacy_control','user_id','PHASE15'),
  ('public','ice_privacy_control','blocked','PHASE15'),
  ('public','ice_privacy_control','legacy_allowed','PHASE15'),
  ('public','ice_privacy_control','structured_allowed','PHASE15'),
  ('public','ice_privacy_control','phone_allowed','PHASE15'),
  ('public','ice_privacy_control','revision','PHASE15'),
  ('public','ice_privacy_control','consent_version','PHASE15'),
  ('public','ice_privacy_control','changed_at','PHASE15')
),
expected_functions(signature,expected_return,expected_stage) as (values
  ('auth.uid()','uuid','BASE_REQUIRED'),
  ('public.update_my_active_sos_location(uuid,double precision,double precision,double precision,timestamp with time zone)','boolean','BASE_REQUIRED_REPLACED_PHASE8'),
  ('public.update_my_active_sos_location_result(uuid,double precision,double precision,double precision,timestamp with time zone)','text','PHASE8'),
  ('public.get_my_emergency_profile()',null,'BASE_REQUIRED'),
  ('public.update_my_emergency_profile(text,text,text,text,text,text,text,boolean,boolean)',null,'BASE_REQUIRED'),
  ('public.get_received_sos_emergency_profile(uuid)',null,'BASE_REQUIRED'),
  ('public.get_my_emergency_private_details(uuid)','jsonb','PHASE12'),
  ('public.update_my_emergency_private_details(uuid,text,text,text,text,text,text,text,boolean,boolean,boolean)','jsonb','PHASE12'),
  ('public.delete_my_emergency_private_details(uuid)','void','PHASE12'),
  ('public.get_received_sos_private_details(uuid)','jsonb','PHASE12'),
  ('public.get_my_ice_privacy_status(uuid)','jsonb','PHASE14'),
  ('public.revoke_my_all_ice_sharing(uuid)','jsonb','PHASE14'),
  ('public.confirm_my_ice_sharing(uuid,bigint,text,boolean,boolean,boolean)','jsonb','PHASE15')
),
function_names as (
  select split_part(split_part(e.signature,'(',1),'.',1) as schema_name,
    split_part(split_part(e.signature,'(',1),'.',2) as function_name
  from expected_functions as e
),
functions as (
  select n.nspname,p.* from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid=p.pronamespace
  where exists(select 1 from function_names as f where f.schema_name=n.nspname and f.function_name=p.proname)
    or (n.nspname='public' and p.proname like '\_ice15\_%' escape '\')
),
roles as (
  select r.* from pg_catalog.pg_roles as r
  where r.rolname in ('postgres','anon','authenticated','service_role',current_user,session_user)
),
optional_relations(label,relation_name) as (values
  ('migration_history','supabase_migrations.schema_migrations'),
  ('cron_jobs','cron.job')
),
optional_catalogs as (
  select o.*,pg_catalog.to_regclass(o.relation_name) as oid from optional_relations as o
),
optional_readability as (
  select o.*,
    case when o.oid is null then false else pg_catalog.has_table_privilege(current_user,o.oid,'SELECT') end as readable,
    pg_catalog.has_function_privilege(current_user,'pg_catalog.query_to_xml(text,boolean,boolean,text)','EXECUTE') as xml_available
  from optional_catalogs as o
),
metadata_report as (
  select jsonb_build_object(
    '01_environment',jsonb_build_object(
      'expected_project_ref','lwkxufnbjrpsehdkfmgy',
      'expected_host','db.lwkxufnbjrpsehdkfmgy.supabase.co',
      'project_identity','NOT_PROVEN_BY_SQL_VERIFY_DASHBOARD_BEFORE_RUN',
      'postgres_version',version(),'server_version_num',current_setting('server_version_num'),
      'database_name_not_identity',current_database(),'current_role',current_user,'session_role',session_user,
      'transaction_read_only',current_setting('transaction_read_only'),
      'transaction_isolation',current_setting('transaction_isolation'),
      'external_worker_status','NOT_VERIFIABLE_FROM_DATABASE_METADATA'),
    '02_migration_application_order',(select jsonb_agg(to_jsonb(e) order by e.version) from expected_migrations as e),
    '03_migration_history',(
      select case
        when o.oid is null then jsonb_build_object('status','MISSING')
        when not o.readable or not o.xml_available then jsonb_build_object('status','NOT_READABLE')
        when (select c.relkind from pg_catalog.pg_class as c where c.oid=o.oid) not in ('r','p')
          then jsonb_build_object('status','UNEXPECTED_CATALOG_KIND')
        when not exists(select 1 from pg_catalog.pg_attribute as a where a.attrelid=o.oid and a.attname='version' and a.attnum>0 and not a.attisdropped)
          then jsonb_build_object('status','UNEXPECTED_CATALOG_SHAPE')
        else jsonb_build_object('status','READABLE','versions_xml',
          pg_catalog.query_to_xml('select version::text as version from supabase_migrations.schema_migrations order by version',true,false,'')::text,
          'note','Only migration versions; SQL Editor applications may not be registered. Compare object catalogs too.') end
      from optional_readability as o where o.label='migration_history'),
    '04_schemas',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),
      'anon_create',case when to_regrole('anon') is null then null else has_schema_privilege('anon',n.oid,'CREATE') end,
      'authenticated_create',case when to_regrole('authenticated') is null then null else has_schema_privilege('authenticated',n.oid,'CREATE') end))
      from pg_catalog.pg_namespace as n where n.nspname in ('public','auth','cron','supabase_migrations')),
    '05_extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)),'[]'::jsonb)
      from pg_catalog.pg_extension as e join pg_catalog.pg_namespace as n on n.oid=e.extnamespace),
    '06_roles',(select jsonb_agg(jsonb_build_object('role',r.rolname,'superuser',r.rolsuper,
      'bypass_rls',r.rolbypassrls,'inherit',r.rolinherit,'can_login',r.rolcanlogin)) from roles as r),
    '07_role_memberships',(select coalesce(jsonb_agg(jsonb_build_object('member',member.rolname,'granted_role',parent.rolname)),'[]'::jsonb)
      from pg_catalog.pg_auth_members as m join pg_catalog.pg_roles as member on member.oid=m.member
      join pg_catalog.pg_roles as parent on parent.oid=m.roleid
      where m.member in (select r.oid from roles as r) or m.roleid in (select r.oid from roles as r)),
    '08_tables',(select jsonb_agg(jsonb_build_object('schema',t.schema_name,'table',t.table_name,
      'stage',t.expected_stage,'exists',t.oid is not null,'kind',t.relkind,'owner',pg_get_userbyid(t.relowner),
      'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity) order by t.schema_name,t.table_name) from tables as t),
    '09_expected_columns',(select jsonb_agg(jsonb_build_object('schema',e.schema_name,'table',e.table_name,
      'column',e.column_name,'stage',e.expected_stage,'exists',a.attnum is not null,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'default_boolean',case when a.atttypid='boolean'::regtype then pg_get_expr(d.adbin,d.adrelid) else null end,
      'other_default_present',d.oid is not null and a.atttypid<>'boolean'::regtype)
      order by e.schema_name,e.table_name,e.column_name)
      from expected_columns as e join tables as t on t.schema_name=e.schema_name and t.table_name=e.table_name
      left join pg_catalog.pg_attribute as a on a.attrelid=t.oid and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
      left join pg_catalog.pg_attrdef as d on d.adrelid=t.oid and d.adnum=a.attnum),
    '10_all_column_names',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schema_name,'table',t.table_name,
      'column',a.attname,'type',format_type(a.atttypid,a.atttypmod)) order by t.schema_name,t.table_name,a.attnum),'[]'::jsonb)
      from tables as t join pg_catalog.pg_attribute as a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
    '11_constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',t.schema_name||'.'||t.table_name,
      'name',c.conname,'kind',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid))),'[]'::jsonb)
      from tables as t join pg_catalog.pg_constraint as c on c.conrelid=t.oid),
    '12_indexes',(select coalesce(jsonb_agg(jsonb_build_object('table',t.schema_name||'.'||t.table_name,
      'name',ic.relname,'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,'definition',pg_get_indexdef(i.indexrelid))),'[]'::jsonb)
      from tables as t join pg_catalog.pg_index as i on i.indrelid=t.oid join pg_catalog.pg_class as ic on ic.oid=i.indexrelid),
    '13_expected_rpc_signatures',(select jsonb_agg(jsonb_build_object('signature',e.signature,'stage',e.expected_stage,
      'exists',to_regprocedure(e.signature) is not null,'expected_return',e.expected_return,
      'actual_return',pg_get_function_result(to_regprocedure(e.signature))) order by e.signature) from expected_functions as e),
    '14_rpc_catalog',(select coalesce(jsonb_agg(jsonb_build_object('schema',p.nspname,'name',p.proname,
      'identity_arguments',pg_get_function_identity_arguments(p.oid),'argument_defaults_count',p.pronargdefaults,
      'argument_names',p.proargnames,'return_type',pg_get_function_result(p.oid),'kind',p.prokind,
      'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,
      'search_path',(select v from unnest(p.proconfig) as config(v) where v like 'search_path=%'),
      'source_md5',md5(p.prosrc),'has_auth_uid_reference',p.prosrc ~* 'auth[.]uid',
      'same_name_overloads',(select count(*) from functions as q where q.nspname=p.nspname and q.proname=p.proname))
      order by p.nspname,p.proname,p.oid),'[]'::jsonb) from functions as p),
    '15_rpc_effective_execute',(select coalesce(jsonb_agg(jsonb_build_object('function',p.oid::regprocedure::text,
      'role',r.rolname,'execute',has_function_privilege(r.oid,p.oid,'EXECUTE')) order by p.oid,r.rolname),'[]'::jsonb)
      from functions as p cross join roles as r),
    '16_rpc_acl',(select coalesce(jsonb_agg(jsonb_build_object('function',p.oid::regprocedure::text,
      'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]'::jsonb)
      from functions as p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) as a),
    '17_table_effective_privileges',(select coalesce(jsonb_agg(jsonb_build_object('table',t.schema_name||'.'||t.table_name,
      'role',r.rolname,'select',has_table_privilege(r.oid,t.oid,'SELECT'),'insert',has_table_privilege(r.oid,t.oid,'INSERT'),
      'update',has_table_privilege(r.oid,t.oid,'UPDATE'),'delete',has_table_privilege(r.oid,t.oid,'DELETE'),
      'truncate',has_table_privilege(r.oid,t.oid,'TRUNCATE'))),'[]'::jsonb)
      from tables as t cross join roles as r where t.oid is not null),
    '18_column_acl',(select coalesce(jsonb_agg(jsonb_build_object('table',t.schema_name||'.'||t.table_name,
      'column',c.attname,'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'privilege',a.privilege_type)),'[]'::jsonb)
      from tables as t join pg_catalog.pg_attribute as c on c.attrelid=t.oid and c.attnum>0 and not c.attisdropped
      cross join lateral aclexplode(c.attacl) as a),
    '19_policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from pg_catalog.pg_policies as p
      where exists(select 1 from tables as t where t.schema_name=p.schemaname and t.table_name=p.tablename)),
    '20_triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.schema_name||'.'||t.table_name,
      'trigger',g.tgname,'enabled',g.tgenabled,'internal',g.tgisinternal,'event_bits',g.tgtype,
      'function',p.oid::regprocedure::text,'function_owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
      'function_source_md5',md5(p.prosrc),'http_or_delivery_reference',p.prosrc ~* '(http|net[.]|push|sms|dispatch|delivery)',
      'note','Function body and trigger arguments deliberately omitted; inspect flagged triggers separately.')),'[]'::jsonb)
      from tables as t join pg_catalog.pg_trigger as g on g.tgrelid=t.oid join pg_catalog.pg_proc as p on p.oid=g.tgfoid),
    '21_dependencies_on_rpc',(select coalesce(jsonb_agg(jsonb_build_object('referenced_rpc',p.oid::regprocedure::text,
      'dependent',pg_describe_object(d.classid,d.objid,d.objsubid),'dependent_catalog',d.classid::regclass::text,'type',d.deptype)),'[]'::jsonb)
      from functions as p join pg_catalog.pg_depend as d on d.refclassid='pg_proc'::regclass and d.refobjid=p.oid),
    '22_table_dependencies',(select coalesce(jsonb_agg(jsonb_build_object('referenced_table',t.schema_name||'.'||t.table_name,
      'dependent',pg_describe_object(d.classid,d.objid,d.objsubid),'type',d.deptype)),'[]'::jsonb)
      from tables as t join pg_catalog.pg_depend as d on d.refclassid='pg_class'::regclass and d.refobjid=t.oid),
    '23_cron_metadata',(
      select case when o.oid is null then jsonb_build_object('status','MISSING')
        when not o.readable or not o.xml_available then jsonb_build_object('status','NOT_READABLE')
        when (select c.relkind from pg_catalog.pg_class as c where c.oid=o.oid) not in ('r','p')
          then jsonb_build_object('status','UNEXPECTED_CATALOG_KIND')
        when (select count(*) from pg_catalog.pg_attribute as a where a.attrelid=o.oid and a.attname in ('jobid','schedule','active','command') and a.attnum>0 and not a.attisdropped)<>4
          then jsonb_build_object('status','UNEXPECTED_CATALOG_SHAPE')
        else jsonb_build_object('status','READABLE','jobs_xml',pg_catalog.query_to_xml(
          'select jobid,schedule,active,command ~* ''(watchdog|safety|consumer)'' as safety_reference,command ~* ''(http|net[.]|dispatch|delivery)'' as transport_reference from cron.job order by jobid',
          true,false,'')::text,'note','No commands or secrets printed. No rows visible does not prove no jobs under RLS.') end
      from optional_readability as o where o.label='cron_jobs'),
    '24_other_possible_writers_readers',(select coalesce(jsonb_agg(jsonb_build_object('function',p.oid::regprocedure::text,
      'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'source_md5',md5(p.prosrc))),'[]'::jsonb)
      from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosrc ~* '(emergency_profiles|emergency_private_details|ice_privacy_control)'
        and not exists(select 1 from functions as f where f.oid=p.oid)),
    '25_active_transactions',(select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'role',a.usename,
      'state',a.state,'transaction_started',a.xact_start,'wait_type',a.wait_event_type,'wait_event',a.wait_event)),'[]'::jsonb)
      from pg_catalog.pg_stat_activity as a where a.datname=current_database() and a.pid<>pg_backend_pid()
        and (a.xact_start is not null or a.state is distinct from 'idle')),
    '26_relation_locks',(select coalesce(jsonb_agg(jsonb_build_object('table',t.schema_name||'.'||t.table_name,
      'pid',l.pid,'mode',l.mode,'granted',l.granted)),'[]'::jsonb)
      from tables as t join pg_catalog.pg_locks as l on l.relation=t.oid where l.pid is distinct from pg_backend_pid()),
    '27_fixture_object_presence',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind)),'[]'::jsonb)
      from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid=c.relnamespace where n.nspname='public'
        and (c.relname like '%phase13%fixture%' or c.relname like '%ice15%fixture%' or c.relname like '%safety%test%fixture%')),
    '28_limits',jsonb_build_array(
      'No user table contents or fixture rows inspected; no claim that test/user records are absent.',
      'Catalogs cannot prove no external host worker or in-flight network request. Check hosts separately.',
      'pg_depend does not capture every PL/pgSQL/dynamic-SQL dependency; review flagged functions and deployment drift.',
      'Metadata and hashes do not prove runtime authorization, lock ordering, concurrency or compatibility.',
      'Missing Phase12/14/15 objects can be expected before installation; unexpected existing CREATE-only objects require review.',
      'Legacy ICE ON saves will be rejected after persistent revocation; explicit updated consent is required to reenable.',
      'Read requests already in flight may carry an earlier snapshot. Drain requests/plans before Phase15 deployment.',
      'NO automatic GO. Return the entire report and any error for review before applying any migration.')
  ) as report
)
select jsonb_pretty(r.report) as phase16_read_only_report from metadata_report as r;

rollback;
