const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = 'supabase/migrations/20261003120000_safety_sos_canonical_v2.sql';
const sql = fs.readFileSync(path, 'utf8');
const body = (name) => {
  const found = sql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`));
  assert.ok(found, name);
  return found[1];
};
let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`STATIC PASS: ${name}`); };
check('incremental transaction, no legacy SOS guard / no scheduler / no replace', () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /create or replace|alter table public\.sos\b|on public\.sos\b|cron\.schedule|net\.http|Deno\.serve/i);
  assert.doesNotMatch(sql, /update public\.safety_sos_operations|insert into public\.safety_sos_operations/);
});
check('empty allowlist; no client can self-enable', () => {
  assert.match(sql, /enabled boolean not null default false/);
  assert.doesNotMatch(sql, /insert into public\.safety_sos_v2_accounts/);
  assert.match(body('safety_sos_v2_lock_account'), /a\.user_id = p_user_id and a\.enabled/);
  assert.equal((sql.match(/enable row level security/g) || []).length, 3);
  assert.match(sql, /public\.safety_watchdog_v2_resolutions from public, anon, authenticated, service_role/);
});
check('common account lock before session before operation before SOS/outbox', () => {
  const core = body('safety_sos_v2_create_or_reuse');
  const ordered = ['perform public.safety_sos_v2_lock_account', 'select w.* into v_session',
    'for v_operation_lock in', 'select j.* into v_operation', 'select s.* into v_sos',
    'insert into public.sos', 'update public.safety_watchdog_outbox'];
  ordered.forEach((text, i) => { assert.ok(core.includes(text)); if (i) assert.ok(core.indexOf(text) > core.indexOf(ordered[i - 1])); });
  for (const name of ['process_safety_watchdog_v2', 'finish_my_sos_v2']) {
    const b = body(name);
    assert.ok(b.indexOf('safety_sos_v2_lock_account') < b.indexOf('for update'));
  }
  assert.match(body('safety_sos_v2_lock_account'), /pg_try_advisory_xact_lock\(hashtextextended\('watchdog-owner:'/);
  assert.match(core, /pg_try_advisory_xact_lock/);
  assert.match(core, /errcode = '40001'/);
});
check('manual derives owner; worker bounded to one account; same core', () => {
  assert.match(body('create_or_reuse_my_sos_v2'), /safety_sos_v2_create_or_reuse\(auth\.uid\(\)/);
  assert.match(body('process_safety_watchdog_v2'), /safety_sos_v2_create_or_reuse\(v_owner/);
  assert.doesNotMatch(body('process_safety_watchdog_v2'), /\bloop\b/);
  assert.match(body('process_safety_watchdog_v2'), /for update skip locked/);
});
check('journal unique operation, multiple operations per SOS, immutable association', () => {
  assert.match(sql, /operation_id uuid primary key/);
  assert.match(sql, /canonical_sos_id uuid not null,/);
  assert.doesNotMatch(sql, /canonical_sos_id uuid not null unique/);
  assert.match(sql, /before update on public\.safety_sos_v2_operations/);
  assert.match(body('safety_sos_v2_create_or_reuse'), /j\.user_id <> p_user_id/);
});
check('replay terminal/missing never resurrects; reuse never updates SOS', () => {
  const b = body('safety_sos_v2_create_or_reuse');
  assert.ok(b.indexOf("'outcome','replayed'") < b.indexOf('insert into public.sos'));
  assert.match(b, /when not found then 'missing'/);
  assert.match(b, /when v_sos\.status in \('open','accepted'\) then 'active' else 'terminal'/);
  assert.match(b, /'status',v_sos\.status/);
  assert.doesNotMatch(b, /update public\.sos\b/);
});
check('ABSORBED not CANCELLED, stable resolution, no late T2', () => {
  const b = body('safety_sos_v2_create_or_reuse');
  assert.match(b, /then 'ESCALATED' else 'ABSORBED'/);
  assert.match(b, /v_session\.operation_id,p_user_id,v_sos\.id,'watchdog','reused_active'/);
  assert.match(body('process_safety_watchdog_v2'), /v_session\.state not in \('ACTIVE','AWAITING_CONFIRMATION'\)/);
  assert.match(body('finish_my_sos_v2'), /public\.close_my_sos\(p_sos_id\)/);
});
check('dispatch only for newly created watchdog SOS, original outbox reused', () => {
  assert.match(body('safety_sos_v2_create_or_reuse'), /p_origin = 'watchdog' and v_result = 'created'/);
  assert.match(body('safety_sos_v2_create_or_reuse'), /insert into public\.safety_watchdog_outbox/);
  assert.doesNotMatch(sql, /update public\.safety_watchdog_deliveries/);
});
check('six secure functions; grants are explicit', () => {
  assert.equal((sql.match(/security definer set search_path = pg_catalog, pg_temp/g) || []).length, 6);
  assert.match(sql, /public\.finish_my_sos_v2\(uuid,text\) to authenticated/);
  assert.match(sql, /public\.process_safety_watchdog_v2\(uuid\) to service_role/);
  assert.doesNotMatch(sql, /grant execute[^;]*safety_sos_v2_create_or_reuse/s);
});
check('development rollback and complete two-connection variants', () => {
  const runtime = fs.readFileSync('scripts/test-safety-sos-v2-development.sql', 'utf8');
  assert.match(runtime, /rollback;\s*$/);
  for (const label of ['Response-lost replay failed', 'Cross-account operation reused', 'Accepted reset', 'Resurrection', 'Late escalation', 'Dispatch dedupe']) assert.ok(runtime.includes(label));
  for (const ending of ['commit', 'rollback']) assert.match(fs.readFileSync(`scripts/safety-sos-v2-concurrency-a-${ending}.sql`, 'utf8'), new RegExp(`${ending};\\s*$`));
  for (const tab of ['a', 'b']) {
    const lockTest = fs.readFileSync(`scripts/safety-sos-v2-lock-order-${tab}.sql`, 'utf8');
    assert.match(lockTest, /when serialization_failure/);
    assert.match(lockTest, /rollback;\s*$/);
  }
  const b = fs.readFileSync('scripts/safety-sos-v2-concurrency-b.sql', 'utf8');
  assert.match(b, /when serialization_failure/);
  assert.match(b, /commit;\s*select pg_sleep\(18\);\s*begin;/);
  const setup = fs.readFileSync('scripts/safety-sos-v2-concurrency-setup.sql', 'utf8');
  for (const scenario of ['manual_first', 'watchdog_first', 'same_operation', 'different_operations', 'cross_account', 'closure_first']) assert.ok(setup.includes(scenario));
});
check('Android/app and already applied Phase 7B migration untouched', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'app', 'services', 'backend', 'modules',
    '.github', 'supabase/functions', 'supabase/migrations/20260928120000_safety_watchdog.sql'], { encoding: 'utf8' });
  assert.equal(changed.trim(), '');
});
console.log(`PASS: ${passed} Phase 7C static checks. NOT a PostgreSQL/concurrency runtime certification.`);
