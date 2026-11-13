'use strict';
// No executor, credentials, network client or filesystem writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {unwrap,topLevel}=require('./prepare-network-v2-local-validation.cjs');
const {buildDevelopmentValidation}=require('./prepare-network-v2-development-validation.cjs');
function buildSocialValidation(mode) {
  const root=path.resolve(__dirname,'..');
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261108120000_network_social_v2.sql'),'utf8');
  const tests=fs.readFileSync(path.join(root,'scripts/test-network-social-development.sql'),'utf8');
  const names=[...migration.matchAll(/^create table public\.(\w+)\s*\(/gm)].map(m=>m[1]);assert.equal(names.length,5);
  const base=buildDevelopmentValidation(mode);
  const sql=`-- PREPARED ONLY. All guards require independent target/external review. No COMMIT.
begin;
do $$ begin
 if current_setting('safemelink.social_test_review',true) is distinct from 'approved-synthetic-only' then raise exception 'STOP: social test approval missing'; end if;
 ${names.map(n=>`if to_regclass('public.${n}') is not null then raise exception 'STOP: social schema already present'; end if;`).join('\n')}
end $$;
${unwrap(base.sql,'rollback')}
${unwrap(migration)}
${unwrap(tests,'rollback')}
rollback;
`;
  const statements=topLevel(sql);
  assert.deepEqual(statements.filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
  assert.doesNotMatch(sql,/\b(?:http_post|http_get|dblink|pg_notify|net\.http|cron\.schedule)\b/i);
  return {sql,inputs:[...base.inputs,...[migration,tests].map((text,i)=>({name:i?'social-tests':'social-migration',sha256:crypto.createHash('sha256').update(text).digest('hex')}))]};
}
module.exports={buildSocialValidation};
if(require.main===module){const mode=process.argv.find(a=>a.startsWith('--territorial='))?.split('=')[1];
  if(process.argv.includes('--emit-sql'))process.stdout.write(buildSocialValidation(mode).sql);
  else {for(const m of ['absent','present'])buildSocialValidation(m);console.log('PASS social package structure; SQL NOT executed');}}
