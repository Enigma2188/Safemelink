-- Phase16C: ONLY residual metadata, manual SQL Editor, NOT EXECUTED.
-- FIRST verify Dashboard project ref lwkxufnbjrpsehdkfmgy and host
-- db.lwkxufnbjrpsehdkfmgy.supabase.co. SQL does not establish project identity.
-- Run this WHOLE file in one connection as postgres. Save the complete JSON.
-- No application RPC is invoked. No user rows, function bodies, cron commands
-- or arguments that might contain secrets are output. No DDL/DML/fixtures.
-- Already verified by supplied report: GPS signature/body/owner/ACL;
-- anon/authenticated CREATE on public = false; medical RPC and trigger hashes.
-- These satisfied checks are deliberately NOT queried again.
-- Expected function-body hashes below are LF-normalized prosrc, NOT file hashes.
-- MISMATCH means further review, not proof of a vulnerability.
begin isolation level read committed read only;

with expected(signature,body_lf_md5,expected_return,source_file) as (values
  ('public.close_my_sos(uuid)','f27fcaab6e86b23199f747bc42f0d083',
   'TABLE(sos_id uuid, sos_status sos_status, is_owner boolean, accepted_by_me boolean, sos_updated_at timestamp with time zone, sos_closed_at timestamp with time zone)',
   '20260724120000_sos_lifecycle_hardening.sql'),
  ('public.expire_network_reports()','af7e306ee9a6e766c99be4cd11ba5630','integer',
   '20260907120000_network_backend_phase1.sql')
), functions as (
  select e.*,p.oid,p.proname,p.pronamespace,p.proowner,p.prosecdef,p.provolatile,
    p.proargnames,p.proacl,p.proconfig,p.prosrc,p.prokind
  from expected as e left join pg_catalog.pg_proc as p on p.oid=pg_catalog.to_regprocedure(e.signature)
), cron_relation as (
  select pg_catalog.to_regclass('cron.job') as oid
)
select jsonb_pretty(jsonb_build_object(
  'expected_project_ref','lwkxufnbjrpsehdkfmgy',
  'identity','VERIFY_MANUALLY_IN_DASHBOARD_NOT_PROVEN_BY_SQL',
  'read_only',current_setting('transaction_read_only'),
  'residual_functions',(
    select jsonb_agg(jsonb_build_object(
      'signature',f.signature,'exists',f.oid is not null,'reference_file',f.source_file,
      'kind',f.prokind,'owner',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,
      'volatility',f.provolatile,'arguments',pg_get_function_identity_arguments(f.oid),
      'argument_names',f.proargnames,'return_type',pg_get_function_result(f.oid),
      'expected_return',f.expected_return,
      'search_path',(select v from unnest(f.proconfig) as config(v) where v like 'search_path=%'),
      'same_name_count',(select count(*) from pg_catalog.pg_proc as p where p.pronamespace=f.pronamespace and p.proname=f.proname),
      'body_match',case when f.oid is null then 'MISSING'
        when md5(replace(f.prosrc,chr(13)||chr(10),chr(10)))=f.body_lf_md5 then 'MATCH' else 'MISMATCH' end,
      'anon_execute',case when to_regrole('anon') is null or f.oid is null then null else has_function_privilege('anon',f.oid,'EXECUTE') end,
      'authenticated_execute',case when to_regrole('authenticated') is null or f.oid is null then null else has_function_privilege('authenticated',f.oid,'EXECUTE') end,
      'acl',(select coalesce(jsonb_agg(jsonb_build_object(
        'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]'::jsonb)
        from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) as a)
    ) order by f.signature) from functions as f
  ),
  'cron_job_1_identity',(
    select case
      when c.oid is null then jsonb_build_object('status','MISSING')
      when not has_table_privilege(current_user,c.oid,'SELECT')
        or not has_function_privilege(current_user,'pg_catalog.query_to_xml(text,boolean,boolean,text)','EXECUTE')
        then jsonb_build_object('status','NOT_READABLE')
      when (select r.relkind from pg_catalog.pg_class as r where r.oid=c.oid) not in ('r','p')
        then jsonb_build_object('status','UNEXPECTED_CATALOG_KIND')
      when (select count(*) from pg_catalog.pg_attribute as a where a.attrelid=c.oid
        and a.attname in ('jobid','jobname','command','database','username') and a.attnum>0 and not a.attisdropped)<>5
        then jsonb_build_object('status','UNEXPECTED_CATALOG_SHAPE')
      else jsonb_build_object('status','READABLE','identity_xml',pg_catalog.query_to_xml(
        'select jobid,jobname = ''safemelink-expire-network-reports'' as name_matches_expected,lower(regexp_replace(command,''[[:space:]]'','''',''g'')) in (''selectpublic.expire_network_reports();'',''selectpublic.expire_network_reports()'') as command_matches_known_call,database = current_database() as same_database,username = ''postgres'' as runs_as_postgres from cron.job where jobid=1',
        true,false,'')::text,
        'interpretation','Require exactly one row and all booleans true, plus MATCH for expire_network_reports body. Empty/NULL/false is NOT PASS.')
      end from cron_relation as c
  ),
  'external_checks_still_required',jsonb_build_array(
    'Inventory actual deployed hosts/Edge Functions/polling consumers and their configuration. Metadata cannot prove no worker.',
    'Ensure synthetic SOS cannot trigger delivery, push, SMS or external transport, especially for committed concurrency fixtures.',
    'Do not stop unrelated NETWORK cron solely because it is active; first establish identity and implementation.',
    'This report authorizes no migration, grant changes, worker activation or fixture execution.')
)) as phase16c_residual_report;

rollback;
