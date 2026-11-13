-- PREPARED ONLY. One targeted READ ONLY query; no application data or raw function bodies.
-- Expected Development lwkxufnbjrpsehdkfmgy; verify Dashboard identity separately.
-- Reference candidate 17.6.1.166, NOT a verified target build.
begin transaction isolation level repeatable read read only;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='2s';
set local statement_timeout='15s';
with expected(name,source_hash) as (values ('issue_graphql_placeholder','19e858a99cf5698c4730343fb43cdad4ab2f0717a8ded8a691a0e2786b859708'),
('issue_pg_cron_access','00db212b76cecd4b0794b2f20c414ab4988d675959747cd12d3eb4c6d6736f38'),
('issue_pg_graphql_access','fb5a80e6d30734718db960270a5f0eac0d655e238e8128ba56803b74a052bc1e'),
('issue_pg_net_access','55abda380efd46b37b26d3c6e4f3b514e28b7c7c1df44f5ae0315ece4052370d'),
('pgrst_ddl_watch','de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0'),
('pgrst_drop_watch','791b41f0632fc86e0fc86a303ec0fd710c4e2ecf947a23422dae2b7a2c122f1d')),
actual as (
 select e.evtname, jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled::text,
 'tags',to_jsonb(e.evttags),'owner',pg_get_userbyid(e.evtowner),
 'functionSchema',n.nspname,'functionName',p.proname,'arguments',pg_get_function_identity_arguments(p.oid)) as trigger_metadata,
 jsonb_build_object('schema',n.nspname,'name',p.proname,
 'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile::text,'strict',p.proisstrict,'leakproof',p.proleakproof,
 'parallel',p.proparallel::text,'returnsSet',p.proretset,'acl',p.proacl::text,
 'configHash',encode(sha256(convert_to((coalesce(p.proconfig::text,'<NULL>'))::text,'UTF8')),'hex'),
 'searchPath',(select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1)) as function_metadata, encode(sha256(convert_to((p.prosrc)::text,'UTF8')),'hex') as source_sha256,
 encode(sha256(convert_to((pg_get_functiondef(p.oid))::text,'UTF8')),'hex') as definition_sha256,encode(sha256(convert_to((jsonb_build_object('schema',n.nspname,'name',p.proname,
 'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile::text,'strict',p.proisstrict,'leakproof',p.proleakproof,
 'parallel',p.proparallel::text,'returnsSet',p.proretset,'acl',p.proacl::text,
 'configHash',encode(sha256(convert_to((coalesce(p.proconfig::text,'<NULL>'))::text,'UTF8')),'hex'),
 'searchPath',(select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1)))::text,'UTF8')),'hex') as function_metadata_sha256,
 encode(sha256(convert_to((jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled::text,
 'tags',to_jsonb(e.evttags),'owner',pg_get_userbyid(e.evtowner),
 'functionSchema',n.nspname,'functionName',p.proname,'arguments',pg_get_function_identity_arguments(p.oid)))::text,'UTF8')),'hex') as trigger_metadata_sha256
 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
 join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
)
select jsonb_build_object('notice','EVIDENCE_ONLY_NOT_AN_APPROVAL_OR_PROJECT_IDENTITY_PROOF',
 'version',current_setting('server_version'),'readOnly',current_setting('transaction_read_only'),
 'referenceVersion','17.6.1.166','actualCount',(select count(*) from actual),
 'missingExpected',coalesce((select jsonb_agg(x.name order by x.name) from expected x
   where not exists(select 1 from actual a where a.evtname=x.name)),'[]'::jsonb),
 'eventTriggers',coalesce((select jsonb_agg(jsonb_build_object('name',a.evtname,
   'expectedName',x.name is not null,'triggerMetadata',a.trigger_metadata,'functionMetadata',a.function_metadata,
   'sourceSha256',a.source_sha256,'definitionSha256',a.definition_sha256,
   'functionMetadataSha256',a.function_metadata_sha256,'triggerMetadataSha256',a.trigger_metadata_sha256,
   'sourceMatchesReference',coalesce(a.source_sha256=x.source_hash,false)) order by a.evtname)
   from actual a left join expected x on x.name=a.evtname),'[]'::jsonb)) as phase17c_evidence;
rollback;
