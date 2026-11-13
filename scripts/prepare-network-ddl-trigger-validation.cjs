'use strict';
// No database executor, authentication, network client or file writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {buildDdlValidation}=require('./prepare-network-ddl-validation.cjs');
const {topLevel}=require('./prepare-network-v2-local-validation.cjs');
const root=path.resolve(__dirname,'..');
const manifestPath=path.join(root,'scripts/phase17c-event-trigger-approval.json');
const q=x=>x===null?'null::text':"'"+x.replaceAll("'","''")+"'";
const sha=expression=>`encode(sha256(convert_to((${expression})::text,'UTF8')),'hex')`;
const sourceHash=sha('p.prosrc');
const definitionHash=sha('pg_get_functiondef(p.oid)');
const functionMetadata=`jsonb_build_object('schema',n.nspname,'name',p.proname,
 'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile::text,'strict',p.proisstrict,'leakproof',p.proleakproof,
 'parallel',p.proparallel::text,'returnsSet',p.proretset,'acl',p.proacl::text,
 'configHash',${sha("coalesce(p.proconfig::text,'<NULL>')")},
 'searchPath',(select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1))`;
const triggerMetadata=`jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled::text,
 'tags',to_jsonb(e.evttags),'owner',pg_get_userbyid(e.evtowner),
 'functionSchema',n.nspname,'functionName',p.proname,'arguments',pg_get_function_identity_arguments(p.oid))`;
