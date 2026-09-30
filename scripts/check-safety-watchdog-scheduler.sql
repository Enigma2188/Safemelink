-- ONE READ-ONLY QUERY. No job creation. Missing cron is handled without parsing cron.job.
with extension_info as (
  select a.default_version,a.installed_version from pg_catalog.pg_available_extensions a where a.name='pg_cron'
), checks as (
  select 1 as ord,'INFO' as result,'PostgreSQL version' as check_name,current_setting('server_version') as detail
  union all select 2,case when exists(select 1 from pg_catalog.pg_extension e where e.extname='pg_cron') then 'PASS' else 'WARN' end,
    'pg_cron installed version',coalesce((select e.extversion from pg_catalog.pg_extension e where e.extname='pg_cron'),'NOT INSTALLED')
  union all select 3,'INFO','pg_cron available default version',coalesce((select e.default_version from extension_info e),'NOT AVAILABLE')
  union all select 4,case when to_regnamespace('cron') is not null then 'PASS' else 'WARN' end,'cron schema',coalesce(to_regnamespace('cron')::text,'ABSENT')
  union all select 5,
    case when exists(select 1 from extension_info e where e.installed_version ~ '^([2-9][0-9]*\.|1\.([5-9]|[1-9][0-9]+)(\.|$))') then 'INFO' else 'WARN' end,
    'Seconds scheduling capability',
    case when exists(select 1 from extension_info e where e.installed_version ~ '^([2-9][0-9]*\.|1\.([5-9]|[1-9][0-9]+)(\.|$))')
      then 'Installed schema version >=1.5: upstream supports 1-59 second intervals. Binary/configuration and measured latency still require validation.'
      else 'Missing/older/unrecognized version: seconds support NOT established.' end
  union all select 6,case when to_regprocedure('cron.schedule(text,text,text)') is not null then 'PASS' else 'WARN' end,
    'Named scheduler signature',coalesce(to_regprocedure('cron.schedule(text,text,text)')::text,'ABSENT')
  union all select 7,'INFO','cron settings',coalesce((select jsonb_object_agg(s.name,s.setting)::text from pg_catalog.pg_settings s where s.name like 'cron.%'),'Not exposed to this role')
  union all select 8,
    case when to_regclass('cron.job') is not null and has_table_privilege(current_user,to_regclass('cron.job'),'SELECT') then 'INFO' else 'WARN' end,
    'Visible SafeMeLink jobs (metadata only)',
    case when to_regclass('cron.job') is not null and has_table_privilege(current_user,to_regclass('cron.job'),'SELECT') then
      pg_catalog.query_to_xml('select jobname,schedule,active from cron.job where jobname ilike ''%safemelink%'' order by jobname',true,false,'')::text
    else 'cron.job absent or SELECT unavailable; no dynamic query executed' end
  union all select 9,'WARN','Readiness','SCHEDULER CAPABILITY DA VERIFICARE — five-minute NETWORK cadence is insufficient for T1/T2.'
)
select result,check_name,detail from checks order by ord;
