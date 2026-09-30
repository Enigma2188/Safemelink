const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sql = fs.readFileSync('supabase/migrations/20260928120000_safety_watchdog.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/_shared/safetyWatchdogWorker.ts', 'utf8');
const body = (name) => {
  const match = sql.match(new RegExp(`function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`));
  assert.ok(match, name);
  return match[1];
};
const check = (label, fn) => { fn(); console.log(`STATIC PASS: ${label}`); };
check('owner gates start/read/confirm/cancel', () => {
  for (const name of ['start', 'get', 'confirm', 'cancel']) assert.match(body(`${name}_my_safety_watchdog`), /auth\.uid\(\)/);
  for (const name of ['get', 'confirm', 'cancel']) assert.match(body(`${name}_my_safety_watchdog`), /s\.user_id = auth\.uid\(\)/);
});
check('duplicate start returns old session, including terminal state', () => {
  assert.match(body('start_my_safety_watchdog'), /s\.request_id = p_request_id/);
  assert.match(sql, /unique \(user_id, request_id\)/);
  assert.match(body('start_my_safety_watchdog'), /return v_row;.*Even a terminal/);
});
check('one active session enforced by unique partial index', () => assert.match(sql, /unique index[\s\S]*?on public\.safety_watchdog_sessions\(user_id\) where state in \('ACTIVE', 'AWAITING_CONFIRMATION'\)/));
check('generation guard + common cancel/confirm/escalation row lock', () => {
  for (const name of ['confirm', 'cancel']) {
    assert.match(body(`${name}_my_safety_watchdog`), /p_generation is null or p_generation <> v_row\.generation/);
    assert.match(body(`${name}_my_safety_watchdog`), /for update/);
  }
  assert.match(body('process_due_safety_watchdogs'), /for update skip locked/);
});
check('valid/late confirmation uses clock after lock, irrespective of cron', () => {
  const b = body('confirm_my_safety_watchdog');
  assert.ok(b.indexOf('for update') < b.indexOf('v_now := clock_timestamp()'));
  assert.match(b, /v_now < v_row\.next_check_at or v_now >= v_row\.confirmation_deadline_at/);
});
check('cancel deadline + terminal protection', () => assert.match(body('cancel_my_safety_watchdog'), /v_row\.state not in \('ACTIVE', 'AWAITING_CONFIRMATION'\) or v_now >= v_row\.confirmation_deadline_at/));
check('repeat preserves session and advances one generation, finite completion', () => {
  const b = body('confirm_my_safety_watchdog');
  assert.match(b, /s\.repeat_completed \+ 1 = s\.repeat_total then 'COMPLETE' else 'ACTIVE'/);
  assert.match(b, /else s\.generation \+ 1/);
  assert.doesNotMatch(b, /insert into public\.safety_watchdog_sessions/);
  assert.match(sql, /repeat_total between 1 and 10/);
});
check('T1/T2 anchored, server time only, no client deadline argument', () => {
  assert.match(sql, /confirmation_deadline_at = next_check_at \+ interval '30 seconds'/);
  assert.match(body('process_due_safety_watchdogs'), /v_now >= v_row\.confirmation_deadline_at/);
  assert.match(body('start_my_safety_watchdog'), /v_now \+ make_interval\(mins => p_duration_minutes\)/);
  assert.doesNotMatch(sql.match(/function public.start_my_safety_watchdog\((.*?)\)/s)[1], /timestamptz|deadline|user_id/);
});
check('atomic idempotent SOS with original tombstone and advisory namespace', () => {
  const b = body('process_due_safety_watchdogs');
  assert.match(b, /pg_advisory_xact_lock\(hashtextextended\(v_row.operation_id::text, 0\)\)/);
  assert.match(b, /insert into public\.safety_sos_operations/);
  assert.match(b, /values\(v_row.operation_id, v_row.user_id, null, null, null, null\)/);
  assert.match(b, /state = 'ESCALATED', sos_id = v_row.operation_id/);
  assert.doesNotMatch(b, /http|net\.|auth\.uid|set_config/);
});
check('outbox dedup, bounded leases/retries, unknown never reclaimed', () => {
  assert.match(sql, /unique\(session_id, generation, kind\)/);
  assert.match(body('claim_safety_watchdog_outbox'), /o\.state in \('PENDING', 'CLAIMED'\)/);
  assert.match(body('claim_safety_watchdog_outbox'), /o\.attempts < 5/);
  assert.match(sql, /then 'UNKNOWN' else 'FAILED'/);
});
check('processor bounded/indexed and per-session error rollback/backoff', () => {
  assert.match(sql, /p_limit not between 1 and 500/);
  assert.match(sql, /limit p_limit for update skip locked/);
  assert.match(sql, /greatest\(s.retry_after, case/);
  assert.match(sql, /exception when others then/);
  assert.match(sql, /least\(10, s.processor_failures \+ 1\)/);
});
check('RLS, no direct access, fixed search paths, restricted internal grants', () => {
  assert.equal((sql.match(/enable row level security/g) ?? []).length, 3);
  assert.equal((sql.match(/security definer set search_path = pg_catalog, pg_temp/g) ?? []).length, 11);
  assert.match(sql, /revoke all on public.safety_watchdog_sessions, public.safety_watchdog_outbox from public, anon, authenticated, service_role/);
  assert.match(sql, /revoke all on function public.process_due_safety_watchdogs[\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public.process_due_safety_watchdogs[\s\S]*?to service_role/);
});
check('no sensitive metadata in watchdog schema or worker logs', () => {
  assert.doesNotMatch(sql.split('create or replace function')[0], /latitude|longitude|phone|token|audio|nickname/);
  assert.doesNotMatch(worker, /console\./);
  assert.doesNotMatch(worker, /Deno\.serve|auth\.getUser/);
});
check('7B validation artifacts: read-only catalogs and rollback runtime', () => {
  for (const path of ['scripts/check-safety-watchdog-scheduler.sql','scripts/verify-safety-watchdog-post-migration.sql']) {
    const query = fs.readFileSync(path,'utf8').replace(/--[^\n]*/g,'');
    assert.doesNotMatch(query, /\b(insert\s+into|update\s+public|delete\s+from|create\s+(table|function)|(select|perform)\s+cron\.schedule\s*\()/i);
  }
  assert.match(fs.readFileSync('scripts/test-safety-watchdog-development.sql','utf8'), /rollback;\s*$/i);
  assert.match(fs.readFileSync('IOS_PHASE7B_VALIDATION.md','utf8'), /BLOCKER OPEN/);
  assert.doesNotMatch(sql, /create\s+(?:unique\s+)?index[^;]*on public\.sos\b|create\s+trigger/i);
});

async function testWorker({ kind = 'SOS_DISPATCH', tokens = 1, failBatch = -1, noClaim = false } = {}) {
  const calls = []; let claimed = false; let batchCount = 0; const pending = [];
  const event = { id: 'event', kind, sessionId: 'session', generation: 1, mode: 'CHECKPOINT', ownerId: 'owner', sosId: 'sos', deadline: new Date(Date.now() + 30000).toISOString() };
  const db = { rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'claim_safety_watchdog_outbox') { const data = claimed ? null : event; claimed = true; return { data }; }
    if (name === 'claim_sos_push_dispatch') return { data: noClaim ? 'attempt_in_progress' : 'claimed' };
    if (name === 'stage_safety_watchdog_deliveries') {
      pending.push(...args.p_hashes.map((recipientHash, i) => ({ ...event, deliveryId: `delivery-${i}`, recipientHash })));
    }
    if (name === 'claim_safety_watchdog_delivery') return { data: pending.shift() ?? null };
    return { data: true };
  } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(worker, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: module.exports, module,
    require: () => ({ getActiveRecipientTokens: async () => ({ recipientTokens: Array.from({ length: tokens }, (_, i) => ({ token: `ExpoPushToken[test_${i}]` })) }) }),
    crypto: require('node:crypto').webcrypto, TextEncoder, AbortController, setTimeout, clearTimeout, Date, fetch,
  });
  const result = await module.exports.runSafetyWatchdogOutbox(db, undefined, async (_url, init) => {
    const batch = batchCount++;
    if (batch === failBatch) throw new Error('transport unavailable');
    return { ok: true, json: async () => ({ data: JSON.parse(init.body).map(() => ({ status: 'ok' })) }) };
  });
  return { result, calls, batchCount };
}
(async () => {
  const ok = await testWorker(); assert.equal(ok.result.accepted, 1);
  assert.ok(ok.calls.some(([n]) => n === 'reconcile_safety_watchdog_deliveries'));
  const partial = await testWorker({ tokens: 3, failBatch: 0 });
  assert.equal(partial.batchCount, 3); assert.equal(partial.result.uncertain, 1);
  assert.equal(partial.result.accepted, 2);
  assert.ok(partial.calls.some(([n,a]) => n === 'finish_safety_watchdog_delivery' && a.p_action === 'unknown'));
  const empty = await testWorker({ tokens: 0 }); assert.equal(empty.batchCount, 0);
  assert.ok(empty.calls.some(([n]) => n === 'release_sos_push_dispatch'));
  const blocked = await testWorker({ noClaim: true }); assert.equal(blocked.batchCount, 0);
  assert.match(sql, /unique\(event_id,recipient_hash\)/);
  assert.match(body('claim_safety_watchdog_delivery'), /d.state in \('PENDING','CLAIMED'\)/);
  assert.match(body('finish_safety_watchdog_delivery'), /d.state='ATTEMPTED'/);
  assert.match(sql, /mode <> 'CHECKPOINT' or duration_minutes <= 779/);
  assert.match(sql, /duration_minutes between 1 and 10080/);
  console.log('MOCKED WORKER PASS: accepted / independent durable sends / no tokens / existing uncertain attempt');
  console.log('SQL RUNTIME: NOT EXECUTED — REQUIRES DEVELOPMENT DATABASE VALIDATION');
})().catch((error) => { console.error(error); process.exitCode = 1; });
