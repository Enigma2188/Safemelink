'use strict';
// Reads versioned local sources; never connects to a database, creates files or installs tools.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function topLevel(source) {
  let i = 0, start = 0, token = '', quote = null, depth = 0; const statements = [];
  while (i < source.length) {
    if (depth) { if (source.startsWith('/*', i)) { depth++; i += 2; } else if (source.startsWith('*/', i)) { depth--; i += 2; } else i++; continue; }
    if (quote) { if (source.startsWith(quote, i)) { if (quote === "'" && source.startsWith("''", i)) { i += 2; continue; } i += quote.length; quote = null; } else i++; continue; }
    if (source.startsWith('--', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; token += ' '; continue; }
    if (source.startsWith('/*', i)) { depth = 1; i += 2; token += ' '; continue; }
    const dollar = source.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
    if (dollar || source[i] === "'" || source[i] === '"') { quote = dollar?.[0] ?? source[i]; i += quote.length; token += ' BODY '; continue; }
    if (source[i] === ';') { statements.push({ start, end: i + 1, token: token.trim().toLowerCase() }); token = ''; start = ++i; continue; }
    token += source[i++];
  }
  assert.equal(quote, null); assert.equal(depth, 0); assert.equal(token.trim(), ''); return statements;
}
function unwrap(source, end = 'commit') {
  const statements = topLevel(source);
  assert.equal(statements[0].token, 'begin'); assert.equal(statements.at(-1).token, end);
  assert.equal(statements.filter(item => /^(begin|commit|rollback|start transaction)\b/.test(item.token)).length, 2);
  return source.slice(statements[0].end, statements.at(-1).start);
}
function buildLocalValidation() {
  const inputs = ['20260714120000_initial_schema.sql', '20260907120000_network_backend_phase1.sql',
    '20260914122000_network_launch_eligibility.sql', '20261103120000_network_territorial_map_history.sql', '20261107120000_network_event_markers_v2.sql'];
  const sources = inputs.map(file => fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  const profiles = sources[0].match(/create table public\.profiles \([\s\S]*?\n\);/);
  assert.ok(profiles, 'Versioned profiles block missing');
  const eligibility = sources[2].match(/create or replace function public\.network_user_is_eligible\(target_user_id uuid\)[\s\S]*?\$\$;/);
  assert.ok(eligibility, 'Versioned eligibility function missing');
  const nameColumns = unwrap(sources[2]).split('create or replace function public.network_user_is_eligible')[0];
  const fixture = fs.readFileSync(path.join(root, 'scripts/test-network-event-development.sql'), 'utf8');
  const result = `-- LOCAL DISPOSABLE ONLY. Generated from exact local sources, not a deployment package.
begin;
do $$ begin
  if current_user<>'postgres' or current_database() not like 'safemelink_network_v2_disposable_%'
    or current_setting('safemelink.local_validation_ack',true) is distinct from 'LOCAL_DISPOSABLE_NO_REMOTE'
    or current_setting('safemelink.event_test_target',true) is distinct from 'VERIFIED_LOCAL_DISPOSABLE'
    or current_setting('safemelink.event_test_external_review',true) is distinct from 'confirmed-no-side-effects' then
    raise exception 'STOP: operator must verify an isolated local disposable cluster'; end if;
  if to_regclass('public.profiles') is not null or to_regnamespace('auth') is not null or to_regclass('cron.job') is not null then
    raise exception 'STOP: database is not an empty scratch database'; end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis' and n.nspname='extensions') then
    raise exception 'PostGIS must already be available in extensions; no installation performed'; end if;
  if not exists(select 1 from pg_roles where rolname='anon') or not exists(select 1 from pg_roles where rolname='authenticated')
    or not exists(select 1 from pg_roles where rolname='service_role') then raise exception 'Local test roles must already exist'; end if;
end $$;
-- Scratch-only bootstrap; all changes, including these ACLs, roll back.
revoke create on schema public from public;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable set search_path=pg_catalog,pg_temp as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
${profiles[0]}
${nameColumns}
${unwrap(sources[1])}
${eligibility[0]}
${unwrap(sources[3])}
${unwrap(sources[4])}
${unwrap(fixture, 'rollback')}
rollback;
`;
  const statements = topLevel(result);
  assert.equal(statements[0].token, 'begin'); assert.equal(statements.at(-1).token, 'rollback');
  assert.equal(statements.filter(item => /^(begin|commit|rollback|start transaction)\b/.test(item.token)).length, 2);
  assert.doesNotMatch(result, /\b(?:http_post|http_get|pg_notify|dblink|cron\.schedule|net\.http|copy\s+.*program)\b/i);
  return { sql: result, inputs: inputs.map((name, i) => ({ name, sha256: crypto.createHash('sha256').update(sources[i]).digest('hex') })), statements: statements.length };
}
module.exports = { buildLocalValidation, unwrap, topLevel };
if (require.main === module) {
  const bundle = buildLocalValidation();
  if (process.argv.includes('--emit-sql')) process.stdout.write(bundle.sql);
  else process.stdout.write(JSON.stringify({ status: 'PACKAGE_CHECKED_NOT_EXECUTED', statements: bundle.statements, inputs: bundle.inputs }, null, 2) + '\n');
}
