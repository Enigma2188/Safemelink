'use strict';
// Local contract/structural tests; NOT PostgreSQL execution or anonymity certification.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root,
  'supabase/migrations/20261103120000_network_territorial_map_history.sql'), 'utf8');
const fixture = fs.readFileSync(path.join(root,
  'scripts/test-network-territorial-development.sql'), 'utf8');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
const functions = [...sql.matchAll(/create function public\.(\w+)\([\s\S]*?\$\$;\s*/g)].map(m => m[0]);
check('only additive names; no legacy writes, triggers, transport or activation', () => {
  assert.equal(functions.length, 8);
  assert.doesNotMatch(sql, /create or replace|alter table public\.(?:network_reports|sos)\b|\b(?:cron\.|net\.|http_|pg_notify|execute\s+format|insert into|update public\.|delete from)\b/i);
  assert.doesNotMatch(sql, /\b(?:sos|phone|email|latitude_private)\b/i);
  assert.match(sql, /enabled boolean not null default false/);
  assert.doesNotMatch(sql, /interval '6 months'/);
});
check('RLS and direct table access denied for every new table', () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  assert.equal(tables.length, 7);
  for (const table of tables) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security;`));
    assert.ok(sql.slice(sql.indexOf('revoke all on table')).includes(`public.${table}`));
  }
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /from public, anon, authenticated;/);
});
check('definers and invoker trigger pin search_path; helpers not granted to client', () => {
  for (const fn of functions) {
    assert.match(fn, /set search_path = pg_catalog, pg_temp/);
    if (!fn.includes('returns trigger')) assert.match(fn, /security definer/);
    else assert.doesNotMatch(fn, /security definer/);
  }
  const authenticatedGrant = sql.slice(sql.lastIndexOf('grant execute on function'));
  assert.doesNotMatch(authenticatedGrant, /network_map_(?:candidates|canonical_zone|require_access|publication_safe)_v2|network_history_invalidate_review_v2/);
  assert.match(sql, /actor is null/);
  assert.match(sql, /network_user_is_eligible\(actor\)/);
  assert.match(sql, /m\.user_id=actor/);
  assert.match(sql, /m\.revoked_at is null and m\.valid_until>now\(\)/);
});
check('public RPC DTOs exclude source identifiers, raw counts and authors', () => {
  for (const fn of functions.filter(f => /create function public\.(get_network|list_network)/.test(f))) {
    const keys = [...fn.matchAll(/'([A-Za-z]+)'\s*,/g)].map(m => m[1]);
    for (const key of keys) assert.doesNotMatch(key, /author|userId|reportId|source|phone|email|contributor|reportCount/i);
  }
  assert.match(sql, /r\.public_location::extensions\.geometry/);
  assert.doesNotMatch(sql, /r\.location\b/);
});
check('privacy release is fail-closed, reviewed, linked and expiring', () => {
  for (const guard of ["p.state='APPROVED'", 'p.policy_version=t.policy_version',
    'p.report_count>=t.min_reports', 'p.contributor_count>=t.min_contributors',
    'count(*)=p.report_count', 'count(distinct r.author_user_id)=p.contributor_count',
    's.revoked_at is null', 'p.valid_until>now()', 'disclosure_review_ref',
    'controller_approval_ref', 'retention_decision_ref', 'privacy_review_ref']) assert.ok(sql.includes(guard), guard);
  assert.match(sql, /INSUFFICIENT_DATA/);
  assert.match(sql, /radius_meters not in \(1000,2500,5000,10000\)/);
  assert.match(sql, /other\.period_start<>p\.period_start/);
});
check('history binds the actual cohort, month, category and canonical zone', () => {
  assert.match(sql, /source_report_id uuid not null references public.network_map_sources_v2\(report_id\) on delete cascade/);
  assert.match(sql, /h\.state='APPROVED'/);
  assert.match(sql, /r\.status in \('RESOLVED','EXPIRED'\)/);
  assert.match(sql, /network_map_publication_safe_v2\(p.id\)/);
  assert.match(sql, /public_month date not null check/);
  assert.match(sql, /link\.report_id=h\.source_report_id/);
  assert.match(sql, /p\.territory_id=h\.territory_id and p\.zone_id=h\.zone_id/);
  assert.match(sql, /h\.category=r\.category/);
  assert.match(sql, /h\.public_month=date_trunc\('month',r\.created_at at time zone 'UTC'\)::date/);
  assert.match(sql, /z\.id=public\.network_map_canonical_zone_v2\(t\.id,r\.id,z\.level_code\)/);
});
check('canonical geometry is shared by candidates, publications and history', () => {
  assert.match(sql, /order by z\.zone_code collate "C",z\.id limit 1/);
  assert.match(sql, /z\.level_code=target_level/);
  assert.match(sql, /z\.id=public\.network_map_canonical_zone_v2\(t\.id,r\.id,target_level\)/);
  assert.equal((sql.match(/z\.id=public\.network_map_canonical_zone_v2\(t\.id,r\.id,z\.level_code\)/g)||[]).length,2);
  assert.match(sql, /network_map_zones_v2_geography_idx[\s\S]*?geometry::extensions\.geography/);
});
check('history filters BEFORE keyset page limit and edits invalidate approval', () => {
  const historyFn=functions.find(f=>f.startsWith('create function public.list_network_zone_history_v2'));
  assert.ok(historyFn.indexOf("h.state='APPROVED'") < historyFn.indexOf('limit (page_size+1)'));
  assert.ok(historyFn.indexOf('link.report_id=h.source_report_id') < historyFn.indexOf('limit (page_size+1)'));
  assert.match(historyFn, /\(h\.public_month,h\.id\)<\(cursor_month,cursor_entry\)/);
  assert.match(historyFn, /order by h\.public_month desc,h\.id desc limit \(page_size\+1\)/);
  assert.match(historyFn, /'nextCursor'/);
  assert.match(sql, /create trigger network_history_invalidate_review_v2 before update on public.network_history_entries_v2/);
  for(const guard of ["new.state := 'DRAFT'",'new.reviewed_at := null',
    'new.disclosure_review_ref := null','new.revision := old.revision+1']) assert.ok(sql.includes(guard));
});
check('synthetic PostgreSQL script is not run here; one rollback transaction', () => {
  const stripped = fixture.replace(/--[^\n]*/g, '');
  assert.equal((stripped.match(/^begin;/gmi) || []).length, 1);
  assert.equal((stripped.match(/^rollback;/gmi) || []).length, 1);
  assert.doesNotMatch(stripped, /\bcommit\b|\bpublic\.sos\s*\(|send-sos|prepare_sos_delivery|\bnet\./i);
  assert.ok(stripped.trim().endsWith('rollback;'));
  assert.match(fixture, /IS DISTINCT FROM/);
  assert.match(fixture,/set local role authenticated/);
  for(const scenario of ['POSITIVE: valid publication rejected','Foreign history leaked',
    'Noncanonical boundary publication accepted','Nonpilot account accepted','Foreign territory access accepted',
    'Revoked pilot member accepted','Revoked source published','Limited report published',
    'Content correction preserved stale approval','Pagination duplicate/missing entry',
    'Wrong-zone source accepted in cohort','Wrong-period source accepted in cohort',
    'Withdrawn history leaked','Foreign territory source published']) assert.ok(fixture.includes(scenario),scenario);
  assert.match(fixture, /network_test_project_ref/);
  assert.match(fixture, /network_test_triggers_reviewed/);
});
check('migration is one additive deployment transaction; fixture is a separate rollback test', () => {
  const stripped = sql.replace(/--[^\n]*/g, '');
  assert.equal((stripped.match(/^begin;/gmi) || []).length, 1);
  assert.equal((stripped.match(/^commit;/gmi) || []).length, 1);
  assert.equal((stripped.match(/\$\$/g) || []).length, 16);
  assert.ok(stripped.trim().endsWith('commit;'));
  for (const name of [
    'supabase/migrations/20261103120000_network_territorial_map_history.sql',
    'scripts/test-network-territorial-development.sql',
    'scripts/test-network-territorial-backend.cjs',
    'NETWORK_TERRITORIAL_BACKEND_V2.md',
  ]) {
    const content = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(content, /[\t ]+\r?$/m, `${name}: trailing whitespace`);
  }
});
console.log(`${checks} local contract checks PASS; PostgreSQL/runtime/privacy review NOT executed.`);
