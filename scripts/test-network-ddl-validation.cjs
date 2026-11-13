'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {buildDdlValidation,inspect}=require('./prepare-network-ddl-validation.cjs');
const {topLevel}=require('./prepare-network-v2-local-validation.cjs');
const root=path.resolve(__dirname,'..'),normalize=s=>s.replace(/\r\n/g,'\n');
const b=buildDdlValidation();let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('complete migration bodies, original order, one BEGIN and final ROLLBACK',()=>{
  const actual=fs.readFileSync(path.join(root,'scripts/phase17-network-v2-ddl-rollback.sql'),'utf8');
  assert.equal(normalize(actual),normalize(b.sql));let position=-1;
  for(const f of b.inputs){const next=actual.indexOf('BEGIN EXACT MIGRATION BODY '+f.name);assert.ok(next>position);position=next;}
  assert.deepEqual(topLevel(actual).filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
});
test('no fixtures/data mutation or application execution at top level',()=>{
  const executable=topLevel(b.sql).filter(s=>!s.token.startsWith('create function'));
  for(const s of executable){assert.doesNotMatch(s.token,/^(?:insert|update|delete|call|copy|drop|truncate|create or replace|create extension|create role|alter system)\b/);}
  for(const input of b.inputs){inspect(fs.readFileSync(path.join(root,'supabase/migrations',input.name),'utf8'));}
  assert.doesNotMatch(b.sql,/\binsert into auth\.users|\bupdate public\.(?:profiles|radar_preferences)|\bdelete from public\.sos/i);
  assert.doesNotMatch(b.sql,/\b(?:disable trigger|session_replication_role|cron\.unschedule|alter default privileges)\b/i);
});
test('default blocked, DDL event-trigger guard, collision checks before first CREATE',()=>{
  const first=b.sql.indexOf('create table public.');
  assert.ok(b.sql.indexOf("evtenabled<>'D'")<first);
  assert.ok(b.sql.indexOf('occupied V2 function name')<first);
  assert.ok(b.sql.indexOf('occupied relation/type name')<first);
  assert.match(b.sql,/phase17_target_review='UNCONFIRMED'/);
  assert.match(b.sql,/transaction_timeout='90s'/);assert.match(b.sql,/lock_timeout='2s'/);
  assert.match(b.sql,/check_function_bodies=on/);
});
test('catalog checks cover types, constraints, signatures/results, RLS, ACL, indices, gates and legacy fingerprint',()=>{
  assert.equal(b.tables.length,17);assert.equal(b.columns,150);assert.equal(b.functions.length,30);assert.equal(b.indexes.length,21);assert.equal(b.triggers.length,2);
  for(const fragment of ['Column count mismatch','Column/type/nullability mismatch','Constraint mismatch','Index mismatch','Function ACL mismatch','Table ACL mismatch',
    'pg_get_function_result','Gate default OFF missing','Trigger mismatch','Pre-existing business metadata changed','t.tgisinternal'])assert.ok(b.sql.includes(fragment),fragment);
});
test('unapproved DML, guard RPC and missing transaction boundary are rejected',()=>{
  assert.throws(()=>inspect('begin; insert into public.profiles(id) values(null); commit;'));
  assert.throws(()=>inspect('begin; do $$ begin perform public.foo(); end $$; commit;'));
  assert.throws(()=>inspect('begin; do $$ declare x integer; begin select public.foo() into x; end $$; commit;'));
  assert.throws(()=>inspect('begin; select 1; rollback;'));
  assert.throws(()=>inspect('begin; commit; commit;'));
});
console.log(`${passed} local DDL preparation checks PASS. PostgreSQL parsing/execution NOT performed.`);
