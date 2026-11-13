'use strict';
// Local source/contract assertions only. NOT a PostgreSQL parser/runtime/security proof.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261107120000_network_event_markers_v2.sql'), 'utf8');
const testSql = fs.readFileSync(path.join(root, 'scripts/test-network-event-development.sql'), 'utf8');
// Lexer separates comments, quoted strings and dollar bodies; transaction assertions
// below operate on actual top-level statements, not comments or PL/pgSQL BEGIN blocks.
function statements(source) {
  let out = '', i = 0, quote = null, blockDepth = 0; const result = [];
  while (i < source.length) {
    if (blockDepth) { if (source.startsWith('/*', i)) { blockDepth++; i += 2; } else if (source.startsWith('*/', i)) { blockDepth--; i += 2; } else i++; continue; }
    if (quote) {
      if (source.startsWith(quote, i)) {
        if (quote === "'" && source.startsWith("''", i)) { i += 2; continue; }
        i += quote.length; quote = null;
      } else i++;
      continue;
    }
    if (source.startsWith('--', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; out += ' '; continue; }
    if (source.startsWith('/*', i)) { blockDepth = 1; i += 2; out += ' '; continue; }
    const dollar = source.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
    if (dollar || source[i] === "'" || source[i] === '"') { quote = dollar?.[0] ?? source[i]; i += quote.length; out += ' BODY '; continue; }
    if (source[i] === ';') { if (out.trim()) result.push(out.trim()); out = ''; i++; continue; }
    out += source[i++];
  }
  assert.equal(quote, null, 'unterminated quoted/dollar body'); assert.equal(blockDepth, 0, 'unterminated block comment');
  assert.equal(out.trim(), '', 'statement missing final semicolon'); return result;
}
const functions = [...sql.matchAll(/create function public\.(\w+)\([\s\S]*?\$\$;/g)].map(match => ({ name: match[1], sql: match[0] }));
const fn = name => { const found = functions.find(item => item.name === name); assert.ok(found, name); return found.sql; };
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };
test('additive migration and isolated rollback test have coherent lexical transaction structure', () => {
  const migration = statements(sql), fixture = statements(testSql);
  assert.equal(migration[0].toLowerCase(), 'begin'); assert.equal(migration.at(-1).toLowerCase(), 'commit');
  assert.equal(migration.filter(s => /^(begin|commit|rollback)\b/i.test(s)).length, 2);
  assert.equal(fixture[0].toLowerCase(), 'begin'); assert.equal(fixture.at(-1).toLowerCase(), 'rollback');
  assert.equal(fixture.filter(s => /^(begin|commit|rollback)\b/i.test(s)).length, 2);
  assert.doesNotMatch(sql, /create or replace|\bdrop\s+(?:table|function)|\btruncate\b|\bdelete\s+from|\bcreate\s+extension/i);
  for (const file of [sql, testSql]) assert.doesNotMatch(file, /\b(?:http_post|http_get|pg_notify|dblink|net\.http|cron\.schedule|send_sos|prepare_sos_delivery)\b/i);
  assert.doesNotMatch(sql, /(?:insert into|update|alter table) public\.(?:network_reports|sos|profiles|network_preferences|network_config)\b/i);
});
test('five private tables use RLS, no public policies, no client table grants; helpers are not public RPCs', () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]); assert.equal(tables.length, 5);
  for (const table of tables) assert.ok(sql.includes(`alter table public.${table} enable row level security;`));
  assert.doesNotMatch(sql, /create policy|grant .*on table .*to authenticated/i);
  assert.match(sql, /from public, anon, authenticated, service_role;/);
  const client = sql.slice(sql.lastIndexOf('grant execute on function public.create_network_event_v2'), sql.lastIndexOf('grant execute on function public.review_network_event_v2'));
  assert.doesNotMatch(client, /review_network|review_queue|network_event_(?:take_|marker_json|is_public|require_access)/);
  for (const item of functions) assert.match(item.sql, /set search_path=pg_catalog,pg_temp/);
  assert.match(sql, /current_user <> 'postgres'/);
  assert.match(sql, /has_schema_privilege\('authenticated','public','CREATE'\) is distinct from false/);
  assert.match(sql, /has_schema_privilege\('anon','extensions','CREATE'\) is distinct from false/);
});
test('manual event provenance, server generalization, territory/zone clipping; raw chosen point never persisted', () => {
  const create = fn('create_network_event_v2');
  assert.match(create, /location_selection is distinct from 'EXPLICIT_EVENT_POINT'/);
  assert.match(create, /st_covers\(territory.boundary,chosen\)/);
  assert.match(create, /order by z.zone_code,z.id limit 1 for share/);
  assert.match(create, /st_collectionextract\(extensions.st_intersection/);
  assert.match(create, /st_area\(footprint\)<policy.min_cell_area_m2/);
  assert.match(create, /st_transform\(extensions.st_pointonsurface\(footprint\),4326\)/);
  const insert = create.slice(create.indexOf('insert into public.network_events_v2'));
  assert.match(insert, /body,public_point/); assert.doesNotMatch(insert, /\bchosen\b|event_latitude|event_longitude/);
  assert.doesNotMatch(create, /last_position|last_online|location_accuracy|network_reports/);
  assert.match(sql, /enabled boolean not null default false/);
  assert.match(sql, /required_terms_version/); assert.match(sql, /privacy_approval_ref/); assert.match(sql, /retention_decision_ref/);
});
test('creation serialized per actor; atomic quotas/replay, no terminal reactivation or TTL extension', () => {
  const create = fn('create_network_event_v2');
  assert.match(create, /pg_advisory_xact_lock\(hashtextextended\(actor::text,7011\)\)/);
  assert.match(sql, /unique \(author_user_id,operation_id\)/);
  assert.match(create, /old_event.request_payload is distinct from payload/);
  assert.ok(create.indexOf("'replayed',true") < create.indexOf('perform public.network_event_take_write_v2'));
  assert.match(fn('network_event_take_write_v2'), /on conflict\(user_id\) do update/);
  assert.match(fn('network_event_take_read_v2'), /where b.bucket_start<excluded.bucket_start or b.requests<max_reads/);
  assert.match(fn('network_event_guard_update_v2'), /old.status='RESOLVED'/);
  assert.match(fn('network_event_guard_update_v2'), /old.moderation_state='WITHDRAWN'/);
  assert.match(fn('network_event_guard_update_v2'), /new.expires_at>old.expires_at/);
  const guard = fn('network_event_guard_update_v2');
  assert.ok(guard.indexOf("new.moderation_state:='PENDING'") < guard.indexOf("old.moderation_state='WITHDRAWN'"));
  assert.match(guard, /greatest\(old.updated_at,clock_timestamp\(\)\)/);
  assert.match(fn('review_network_event_v2'), /event.revision<>expected_revision/);
  assert.match(fn('finish_my_network_event_v2'), /author_user_id=actor/);
});
test('final read rechecks current policy, reader, author restrictions, expiration and public geometry', () => {
  const visibility = fn('network_event_is_public_v2');
  for (const fragment of ["event.moderation_state='APPROVED'", 'event.expires_at>statement_timestamp()', 'event.purge_after>statement_timestamp()',
    'public.network_user_is_eligible(auth.uid()) is true', "public.network_user_is_restricted(auth.uid(),'read') is false",
    "public.network_user_is_restricted(event.author_user_id,'publish') is false", 'p.enabled', "p.access_mode='NETWORK'", 'm.revoked_at is null']) assert.ok(visibility.includes(fragment), fragment);
  assert.match(fn('get_network_event_detail_v2'), /from public.network_events_v2 e where e.public_id=target_public_id and public.network_event_is_public_v2\(e,policy\)/);
  const list = fn('list_network_event_markers_v2');
  assert.match(list, /st_dwithin\(n.public_position::extensions.geography/);
  assert.match(list, /limit 2001/); assert.match(list, /jsonb_array_length\(result\)>2000/);
  assert.match(list, /return result;/); // bare complete array, controller-compatible; never partial page.
});
function splitArguments(source) {
  const values = []; let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "'") { if (quoted && source[i + 1] === "'") { i++; continue; } quoted = !quoted; }
    if (quoted) continue;
    if (source[i] === '(') depth++; if (source[i] === ')') depth--;
    if (source[i] === ',' && depth === 0) { values.push(source.slice(start, i).trim()); start = i + 1; }
  }
  assert.equal(depth, 0); assert.equal(quoted, false); values.push(source.slice(start).trim()); return values;
}
test('SQL marker serializer has exact V2 public keys and UTC millisecond dates; history/legacy remain separate', () => {
  const serializer = fn('network_event_marker_json_v2');
  const body = serializer.match(/select jsonb_build_object\(([\s\S]*)\);\s*\$\$;/)[1];
  const args = splitArguments(body); assert.equal(args.length % 2, 0);
  const keys = args.filter((_item, i) => i % 2 === 0).map(item => { assert.match(item, /^'\w+'$/); return item.slice(1, -1); });
  assert.deepEqual(keys.sort(), ['schemaVersion','publicId','territoryId','zoneId','kind','categoryId','status','publicPosition','locationPolicyVersion','revision','validUntil','createdAt','updatedAt','resolvedAt'].sort());
  assert.match(serializer, /'schemaVersion',2/); assert.match(serializer, /'GENERALIZED_EVENT_POINT'/);
  assert.match(serializer, /SS.MS"Z"/); assert.match(serializer, /at time zone 'UTC'/);
  assert.doesNotMatch(serializer, /author_user_id|author_nickname|operation_id|request_payload|phone|email/);
  assert.doesNotMatch(sql, /insert into public.network_history|update public.network_map_|insert into public.network_map_sources/);
  const registry = fs.readFileSync(path.join(root, 'services/NetworkCategoryRegistryV2.ts'), 'utf8');
  const ids = [...registry.matchAll(/^  '([A-Z_]+)',?$/gm)].map(m => m[1]); assert.equal(ids.length, 5);
  for (const id of ids) assert.ok(sql.includes(`'${id}'`));
});
test('synthetic SQL assertions are fail-closed, default blocked, no real recipients or transport', () => {
  assert.match(testSql, /event_test_target/); assert.match(testSql, /event_test_external_review/);
  assert.match(testSql, /@example.invalid/); assert.doesNotMatch(testSql, /\bcommit\b/i);
  assert.ok((testSql.match(/is distinct from/g) ?? []).length > 25);
  for (const expected of ['Missing identity accepted', 'Operation payload conflict', 'Cross-owner withdrawal', 'Stale review', 'Unreviewed event leaked',
    'Expired marker exposed', 'Replay reactivated', 'Publication quota', 'Read quota', 'Non-member pilot']) assert.ok(testSql.includes(expected), expected);
});
console.log(`${passed} local structural checks PASS. PostgreSQL syntax/runtime, RLS/JWT and concurrency NOT executed or certified.`);
