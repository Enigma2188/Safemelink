-- PREPARED ONLY. No execution authorized by Phase 14.
-- Verify Development in Dashboard/Management API BEFORE running this file.
-- Expected project: lwkxufnbjrpsehdkfmgy
-- Expected host: db.lwkxufnbjrpsehdkfmgy.supabase.co
-- Neither current_database(), a GUC nor these expected strings prove identity.
begin transaction isolation level repeatable read read only;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, pg_temp;

with
relations as (
  select c.*, n.nspname from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' and (pg_catalog.left(c.relname::text,8)='network_'
    or c.relname in ('profiles','sos')))
    or (n.nspname='auth' and c.relname='users')
),
functions as (
  select p.*, n.nspname from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and ((n.nspname='public' and
    (p.proname like '%network%' or p.proname like '%sos%'))
    or (n.nspname='auth' and p.proname='uid'))
),
roles as (select oid,rolname,rolsuper,rolbypassrls,rolinherit from pg_catalog.pg_roles
  where rolname in ('postgres','anon','authenticated','service_role')),
triggers as (
  select t.*, c.nspname, c.relname, p.proname, pn.nspname as function_schema
  from pg_catalog.pg_trigger t join relations c on c.oid=t.tgrelid
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid=p.pronamespace
  where not t.tgisinternal
)
select pg_catalog.jsonb_build_object(
  'notice','READ_ONLY_METADATA_NOT_PROJECT_IDENTITY_PROOF',
  'expectedProjectRef','lwkxufnbjrpsehdkfmgy',
  'environment',pg_catalog.jsonb_build_object(
    'role',current_user,'sessionRole',session_user,
    'version',pg_catalog.current_setting('server_version'),
    'readOnly',pg_catalog.current_setting('transaction_read_only'),
    'isolation',pg_catalog.current_setting('transaction_isolation')),
  'extensions',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname),'[]'::jsonb)
    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace),
  'roles',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.rolname),'[]'::jsonb) from roles r),
  'schemaPrivileges',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',n.nspname,'owner',pg_catalog.pg_get_userbyid(n.nspowner),'role',r.rolname,
    'usage',pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE'),
    'create',pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE')) order by n.nspname,r.rolname),'[]'::jsonb)
    from pg_catalog.pg_namespace n cross join roles r where n.nspname in ('public','extensions')),
  'relations',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',c.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_catalog.pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text)
    order by c.nspname,c.relname),'[]'::jsonb) from relations c),
  'columns',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'column',a.attname,
    'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,'columnAcl',a.attacl::text,
    'defaultHash',pg_catalog.md5(pg_catalog.pg_get_expr(d.adbin,d.adrelid)))
    order by c.nspname,c.relname,a.attnum),'[]'::jsonb)
    from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid
    left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'name',k.conname,'type',k.contype,
    'validated',k.convalidated,'definitionHash',pg_catalog.md5(pg_catalog.pg_get_constraintdef(k.oid)))
    order by c.nspname,c.relname,k.conname),'[]'::jsonb)
    from pg_catalog.pg_constraint k join relations c on c.oid=k.conrelid),
  'indexes',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'name',i.relname,'valid',x.indisvalid,
    'ready',x.indisready,'definitionHash',pg_catalog.md5(pg_catalog.pg_get_indexdef(x.indexrelid)))
    order by c.nspname,c.relname,i.relname),'[]'::jsonb)
    from pg_catalog.pg_index x join relations c on c.oid=x.indrelid
    join pg_catalog.pg_class i on i.oid=x.indexrelid),
  'functions',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',p.nspname,'name',p.proname,
    'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
    'result',pg_catalog.pg_get_function_result(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),
    'securityDefiner',p.prosecdef,
    'searchPath',(select s from pg_catalog.unnest(p.proconfig) s where s like 'search_path=%' limit 1),
    'settingsHash',pg_catalog.md5(p.proconfig::text),'acl',p.proacl::text,
    'definitionHash',pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))) order by p.nspname,p.proname,p.oid),'[]'::jsonb)
    from functions p),
  'effectiveExecute',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'function',p.oid::regprocedure::text,'role',r.rolname,
    'execute',pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')) order by p.oid,r.rolname),'[]'::jsonb)
    from functions p cross join roles r),
  'effectiveTablePrivileges',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'role',r.rolname,
    'select',pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT'),
    'insert',pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT'),
    'update',pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE'),
    'delete',pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE')) order by c.nspname,c.relname,r.rolname),'[]'::jsonb)
    from relations c cross join roles r where c.relkind in ('r','p','v','m','f')),
  'policies',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,
    'permissive',p.polpermissive,'roles',p.polroles,
    'usingHash',pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual,p.polrelid)),
    'checkHash',pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))) order by c.relname,p.polname),'[]'::jsonb)
    from pg_catalog.pg_policy p join relations c on c.oid=p.polrelid),
  'triggers',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',t.nspname,'table',t.relname,'name',t.tgname,'enabled',t.tgenabled,
    'functionSchema',t.function_schema,'functionName',t.proname,
    'triggerHash',pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid)),
    'functionHash',pg_catalog.md5(pg_catalog.pg_get_functiondef(t.tgfoid))) order by t.nspname,t.relname,t.tgname),'[]'::jsonb)
    from triggers t),
  'dependencies',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'function',p.oid::regprocedure::text,'type',d.deptype,
    'referenceClass',d.refclassid::regclass::text,'referenceOid',d.refobjid,'referenceColumn',d.refobjsubid)
    order by p.oid,d.refclassid,d.refobjid,d.refobjsubid),'[]'::jsonb)
    from pg_catalog.pg_depend d join functions p on d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid),
  'migrationHistoryRelationPresent',pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null,
  'cronJobRelationPresent',pg_catalog.to_regclass('cron.job') is not null,
  'externalEffects','NOT_VERIFIED: inspect trigger bodies, Dashboard webhooks, deployed consumers and workers separately',
  'dependencyLimit','Catalog dependencies do not enumerate all SQL text references in PL/pgSQL; compare versioned sources too'
) as network_phase14_preflight;

rollback;