const functionMetadataHash=sha(functionMetadata),triggerMetadataHash=sha(triggerMetadata);
const expectedNames=['issue_graphql_placeholder','issue_pg_cron_access','issue_pg_graphql_access','issue_pg_net_access','pgrst_ddl_watch','pgrst_drop_watch'];
// Pinned candidate source bodies: never replace these with first-observed database hashes.
const officialSources={
 set_graphql_placeholder:'19e858a99cf5698c4730343fb43cdad4ab2f0717a8ded8a691a0e2786b859708',
 grant_pg_cron_access:'00db212b76cecd4b0794b2f20c414ab4988d675959747cd12d3eb4c6d6736f38',
 grant_pg_graphql_access:'fb5a80e6d30734718db960270a5f0eac0d655e238e8128ba56803b74a052bc1e',
 grant_pg_net_access:'55abda380efd46b37b26d3c6e4f3b514e28b7c7c1df44f5ae0315ece4052370d',
 pgrst_ddl_watch:'de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0',
 pgrst_drop_watch:'791b41f0632fc86e0fc86a303ec0fd710c4e2ecf947a23422dae2b7a2c122f1d',
};
function validateApproval(m){
  assert.equal(m.schemaVersion,1);assert.ok(['PENDING_EVIDENCE','APPROVED'].includes(m.approvalStatus));
  assert.deepEqual(m.triggers.map(t=>t.name).sort(),[...expectedNames].sort());
  for(const t of m.triggers){assert.match(t.expectedSourceSha256,/^[a-f0-9]{64}$/);assert.equal(t.functionSchema,'extensions');
    assert.match(t.functionName,/^[a-z_]+$/);assert.equal(t.enabled,'O');
    const isDrop=t.name==='issue_graphql_placeholder'||t.name==='pgrst_drop_watch';
    assert.equal(t.event,isDrop?'sql_drop':'ddl_command_end');
    assert.deepEqual(t.tags,t.name==='issue_graphql_placeholder'?['DROP EXTENSION']:t.name.startsWith('issue_')?['CREATE EXTENSION']:null);
    const fn=t.name==='issue_graphql_placeholder'?'set_graphql_placeholder':t.name.replace(/^issue_/,'grant_');
    assert.equal(t.functionName,fn);assert.equal(t.expectedSourceSha256,officialSources[fn]);
    for(const f of ['approvedDefinitionSha256','approvedFunctionMetadataSha256','approvedTriggerMetadataSha256'])assert.ok(t[f]===null||/^[a-f0-9]{64}$/.test(t[f]));}
  if(m.approvalStatus==='APPROVED'){
    assert.ok(typeof m.approvalRef==='string'&&m.approvalRef.trim());assert.ok(Number.isFinite(Date.parse(m.reviewedAt)));
    for(const t of m.triggers)for(const f of ['approvedDefinitionSha256','approvedFunctionMetadataSha256','approvedTriggerMetadataSha256'])assert.match(t[f]??'',/^[a-f0-9]{64}$/);
    assert.equal(m.reference.targetBuildMatch,'REVIEWED_FOR_TARGET');
  }return m;
}
function loadApproval(){return validateApproval(JSON.parse(fs.readFileSync(manifestPath,'utf8')));}
function evidenceSql(m){
  const expectations=m.triggers.map(t=>`(${q(t.name)},${q(t.expectedSourceSha256)})`).join(',\n');
  return `-- PREPARED ONLY. One targeted READ ONLY query; no application data or raw function bodies.
-- Expected Development lwkxufnbjrpsehdkfmgy; verify Dashboard identity separately.
-- Reference candidate ${m.reference.version}, NOT a verified target build.
begin transaction isolation level repeatable read read only;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='2s';
set local statement_timeout='15s';
with expected(name,source_hash) as (values ${expectations}),
actual as (
 select e.evtname, ${triggerMetadata} as trigger_metadata,
 ${functionMetadata} as function_metadata, ${sourceHash} as source_sha256,
 ${definitionHash} as definition_sha256,${functionMetadataHash} as function_metadata_sha256,
 ${triggerMetadataHash} as trigger_metadata_sha256
 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
 join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
)
select jsonb_build_object('notice','EVIDENCE_ONLY_NOT_AN_APPROVAL_OR_PROJECT_IDENTITY_PROOF',
 'version',current_setting('server_version'),'readOnly',current_setting('transaction_read_only'),
 'referenceVersion',${q(m.reference.version)},'actualCount',(select count(*) from actual),
 'missingExpected',coalesce((select jsonb_agg(x.name order by x.name) from expected x
   where not exists(select 1 from actual a where a.evtname=x.name)),'[]'::jsonb),
 'eventTriggers',coalesce((select jsonb_agg(jsonb_build_object('name',a.evtname,
   'expectedName',x.name is not null,'triggerMetadata',a.trigger_metadata,'functionMetadata',a.function_metadata,
   'sourceSha256',a.source_sha256,'definitionSha256',a.definition_sha256,
   'functionMetadataSha256',a.function_metadata_sha256,'triggerMetadataSha256',a.trigger_metadata_sha256,
   'sourceMatchesReference',coalesce(a.source_sha256=x.source_hash,false)) order by a.evtname)
   from actual a left join expected x on x.name=a.evtname),'[]'::jsonb)) as phase17c_evidence;
rollback;
`;
}
function approvedChecks(m){
  const values=m.triggers.map(t=>`(${q(t.name)},${q(t.event)},${q(JSON.stringify(t.tags))}::jsonb,${q(t.functionName)},${q(t.expectedSourceSha256)},${q(t.approvedDefinitionSha256)},${q(t.approvedFunctionMetadataSha256)},${q(t.approvedTriggerMetadataSha256)})`).join(',\n');
  return `
  if ${q(m.approvalStatus)} is distinct from 'APPROVED'
    or ${q(m.approvalRef)} is null or ${q(m.reference.targetBuildMatch)} is distinct from 'REVIEWED_FOR_TARGET'
    or current_setting('safemelink.phase17c_health_review',true) is distinct from 'SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER'
    or current_setting('safemelink.phase17c_execution_review',true) is distinct from 'AUTHORIZED_DDL_ONLY_QUIET_WINDOW'
    or current_setting('session_replication_role') is distinct from 'origin' then
    raise exception 'STOP: exact trigger approval, service health and execution window not confirmed'; end if;
  if (select count(*) from pg_event_trigger)<>6 then raise exception 'STOP: unexpected event trigger inventory'; end if;
  for approved in select * from (values ${values}) v(name,event,tags,function_name,source_hash,definition_hash,function_metadata_hash,trigger_metadata_hash) loop
    if approved.definition_hash is null or approved.function_metadata_hash is null or approved.trigger_metadata_hash is null
      or not exists(select 1 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
        join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where e.evtname=approved.name and e.evtevent=approved.event and e.evtenabled='O'
          and coalesce(to_jsonb(e.evttags),'null'::jsonb)=approved.tags
          and n.nspname='extensions' and p.proname=approved.function_name and p.pronargs=0
          and p.prokind='f' and p.prorettype='pg_catalog.event_trigger'::regtype
          and ${sourceHash}=approved.source_hash and ${definitionHash}=approved.definition_hash
          and ${functionMetadataHash}=approved.function_metadata_hash and ${triggerMetadataHash}=approved.trigger_metadata_hash) then
      raise exception 'STOP: unapproved event trigger definition or metadata: %',approved.name; end if;
  end loop;
`;
}
function buildTriggerValidation(){const m=loadApproval(),base=buildDdlValidation();
  const old="  if exists(select 1 from pg_event_trigger where evtenabled<>'D') then\n    raise exception 'STOP: enabled DDL event trigger; review externally, do not disable it for this test'; end if;";
  assert.equal(base.sql.split(old).length-1,1);const checks=approvedChecks(m);
  let sql=base.sql.replace('declare item text;','declare item text; approved record;').replace(old,checks);
  sql=sql.replace("set local safemelink.phase17_target_review='UNCONFIRMED';",`set local safemelink.phase17_target_review='UNCONFIRMED';
set local safemelink.phase17c_health_review='UNCONFIRMED';
set local safemelink.phase17c_execution_review='UNCONFIRMED';`);
  sql=sql.replace('Enabled event triggers cause STOP.','Only EXACT approved event triggers can pass; pending evidence and health block execution.');
  sql=`-- PHASE 17C VARIANT. Original Phase 17 file and three migrations are unchanged.
-- Approval status: ${m.approvalStatus}. Never auto-approve observed hashes.
-- Official reference candidate ${m.reference.version}; target identity/build/incident require independent review.
`+sql;
  // Detect definition/inventory drift again before completion; this cannot undo an external effect.
  sql=sql.replace('do $phase17_assertions$',`do $phase17c_recheck$ declare approved record; begin${checks} end $phase17c_recheck$;
do $phase17_assertions$`);
  assert.deepEqual(topLevel(sql).filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
  return {sql,evidenceSql:evidenceSql(m),approvalStatus:m.approvalStatus,sqlSha256:crypto.createHash('sha256').update(sql).digest('hex')};
}
// Shared verbatim with 17D: hashes must use the exact evidence-query procedure.
const eventTriggerFingerprintSql=Object.freeze({sourceHash,definitionHash,functionMetadataHash,triggerMetadataHash,functionMetadata,triggerMetadata});
module.exports={buildTriggerValidation,loadApproval,validateApproval,eventTriggerFingerprintSql};
if(require.main===module){const b=buildTriggerValidation();
  if(process.argv.includes('--emit-sql'))process.stdout.write(b.sql);
  else if(process.argv.includes('--emit-evidence'))process.stdout.write(b.evidenceSql);
  else console.log(JSON.stringify({status:'PREPARED_NOT_EXECUTED',approval:b.approvalStatus,sqlLength:b.sql.length,sqlSha256:b.sqlSha256}));}
