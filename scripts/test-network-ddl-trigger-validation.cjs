'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {buildTriggerValidation,loadApproval,validateApproval}=require('./prepare-network-ddl-trigger-validation.cjs');
const {buildDdlValidation}=require('./prepare-network-ddl-validation.cjs');
const {topLevel,unwrap}=require('./prepare-network-v2-local-validation.cjs');
const root=path.resolve(__dirname,'..'),lf=s=>s.replace(/\r\n/g,'\n');
const b=buildTriggerValidation(),m=loadApproval();let passed=0;
function test(name,run){run();passed++;console.log('PASS '+name);}
test('standalone variant and single evidence query match their generator',()=>{
  assert.equal(lf(fs.readFileSync(path.join(root,'scripts/phase17c-network-v2-ddl-rollback.sql'),'utf8')),lf(b.sql));
  assert.equal(lf(fs.readFileSync(path.join(root,'scripts/phase17c-event-trigger-evidence.sql'),'utf8')),lf(b.evidenceSql));
});
test('original Phase 17 and migration bodies preserved completely',()=>{
  assert.equal(lf(fs.readFileSync(path.join(root,'scripts/phase17-network-v2-ddl-rollback.sql'),'utf8')),lf(buildDdlValidation().sql));
  for(const input of buildDdlValidation().inputs){const body=lf(unwrap(fs.readFileSync(path.join(root,'supabase/migrations',input.name),'utf8')));
    assert.equal(lf(b.sql).split(body).length-1,1);}
});
test('one transaction, original timeouts and default blocks including incident status',()=>{
  assert.deepEqual(topLevel(b.sql).filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
  for(const x of ["phase17_target_review='UNCONFIRMED'","phase17c_health_review='UNCONFIRMED'","phase17c_execution_review='UNCONFIRMED'",
    "transaction_timeout='90s'","lock_timeout='2s'","statement_timeout='15s'","'PENDING_EVIDENCE' is distinct from 'APPROVED'"])
    assert.ok(b.sql.includes(x),x);
});
test('pending approval has no invented installed definition hashes',()=>{
  assert.equal(m.approvalStatus,'PENDING_EVIDENCE');assert.equal(m.approvalRef,null);
  for(const t of m.triggers)for(const key of ['approvedDefinitionSha256','approvedFunctionMetadataSha256','approvedTriggerMetadataSha256'])assert.equal(t[key],null);
  const incomplete=structuredClone(m);incomplete.approvalStatus='APPROVED';assert.throws(()=>validateApproval(incomplete));
});
test('unknown trigger inventory, command filters, function names and source bodies rejected',()=>{
  for(const mutate of [x=>x.triggers.push({...x.triggers[0],name:'unknown'}),x=>x.triggers[0].tags=null,
    x=>x.triggers[3].functionName='unknown',x=>x.triggers[4].expectedSourceSha256='a'.repeat(64),x=>x.triggers[5].enabled='D']){
    const copy=structuredClone(m);mutate(copy);assert.throws(()=>validateApproval(copy));
  }
});
test('exact metadata checks run before DDL and again before completion; no disabling or name-only bypass',()=>{
  const first=b.sql.indexOf('create table public.');
  for(const value of ['source_hash','definition_hash','function_metadata_hash','trigger_metadata_hash',"session_replication_role') is distinct from 'origin'",
    'unexpected event trigger inventory','unapproved event trigger definition'])assert.ok(b.sql.indexOf(value)>0&&b.sql.indexOf(value)<first,value);
  assert.equal((b.sql.match(/unapproved event trigger definition or metadata/g)||[]).length,2);
  assert.match(b.sql,/coalesce\(to_jsonb\(e.evttags\),'null'::jsonb\)=approved.tags/); // NULL differs from []
  assert.doesNotMatch(b.sql,/\b(?:alter event trigger|disable trigger|set (?:local )?session_replication_role)\b/i);
});
test('evidence is READ ONLY catalog inspection, no RPC or raw bodies exported',()=>{
  const s=topLevel(b.evidenceSql);assert.match(s[0].token,/read only$/);assert.equal(s.at(-1).token,'rollback');
  assert.ok(s.slice(1,-1).every(x=>/^(set local|with\b)/.test(x.token)));
  assert.doesNotMatch(b.evidenceSql,/\b(?:from|join) (?:public\.|auth\.)|\b(?:insert|update|delete|perform|execute|call)\b/i);
  assert.ok(b.evidenceSql.includes('sourceMatchesReference'));assert.ok(b.evidenceSql.includes('functionMetadataSha256'));
  assert.doesNotMatch(b.evidenceSql,/'(?:body|source|definition)'\s*,\s*(?:p\.prosrc|pg_get_functiondef)/);
});
console.log(`${passed} static Phase 17C checks PASS. No PostgreSQL execution, actual hash comparison or service-health verification performed.`);
