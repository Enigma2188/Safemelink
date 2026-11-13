'use strict';
// Preparation only: no DB executor, network, authentication or filesystem writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {buildDdlValidation}=require('./prepare-network-ddl-validation.cjs');
const {topLevel}=require('./prepare-network-v2-local-validation.cjs');
const {eventTriggerFingerprintSql:F,loadApproval}=require('./prepare-network-ddl-trigger-validation.cjs');
const root=path.resolve(__dirname,'..'),q=x=>"'"+x.replaceAll("'","''")+"'",sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const lf=s=>s.replace(/\r\n/g,'\n');
const modes={issue_graphql_placeholder:['sql_drop',['DROP EXTENSION'],'set_graphql_placeholder'],
 issue_pg_cron_access:['ddl_command_end',['CREATE EXTENSION'],'grant_pg_cron_access'],
 issue_pg_graphql_access:['ddl_command_end',['CREATE EXTENSION'],'grant_pg_graphql_access'],
 issue_pg_net_access:['ddl_command_end',['CREATE EXTENSION'],'grant_pg_net_access'],
 pgrst_ddl_watch:['ddl_command_end',null,'pgrst_ddl_watch'],pgrst_drop_watch:['sql_drop',null,'pgrst_drop_watch']};
function validateExpectations(m){
  assert.equal(m.schemaVersion,1);assert.equal(m.status,'SCOPED_EXPECTATIONS_RECORDED');assert.equal(m.projectRef,'lwkxufnbjrpsehdkfmgy');
  assert.match(m.normalizedBaseSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(m.triggers.map(t=>t.name).sort(),Object.keys(modes).sort());
  const original=loadApproval();
  for(const t of m.triggers){const [event,tags,fn]=modes[t.name];
    assert.equal(t.event,event);assert.deepEqual(t.tags,tags);assert.equal(t.functionName,fn);
    assert.equal(t.owner,'supabase_admin');assert.equal(t.functionSchema,'extensions');assert.equal(t.enabled,'O');
    assert.match(t.triggerMetadataSha256,/^[a-f0-9]{64}$/);
    const pinned=t.name.startsWith('pgrst_');assert.equal(t.mode,pinned?'PINNED_FUNCTION':'TAG_DISJOINT_BODY_NOT_APPROVED');
    if(pinned){assert.equal(t.sourceMatchesReference,true);assert.equal(t.sourceSha256,original.triggers.find(x=>x.name===t.name).expectedSourceSha256);
      for(const key of ['definitionSha256','functionMetadataSha256'])assert.match(t[key],/^[a-f0-9]{64}$/);
    }else{assert.equal(t.sourceSha256,undefined);assert.equal(t.definitionSha256,undefined);assert.equal(t.functionMetadataSha256,undefined);}
  }return m;
}
function loadExpectations(){return validateExpectations(JSON.parse(fs.readFileSync(path.join(root,'scripts/phase17d-event-trigger-expectations.json'),'utf8')));}
function proveCommandScope(sql){
  const histogram={};
  for(const s of topLevel(sql)){
    const t=s.token;let tag;
    if(/^create function public\./.test(t))tag='CREATE FUNCTION'; // Definition, no body invocation.
    else if(/^create table public\./.test(t))tag='CREATE TABLE';
    else if(/^create (?:unique )?index /.test(t))tag='CREATE INDEX';
    else if(/^create trigger /.test(t))tag='CREATE TRIGGER';
    else if(/^alter table public\.\w+ enable row level security\s*;?$/.test(t))tag='ALTER TABLE ENABLE RLS';
    else if(/^grant /.test(t))tag='GRANT';else if(/^revoke /.test(t))tag='REVOKE';
    else if(/^do /.test(t)){
      tag='DO metadata only';const raw=sql.slice(s.start,s.end),m=raw.match(/(\$[A-Za-z_0-9]*\$)([\s\S]*)\1/);assert.ok(m);
      const clean=m[2].replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
      assert.doesNotMatch(clean,/\b(?:execute|call|create|drop|alter|grant|revoke|insert|update|delete|truncate|copy)\b/i);
      assert.doesNotMatch(clean,/\b(?:public|auth|extensions)\.\w+\s*\(/i);
      for(const p of clean.matchAll(/\bperform\s+(\w+)\s*\(/gi))assert.equal(p[1],'set_config');
    }else if(/^set local /.test(t))tag='SET LOCAL';
    else if(t==='begin'||t==='rollback')tag=t.toUpperCase();
    else if(/^select pg_catalog\.jsonb_build_object\(/.test(t))tag='SELECT metadata result';
    else throw Error('Unapproved executable command: '+t.slice(0,100));
    histogram[tag]=(histogram[tag]||0)+1;
  }return histogram;
}
function scopedChecks(m){
  const optional=x=>x?q(x):'null::text';
  const values=m.triggers.map(t=>`(${q(t.name)},${q(t.event)},${q(JSON.stringify(t.tags))}::jsonb,${q(t.owner)},${q(t.functionName)},${q(t.triggerMetadataSha256)},${q(t.mode)},${optional(t.sourceSha256)},${optional(t.definitionSha256)},${optional(t.functionMetadataSha256)})`).join(',\n');
  return `
  if current_setting('safemelink.phase17d_health_review',true) is distinct from 'SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER'
    or current_setting('safemelink.phase17d_execution_review',true) is distinct from 'AUTHORIZED_DDL_ONLY_QUIET_WINDOW'
    or current_setting('session_replication_role') is distinct from 'origin' then
    raise exception 'STOP: service health, execution authorization and quiet window not confirmed'; end if;
  if (select count(*) from pg_event_trigger)<>6 then raise exception 'STOP: event trigger inventory changed'; end if;
  for expected in select * from (values ${values}) v(name,event,tags,owner,function_name,trigger_hash,mode,source_hash,definition_hash,function_hash) loop
    if not exists(select 1 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
      join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      where e.evtname=expected.name and e.evtevent=expected.event and e.evtenabled='O'
        and pg_get_userbyid(e.evtowner)=expected.owner
        and coalesce(to_jsonb(e.evttags),'null'::jsonb)=expected.tags
        and n.nspname='extensions' and p.proname=expected.function_name and p.pronargs=0
        and p.prokind='f' and p.prorettype='pg_catalog.event_trigger'::regtype
        and ${F.triggerMetadataHash}=expected.trigger_hash
        and (expected.mode='TAG_DISJOINT_BODY_NOT_APPROVED' or (
          expected.mode='PINNED_FUNCTION' and l.lanname='plpgsql'
          and ${F.sourceHash}=expected.source_hash and ${F.definitionHash}=expected.definition_hash
          and ${F.functionMetadataHash}=expected.function_hash
          -- Exact observed empty path is safe for the hash-pinned catalog-only watcher source.
          and (p.proconfig is null or (cardinality(p.proconfig)=1 and exists(select 1 from unnest(p.proconfig) c
            where c='search_path=""' or regexp_replace(c,'\\s','','g')='search_path=pg_catalog,pg_temp')))
        ))) then raise exception 'STOP: trigger conditions/definition/metadata differ: %',expected.name; end if;
  end loop;
`;
}
function buildScopedValidation(){
  const m=loadExpectations(),base=buildDdlValidation();
  assert.equal(sha(lf(base.sql)),m.normalizedBaseSha256,'Pinned Phase17 package changed: re-review applicability');
  assert.deepEqual(base.inputs,m.migrations,'Migration fingerprint changed');const commandProfile=proveCommandScope(base.sql);
  const old="  if exists(select 1 from pg_event_trigger where evtenabled<>'D') then\n    raise exception 'STOP: enabled DDL event trigger; review externally, do not disable it for this test'; end if;";
  assert.equal(base.sql.split(old).length-1,1);const checks=scopedChecks(m);
  let sql=base.sql.replace('declare item text;','declare item text; expected record;').replace(old,checks);
  sql=sql.replace("set local safemelink.phase17_target_review='UNCONFIRMED';",`set local safemelink.phase17_target_review='UNCONFIRMED';
set local safemelink.phase17d_health_review='UNCONFIRMED';
set local safemelink.phase17d_execution_review='UNCONFIRMED';`);
  sql=sql.replace('Enabled event triggers cause STOP.','Only scoped, fingerprint-pinned conditions may pass; unknown definitions are NOT approved.');
  sql=`-- PHASE 17D. Reported evidence recorded, NOT a live verification or execution authorization.
-- Pinned original package (LF-normalized SHA256): ${m.normalizedBaseSha256}
-- Four extension-tagged bodies are NOT APPROVED: they are unreachable for this exact package.
-- Both pgrst watchers retain complete source/definition/metadata checks.
-- No extra commands, manual body edits, role changes or concurrent deploys are covered.
`+sql;
  sql=sql.replace('do $phase17_assertions$',`do $phase17d_recheck$ declare expected record; begin${checks}end $phase17d_recheck$;
do $phase17_assertions$`);
  assert.deepEqual(topLevel(sql).filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
  return {sql,commandProfile,status:m.status,baseSha256:m.normalizedBaseSha256,sqlSha256:sha(lf(sql))};
}
const aclRevisionPrefix='-- PHASE 17E: ACL-corrected review package. No execution authorized.\n';
module.exports={buildScopedValidation,proveCommandScope,validateExpectations,loadExpectations,aclRevisionPrefix};
if(require.main===module){const b=buildScopedValidation();if(process.argv.includes('--emit-acl-revision'))process.stdout.write(aclRevisionPrefix+b.sql);
  else if(process.argv.includes('--emit-sql'))process.stdout.write(b.sql);
  else console.log(JSON.stringify({status:'PREPARED_NOT_EXECUTED',expectations:b.status,sqlLength:b.sql.length,sqlSha256:b.sqlSha256,commandProfile:b.commandProfile}));}
