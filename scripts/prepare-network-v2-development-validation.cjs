'use strict';
// Preparation only: reads local SQL; no database client, execution or file output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { topLevel, unwrap } = require('./prepare-network-v2-local-validation.cjs');
const root = path.resolve(__dirname, '..');
const names = [
  'supabase/migrations/20261103120000_network_territorial_map_history.sql',
  'supabase/migrations/20261107120000_network_event_markers_v2.sql',
  'scripts/test-network-event-development.sql',
];

function buildDevelopmentValidation(territorialState) {
  assert.ok(['absent', 'present'].includes(territorialState), 'Explicit reviewed territorial baseline required');
  const sources = names.map(name => fs.readFileSync(path.join(root, name), 'utf8'));
  const tables = sources.slice(0, 2).map(sql => [...sql.matchAll(/^create table public\.(\w+)\s*\(/gm)].map(m => m[1]));
  assert.equal(tables[0].length, 7); assert.equal(tables[1].length, 5);
  const checks = tables.flatMap((list, stage) => list.map(name => {
    const expected = stage === 0 && territorialState === 'present';
    return `  if (to_regclass('public.${name}') is not null) is distinct from ${expected} then raise exception 'STOP: unexpected baseline ${name}'; end if;`;
  })).join('\n');
  const sql = `-- PREPARED ONLY. Development identity must be verified OUTSIDE SQL.
-- Never run original migration files before/inside this package: they contain COMMIT.
-- One complete submission, one connection. No client auto-commit between statements.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
do $$ begin
  if current_user <> 'postgres'
    or current_setting('safemelink.event_test_target',true) is distinct from 'lwkxufnbjrpsehdkfmgy'
    or current_setting('safemelink.event_test_external_review',true) is distinct from 'confirmed-no-side-effects'
    or current_setting('safemelink.phase14_baseline_review',true) is distinct from '${territorialState}' then
    raise exception 'STOP: verified target, external effects review and explicit baseline approval required'; end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='postgis' and n.nspname='extensions') then raise exception 'STOP: PostGIS dependency'; end if;
  if to_regclass('auth.users') is null or to_regclass('public.profiles') is null
    or to_regclass('public.network_preferences') is null or to_regclass('public.network_config') is null
    or to_regprocedure('public.network_user_is_eligible(uuid)') is null
    or to_regprocedure('public.network_user_is_restricted(uuid,text)') is null then
    raise exception 'STOP: base dependencies absent'; end if;
${checks}
end $$;
${territorialState === 'absent' ? unwrap(sources[0]) : '-- Territorial schema already present: exact compatibility must be reviewed in preflight.'}
${unwrap(sources[1])}
${unwrap(sources[2], 'rollback')}
rollback;
`;
  const statements = topLevel(sql);
  assert.equal(statements[0].token, 'begin');
  assert.equal(statements.at(-1).token, 'rollback');
  assert.deepEqual(statements.filter(s => /^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s => s.token), ['begin', 'rollback']);
  // Fail closed for source changes introducing obvious non-transactional/external operations.
  assert.doesNotMatch(sql, /\b(?:commit|vacuum|concurrently|dblink|http_post|http_get|pg_notify|pg_sleep|nextval|setval|create\s+extension|create\s+role|alter\s+system|cron\.schedule|net\.http)\b(?=\s*\()/i);
  assert.doesNotMatch(statements.map(s => s.token).join('\n'), /(?:^|\n)(?:commit|end\b|prepare transaction|vacuum|copy\b|create extension|create role|alter system|discard|start transaction)/i);
  assert.doesNotMatch(sql, /\bcreate\s+(?:schema\s+auth|table\s+(?:auth\.users|public\.profiles))\b/i);
  return { sql, statements: statements.length, inputs: names.map((name, i) => ({ name,
    sha256: crypto.createHash('sha256').update(sources[i]).digest('hex') })) };
}

function check() {
  for (const mode of ['absent', 'present']) {
    const result = buildDevelopmentValidation(mode);
    assert.ok(result.sql.includes("is distinct from 'lwkxufnbjrpsehdkfmgy'"));
    assert.ok(result.sql.includes("is distinct from 'confirmed-no-side-effects'"));
    assert.equal(result.sql.includes('create table public.network_map_territories_v2'), mode === 'absent');
    assert.ok(result.sql.includes('set local role authenticated;'));
    assert.ok(result.sql.includes('Synthetic fixtures incompatible with eligibility implementation'));
  }
  assert.throws(() => buildDevelopmentValidation('unknown'));
  assert.throws(() => unwrap('begin; select 1; commit; rollback;', 'rollback'));
  assert.throws(() => unwrap('begin; select 1;', 'rollback'));
  assert.equal(unwrap("begin; select 'COMMIT;'; -- COMMIT;\nrollback;", 'rollback').trim(), "select 'COMMIT;';");
  const preflight = fs.readFileSync(path.join(root, 'scripts/phase14-network-development-preflight.sql'), 'utf8');
  const statements = topLevel(preflight);
  assert.match(statements[0].token, /^begin transaction .* read only$/);
  assert.equal(statements.at(-1).token, 'rollback');
  assert.ok(statements.slice(1, -1).every(s => /^(set local|with\b|select\b)/.test(s.token)));
  assert.doesNotMatch(preflight, /\b(?:perform|insert|update|delete|truncate|create|alter|drop)\s+(?:into|table|function|public\.)/i);
  return { status: 'LOCAL_STRUCTURE_PASS_SQL_NOT_EXECUTED',
    modes: ['absent', 'present'], inputs: buildDevelopmentValidation('absent').inputs };
}
module.exports = { buildDevelopmentValidation, check };
if (require.main === module) {
  if (process.argv.includes('--emit-sql')) {
    const mode = process.argv.find(arg => arg.startsWith('--territorial='))?.split('=')[1];
    process.stdout.write(buildDevelopmentValidation(mode).sql);
  } else process.stdout.write(JSON.stringify(check(), null, 2) + '\n');
}
