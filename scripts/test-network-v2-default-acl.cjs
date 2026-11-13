'use strict';
// Pure local ACL model. NO PostgreSQL execution or impersonation of database roles.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {topLevel}=require('./prepare-network-v2-local-validation.cjs');
const {inspect,buildDdlValidation}=require('./prepare-network-ddl-validation.cjs');
const root=path.resolve(__dirname,'..');
const names=['20261103120000_network_territorial_map_history.sql','20261107120000_network_event_markers_v2.sql','20261108120000_network_social_v2.sql'];
const sources=()=>names.map(n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8'));
const functionAcl='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
const tableAcl='{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}';
const letters={X:'EXECUTE',a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'};
function parseAcl(text){return new Map([...text.matchAll(/([^=,{]+)=([A-Za-z*]*)\/([^,}]+)/g)].map(m=>{
  assert.ok(!m[2].includes('*'),'Reported defaults contain no grant options');return [m[1],new Set([...m[2]].map(c=>letters[c]))];}));}
const tablesService={};
for(const n of ['network_map_territories_v2','network_map_zones_v2','network_map_members_v2','network_map_sources_v2',
 'network_map_publications_v2','network_map_publication_sources_v2','network_history_entries_v2'])tablesService[n]=['SELECT','INSERT','UPDATE','DELETE'];
for(const n of ['network_event_policies_v2','network_event_members_v2','network_social_policies_v2'])tablesService[n]=['SELECT','INSERT','UPDATE'];
const clientFunctions=new Set(['get_network_territory_context_v2','list_network_map_cells_v2','list_network_zone_history_v2',
 'create_network_event_v2','list_network_event_markers_v2','get_network_event_detail_v2','list_network_event_territories_v2','finish_my_network_event_v2',
 'get_network_social_v2','mutate_network_social_v2','get_my_network_social_operation_v2','remove_my_network_social_v2','list_network_social_activity_v2']);
const serviceFunctions=new Set(['network_map_candidates_v2','list_network_event_review_queue_v2','review_network_event_v2','list_network_comment_review_v2','review_network_comment_v2']);
function simulate(input,custom=true){
  const objects=new Map();
  for(const source of input)for(const s of topLevel(source)){
    const t=s.token.replace(/;$/,'');let m=t.match(/^create (function|table) public\.(\w+)/);
    if(m){const kind=m[1],defaults=custom?parseAcl(kind==='function'?functionAcl:tableAcl):new Map([['postgres',new Set(kind==='function'?['EXECUTE']:Object.values(letters).filter(x=>x!=='EXECUTE'))],...(kind==='function'?[['public',new Set(['EXECUTE'])]]:[])]);
      objects.set(kind+':'+m[2],{kind,name:m[2],acl:defaults});continue;}
    m=t.match(/^(revoke|grant) ([a-z, ]+) on (function |table )?([\s\S]+?) (?:from|to) ([a-z_, ]+)$/);
    if(!m)continue;
    const action=m[1],kind=m[3]?.trim()==='function'?'function':'table';
    const targets=[...m[4].matchAll(kind==='function'?/public\.(\w+)\(/g:/public\.(\w+)/g)].map(x=>x[1]);
    const roles=m[5].split(',').map(x=>x.trim()),privileges=m[2].split(',').map(x=>x.trim().toUpperCase());
    assert.ok(targets.length);for(const name of targets){const obj=objects.get(kind+':'+name);assert.ok(obj,'ACL target not created in V2: '+name);
      for(const role of roles){if(!obj.acl.has(role))obj.acl.set(role,new Set());const rights=obj.acl.get(role);
        if(action==='revoke'){assert.deepEqual(privileges,['ALL']);rights.clear();}else{assert.ok(!privileges.includes('ALL'));for(const p of privileges)rights.add(p);}}}
  }
  const failures=[];
  for(const obj of objects.values())for(const role of new Set(['public','anon','authenticated','service_role',...obj.acl.keys()])){
    if(role==='postgres')continue;
    const actual=new Set([...(obj.acl.get(role)||[]),...(obj.acl.get('public')||[])]);
    const expected=obj.kind==='function'?new Set((role==='authenticated'&&clientFunctions.has(obj.name))||(role==='service_role'&&serviceFunctions.has(obj.name))?['EXECUTE']:[]):
      new Set(role==='service_role'?(tablesService[obj.name]||[]):[]);
    if([...actual].some(p=>!expected.has(p))||[...expected].some(p=>!actual.has(p)))failures.push({kind:obj.kind,name:obj.name,role,actual:[...actual].sort(),expected:[...expected].sort()});
  }return {objects,failures};
}
if(process.argv.includes('--diagnose')){const d=simulate(sources());console.log(JSON.stringify({functionFailures:d.failures.filter(f=>f.kind==='function'),tableFailures:d.failures.filter(f=>f.kind==='table')}));process.exit(0);}
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('exact provided postgres defaults include function EXECUTE and all eight PG17 table privileges',()=>{
  assert.deepEqual([...parseAcl(functionAcl).keys()],['postgres','anon','authenticated','service_role']);
  assert.equal(parseAcl(tableAcl).get('service_role').size,8);assert.ok(parseAcl(tableAcl).get('service_role').has('MAINTAIN'));
});
test('all 30 functions and 17 tables match an independent frozen matrix with actual reported defaults',()=>{
  const r=simulate(sources());assert.equal([...r.objects.values()].filter(o=>o.kind==='function').length,30);
  assert.equal([...r.objects.values()].filter(o=>o.kind==='table').length,17);assert.deepEqual(r.failures,[]);
});
test('normal PostgreSQL PUBLIC EXECUTE defaults are also removed without global ACL changes',()=>{
  assert.deepEqual(simulate(sources(),false).failures,[]);
  for(const source of sources())assert.doesNotMatch(topLevel(source).map(s=>s.token).join('\n'),/alter default privileges|^alter role|^alter schema/gm);
});
test('removing service_role REVOKEs reproduces original helper EXECUTE and all four excess table privileges',()=>{
  const input=sources();input[0]=input[0].replaceAll('from public, anon, authenticated, service_role;','from public, anon, authenticated;');
  const r=simulate(input);assert.equal(r.failures.filter(x=>x.kind==='function').length,7);assert.equal(r.failures.filter(x=>x.kind==='table').length,7);
  assert.ok(r.failures.some(f=>f.name==='network_history_invalidate_review_v2'&&f.actual.includes('EXECUTE')));
  for(const f of r.failures.filter(x=>x.kind==='table'))for(const p of ['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.ok(f.actual.includes(p));
});
test('ACL targets remain V2-only; unexpected grants fail independent matrix',()=>{
  const input=sources();input[0]=input[0].replace(/commit;\s*$/,'grant execute on function public.network_history_invalidate_review_v2() to anon;\ncommit;');
  assert.ok(simulate(input).failures.some(f=>f.name==='network_history_invalidate_review_v2'&&f.role==='anon'));
  assert.throws(()=>simulate(['begin; revoke all on table public.sos from anon; commit;']));
});
test('assertions retain effective ACL checks and strengthen MAINTAIN, unknown grantees and grant-option protection',()=>{
  const sql=buildDdlValidation().sql;
  for(const x of ["'MAINTAIN'",'Function ACL mismatch','Table ACL mismatch','Unexpected function grantee/grant option','Unexpected table grantee/grant option','a.is_grantable'])assert.ok(sql.includes(x),x);
  assert.ok(sql.includes('a.attacl is null')); // Column-level privileges remain denied.
});
test('Phase17E artifact equals scoped generator and remains blocked with final ROLLBACK',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const {buildScopedValidation,aclRevisionPrefix}=require('./prepare-network-ddl-scoped-validation.cjs');
  const file=fs.readFileSync(path.join(__dirname,'phase17e-network-v2-ddl-rollback.sql'),'utf8');
  const lf=s=>s.replace(/\r\n/g,'\n');
  assert.equal(lf(file),lf(aclRevisionPrefix+buildScopedValidation().sql));
  assert.equal((file.match(/UNCONFIRMED/g)||[]).length,3);
  assert.ok(file.trimEnd().endsWith('rollback;'));
  const tokens=topLevel(file).map(s=>s.token);
  assert.equal(tokens.filter(t=>t==='begin').length,1);
  assert.equal(tokens.filter(t=>t==='rollback').length,1);
  assert.equal(tokens.filter(t=>t==='commit').length,0);
});
console.log(`${passed} local default-ACL model checks PASS. No PostgreSQL SQL executed.`);
