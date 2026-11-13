'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {buildScopedValidation,proveCommandScope,validateExpectations,loadExpectations}=require('./prepare-network-ddl-scoped-validation.cjs');
const {buildDdlValidation}=require('./prepare-network-ddl-validation.cjs');
const {eventTriggerFingerprintSql:F}=require('./prepare-network-ddl-trigger-validation.cjs');
const {topLevel,unwrap}=require('./prepare-network-v2-local-validation.cjs');
const root=path.resolve(__dirname,'..'),lf=s=>s.replace(/\r\n/g,'\n');const b=buildScopedValidation(),m=loadExpectations();let passed=0;
function test(name,run){run();passed++;console.log('PASS '+name);}
test('complete standalone package equals generator; original migrations remain whole and ordered',()=>{
  const file=fs.readFileSync(path.join(root,'scripts/phase17d-network-v2-ddl-rollback.sql'),'utf8');assert.equal(lf(file),lf(b.sql));
  let order=-1;for(const f of m.migrations){const body=lf(unwrap(fs.readFileSync(path.join(root,'supabase/migrations',f.name),'utf8')));
    assert.equal(lf(file).split(body).length-1,1);const at=file.indexOf('BEGIN EXACT MIGRATION BODY '+f.name);assert.ok(at>order);order=at;}
  assert.equal(lf(fs.readFileSync(path.join(root,'scripts/phase17-network-v2-ddl-rollback.sql'),'utf8')),lf(buildDdlValidation().sql));
});
test('command scope has no executable extension creation/drop, destructive ALTER, dynamic SQL or application RPC',()=>{
  const commands=proveCommandScope(b.sql);assert.equal(commands['CREATE FUNCTION'],30);assert.equal(commands['ALTER TABLE ENABLE RLS'],17);
  for(const sql of ['begin; create extension pg_net; rollback;','begin; drop extension pg_net; rollback;',
    'begin; alter table public.profiles drop column nickname; rollback;',
    'begin; do $$ begin execute x; end $$; rollback;',
    'begin; do $$ begin perform public.foo(); end $$; rollback;',
    'begin; select public.foo(); rollback;'])assert.throws(()=>proveCommandScope(sql));
  assert.equal(b.baseSha256,'bbdc6ce02d7ea9fcb9623211e00bbd0ca4f2d7beab912262b9639d5895d18797');
});
test('exact user-supplied ten SHA-256 values retained; mismatched bodies not approved',()=>{
  const hashes=m.triggers.flatMap(t=>[t.triggerMetadataSha256,...(t.mode==='PINNED_FUNCTION'?[t.definitionSha256,t.functionMetadataSha256]:[])]);
  assert.equal(hashes.length,10);assert.ok(hashes.every(h=>/^[a-f0-9]{64}$/.test(h)));
  assert.equal(m.triggers.filter(t=>t.mode==='TAG_DISJOINT_BODY_NOT_APPROVED').length,4);
  for(const t of m.triggers.filter(t=>t.mode==='TAG_DISJOINT_BODY_NOT_APPROVED')){
    assert.equal(t.definitionSha256,undefined);assert.equal(t.functionMetadataSha256,undefined);
  }
  assert.equal(m.triggers.find(t=>t.name==='issue_pg_net_access').sourceMatchesReference,false);
});
test('all six conditions/owners/inventory pinned; unknown or broad filters fail closed',()=>{
  for(const mutate of [x=>x.triggers[0].tags=null,x=>x.triggers[1].tags.push('CREATE TABLE'),x=>x.triggers[3].event='ddl_command_start',
    x=>x.triggers[2].owner='unknown',x=>x.triggers[4].functionName='other',x=>x.triggers.push({...x.triggers[0],name:'extra'})]){
    const copy=structuredClone(m);mutate(copy);assert.throws(()=>validateExpectations(copy));
  }
  assert.equal((b.sql.match(/event trigger inventory changed/g)||[]).length,2);
  assert.match(b.sql,/pg_get_userbyid\(e.evtowner\)=expected.owner/);
  assert.match(b.sql,/coalesce\(to_jsonb\(e.evttags\),'null'::jsonb\)=expected.tags/);
});
test('watchers retain full definition/source/metadata controls using identical Phase17C expressions',()=>{
  for(const expression of [F.sourceHash,F.definitionHash,F.functionMetadataHash,F.triggerMetadataHash])assert.equal(b.sql.split(expression).length-1,2);
  assert.match(b.sql,/l.lanname='plpgsql'/);assert.match(b.sql,/cardinality\(p.proconfig\)=1/);
  const old=JSON.parse(fs.readFileSync(path.join(root,'scripts/phase17c-event-trigger-approval.json'),'utf8'));
  assert.equal(old.approvalStatus,'PENDING_EVIDENCE');assert.equal(old.approvalRef,null);
});
test('exact observed empty search_path passes the config clause; arbitrary paths or extra settings fail',()=>{
  // Local model of this SQL clause only: full digest and identity checks remain mandatory.
  const allowed=config=>config===null||(Array.isArray(config)&&config.length===1&&typeof config[0]==='string'&&
    (config[0]==='search_path=""'||config[0].replace(/\s/g,'')==='search_path=pg_catalog,pg_temp'));
  assert.equal(allowed(['search_path=""']),true);
  assert.equal(allowed(null),true);assert.equal(allowed(['search_path=pg_catalog,pg_temp']),true);
  for(const config of [[],['search_path=public'],['search_path="public"'],['search_path='],['search_path= ""'],
    ['search_path="",public'],['search_path=""','client_min_messages=debug5'],['other_setting=""']])assert.equal(allowed(config),false);
  assert.equal((b.sql.match(/where c='search_path=""' or regexp_replace/g)||[]).length,2);
  assert.equal((b.sql.match(/cardinality\(p.proconfig\)=1/g)||[]).length,2);
});
test('before-DDL and post-DDL guards, one BEGIN/ROLLBACK, default health and execution blocks',()=>{
  assert.deepEqual(topLevel(b.sql).filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
  for(const text of ["phase17_target_review='UNCONFIRMED'","phase17d_health_review='UNCONFIRMED'","phase17d_execution_review='UNCONFIRMED'",
    "lock_timeout='2s'","statement_timeout='15s'","transaction_timeout='90s'"])assert.ok(b.sql.includes(text));
  assert.ok(b.sql.indexOf('trigger conditions/definition/metadata differ')<b.sql.indexOf('create table public.'));
  assert.ok(b.sql.indexOf('do $phase17d_recheck$')>b.sql.indexOf('END EXACT MIGRATION BODY 20261108120000_network_social_v2.sql'));
  assert.doesNotMatch(b.sql,/\b(?:alter event trigger|disable trigger|set (?:local )?session_replication_role)\b/i);
});
console.log(`${passed} Phase17D static checks PASS. No PostgreSQL execution, live fingerprint match or service-health verification.`);
