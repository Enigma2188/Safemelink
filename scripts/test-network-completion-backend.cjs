'use strict';
/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {topLevel,unwrap}=require('./prepare-network-v2-local-validation.cjs');
const {inspect}=require('./prepare-network-ddl-validation.cjs');
const {proveCommandScope}=require('./prepare-network-ddl-scoped-validation.cjs');
const {buildCompletionValidation,buildCompletionFunctional,buildPostRollback}=require('./prepare-network-completion-validation.cjs');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8').replace(/\r\n/g,'\n');
const source=read('supabase/migrations/20261110120000_network_recovery_author_updates_v2.sql');let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
test('single additive source, original V2 tables only, no legacy/SOS write or external effects',()=>{
 assert.deepEqual(topLevel(source).filter(s=>/^(begin|commit|rollback)\b/.test(s.token)).map(s=>s.token),['begin','commit']);
 assert.doesNotMatch(source,/\b(?:drop|truncate|create or replace|http_post|http_get|pg_notify|dblink|cron\.schedule|net\.http)\b/i);
 assert.doesNotMatch(source,/\b(?:insert into|update|delete from|alter table) public\.(?:sos|profiles|network_reports)\b/i);
 assert.equal(inspect(source).tables.length,2);assert.equal(inspect(source).functions.length,5);
});
test('actual reported default ACLs reset fully, including service_role and MAINTAIN',()=>{
 function model(sql){const m=inspect(sql),tables=new Map(m.tables.map(t=>[t.name,new Set(['anon','authenticated','service_role'])])),funcs=new Map(m.functions.map(f=>[f.name,new Set(['public','anon','authenticated','service_role'])]));
  for(const s of topLevel(unwrap(sql))){if(/^revoke all/.test(s.token)){const roles=s.token.match(/from ([\w, ]+);?$/)[1].replace(/;$/,'').split(',').map(x=>x.trim());
    const target=s.token.includes('on function')?funcs:tables;for(const n of s.token.matchAll(/public\.(\w+)/g))for(const r of roles)target.get(n[1])?.delete(r);}
   if(/^grant execute/.test(s.token))for(const n of s.token.matchAll(/public\.(\w+)/g))funcs.get(n[1]).add('authenticated');
  }return{tables,funcs};}
 const m=model(source);for(const roles of m.tables.values())assert.equal(roles.size,0);
 for(const [name,roles] of m.funcs)assert.deepEqual([...roles],name==='network_operation_fence_guard_v2'?[]:['authenticated']);
 const bad=model(source.replaceAll('from public,anon,authenticated,service_role','from public,anon,authenticated'));
 assert.ok([...bad.tables.values()].some(s=>s.has('service_role')));assert.ok([...bad.funcs.values()].some(s=>s.has('service_role')));
 assert.ok(buildCompletionValidation().sql.includes("'MAINTAIN'"));
});
test('absent receipt never means failure; server fence and both original insert paths share actor lock',()=>{
 assert.ok(source.includes("if not prevent_late then return jsonb_build_object('state','UNKNOWN'"));
 assert.match(source,/before insert on public\.network_events_v2/);assert.match(source,/before insert on public\.network_social_operations_v2/);
 assert.match(source,/hashtextextended\(actor::text,7011\)/);assert.match(source,/user_id=actor and kind=target_kind and operation_id=target_operation/);
 assert.match(source,/count\(\*\).*network_operation_fences_v2 where user_id=actor\)>=256/);
 assert.match(source,/if identifier is not null then return jsonb_build_object\('state','FOUND'/);
});
test('author update reuses existing moderation/quota/receipt and exposes approved current-policy body only',()=>{
 assert.match(source,/author_user_id=actor;/);assert.match(source,/public\.mutate_network_social_v2\(target_event,target_operation,'COMMENT'/);
 assert.match(source,/c\.moderation_state='APPROVED'/);assert.match(source,/c\.author_id=n\.author_user_id/);assert.match(source,/c\.policy_version=s\.policy_version/);
 assert.match(source,/network_social_actor_allowed_v2/);assert.match(source,/limit 50/);assert.match(source,/not between 2 and 300/);
 assert.doesNotMatch(source,/author_latitude|author_longitude|gps|phone|email/i);
});
test('standalone full DDL matches generator, exact fourth source, all guards and four UNCONFIRMED',()=>{
 const b=buildCompletionValidation(),file=read('scripts/block0-network-v2-ddl-rollback.sql');assert.equal(file,b.sql);
 assert.equal(file.split(unwrap(source)).length-1,1);assert.equal((file.match(/UNCONFIRMED/g)||[]).length,4);
 assert.deepEqual(topLevel(file).filter(s=>/^(begin|commit|rollback)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
 assert.ok(file.includes('Completion function ACL mismatch'));assert.ok(file.includes('Unexpected completion table grantee'));
 assert.ok(file.indexOf('do $phase17d_recheck$')>file.indexOf('create function public.resolve_my_network_operation_v2'));
 assert.throws(()=>proveCommandScope(file.replace(/rollback;\s*$/,'select public.resolve_my_network_operation_v2(); rollback;')));
});
test('business fingerprints exclude completion objects symmetrically but retain legacy coverage',()=>{
 const sql=buildCompletionValidation().sql;
 for(const [pattern,names] of [[/p\.proname not in \(([^)]*)\)/g,['network_operation_fence_guard_v2','resolve_my_network_operation_v2','publish_network_author_update_v2','get_network_author_updates_v2','list_my_network_events_v2']],[/c\.relname not in \(([^)]*)\)/g,['network_operation_fences_v2','network_author_update_links_v2']]]){
  const lists=[...sql.matchAll(pattern)].map(m=>m[1]);assert.equal(lists.length,2);assert.equal(lists[0],lists[1]);
  for(const name of names)assert.ok(lists[0].includes("'"+name+"'"));
  for(const legacy of ['profiles','network_reports','network_preferences'])assert.ok(!lists[0].includes("'"+legacy+"'"));
 }
});
test('functional fixture package is default blocked, synthetic, one rollback and covers fencing/account/review',()=>{
 const b=buildCompletionFunctional(),file=read('scripts/block0-network-functional-rollback.sql');assert.equal(file,b.sql);
 assert.ok(file.includes("valid_until=statement_timestamp()-interval '1 second'"));
 assert.ok(!file.includes("valid_until=clock_timestamp()-interval '1 second'"));
 assert.ok(file.includes("block0_functional_review='UNCONFIRMED'"));assert.ok(file.includes('confirmed-no-side-effects'));assert.ok(file.includes('@example.invalid'));
 for(const message of ['Late event passed fence','Fenced social side effect was committed','Non-author wrote update','Pending author update leaked','Other account receipt leaked','Direct completion table access'])assert.ok(file.includes(message));
 assert.deepEqual(topLevel(file).filter(s=>/^(begin|commit|rollback)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
});
test('post-rollback check is catalog-only READ ONLY and covers all new names',()=>{
 const sql=buildPostRollback().sql;assert.equal(read('scripts/block0-network-post-rollback-readonly.sql'),sql);
 assert.match(sql,/begin read only/);assert.match(sql,/allV2ObjectsAbsent/);assert.match(sql,/list_my_network_events_v2/);
 assert.doesNotMatch(sql,/\b(?:insert|update|delete|create|alter|drop|perform|call|commit)\b/i);
 assert.ok(sql.trimEnd().endsWith('rollback;'));
});
console.log(`${passed} completion backend/package static checks PASS. PostgreSQL/JWT/concurrency NOT executed.`);
