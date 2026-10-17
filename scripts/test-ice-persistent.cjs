const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
const sql = read('supabase/migrations/20261016120000_ice_persistent_revocation.sql');
const strip = value => value.replace(/--[^\n]*/g, '');
const body = name => {
  const match = sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, name); return match[1];
};
assert.match(sql, /^begin;/);
assert.match(sql, /commit;\s*$/);
assert.equal((strip(sql).match(/^commit;/gmi) || []).length, 1);
assert.match(sql, /force row level security/);
assert.match(sql, /revoke all on table public\.ice_privacy_control from public,anon,authenticated,service_role/);
assert.match(body('_ice15_lock'), /auth\.uid\(\) is distinct from expected_owner_id/);
assert.match(body('_ice15_lock'), /pg_advisory_xact_lock\(hashtextextended\('safemelink:ice:'/);
assert.match(body('_ice15_read_guard'), /transaction_isolation[\s\S]*read committed/);
for (const name of ['get_my_emergency_profile', 'update_my_emergency_profile', 'update_my_emergency_private_details',
  'delete_my_emergency_private_details', 'revoke_my_all_ice_sharing', 'confirm_my_ice_sharing']) {
  const value = body(name);
  assert.match(value, /perform public\._ice15_lock\(/, name);
  assert.ok(value.indexOf('perform public._ice15_lock(') < value.search(/return query|insert into|update public|perform public\._ice15_delete_private|return public\._ice15_update_private/), name);
}
for (const name of ['get_legacy', 'update_legacy', 'received_legacy', 'get_private', 'update_private', 'delete_private', 'received_private']) {
  assert.match(sql, new RegExp(`revoke all on function public\\._ice15_${name}\\([^;]*from public,anon,authenticated,service_role;`));
  assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\._ice15_${name}`));
}
for (const name of ['get_received_sos_emergency_profile', 'get_received_sos_private_details']) {
  assert.match(body(name), /_ice15_read_guard/);
  assert.match(body(name), /blocked/); assert.match(body(name), /_ice15_received_/);
}
assert.match(body('update_my_emergency_profile'), /c\.blocked or not c\.legacy_allowed/);
assert.match(body('update_my_emergency_private_details'), /not c\.phone_allowed/);
assert.match(body('confirm_my_ice_sharing'), /actual_revision<>expected_revision[\s\S]*40001/);
assert.match(body('confirm_my_ice_sharing'), /legacy_allowed=enable_legacy,structured_allowed=enable_structured/);
assert.doesNotMatch(body('revoke_my_all_ice_sharing'), /\bdelete\b|\bice_contact\s*=|\bice_phone\s*=|\bshare_safety\s*=/i);
assert.doesNotMatch(body('delete_my_emergency_private_details').replace(/--[^\n]*/g, ''), /delete.*ice_privacy_control/i);
assert.match(sql, /Unexpected ICE overload/); assert.match(sql, /Review stored dependencies/);
console.log('PASS STATIC: per-owner lock on every writer, channel-scoped policy, helper denial, explicit ACL and safe search paths');

// Specification model ONLY: not PostgreSQL, locks, grants or transaction execution.
function model() {
  let state = { blocked: false, revision: 0, allowed: [true, true, true], shared: [true, true, true], text: 'retained' };
  return {
    snapshot: () => structuredClone(state),
    restore: value => { state = value; },
    revoke: () => { state.blocked = true; state.revision++; state.allowed = [false, false, false]; state.shared = [false, false, false]; },
    legacy: () => { if (state.blocked || !state.allowed[0]) throw new Error('42501'); state.shared[0] = true; },
    confirm: (revision, allowed) => { if (revision !== state.revision) throw new Error('40001');
      if (allowed[2] && !allowed[1]) throw new Error('22023');
      state.blocked = false; state.revision++; state.allowed = [...allowed]; state.shared = [...allowed]; },
  };
}
for (const first of ['writer', 'revoker', 'confirmation']) {
  const m = model();
  if (first === 'writer') { m.legacy(); m.revoke(); }
  if (first === 'revoker') { m.revoke(); assert.throws(m.legacy, /42501/); assert.throws(() => m.confirm(0, [true, false, false]), /40001/); }
  if (first === 'confirmation') { m.revoke(); m.confirm(1, [false, true, false]); assert.throws(m.legacy, /42501/); m.revoke(); }
  assert.deepEqual(m.snapshot().shared, [false, false, false]); assert.equal(m.snapshot().text, 'retained');
  const before = m.snapshot(); m.revoke(); m.restore(before); assert.deepEqual(m.snapshot(), before);
}
console.log('PASS MODEL ONLY: both serialized orders, stale consent rejection, channel scope and rollback specification');

const exportsValue = {};
vm.runInNewContext(ts.transpileModule(read('services/ICEPrivacyService.ts'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports: exportsValue, require: name => {
  assert.ok(['@/backend/supabaseClient', '@/backend/remoteRequest'].includes(name)); return {};
}, Date, Number });
const status = extra => ({ owner_id: 'A', verified_at: '2026-10-16T10:00:00Z', legacy_shared: false,
  legacy_text_present: true, structured_shared: false, phone_shared: false, safety_shared: true, ...extra });
assert.equal(exportsValue.parseICEPrivacyStatus(status(), 'A').ice_blocked, undefined);
const blocked = status({ ice_blocked: true, ice_revision: '9007199254740993', consent_version: null });
assert.equal(exportsValue.parseICEPrivacyStatus(blocked, 'A').ice_revision, '9007199254740993');
assert.match(exportsValue.describeICEPrivacy(blocked), /revoca ICE risultava protetta/);
for (const extra of [{ legacy_shared: true }, { structured_shared: true }, { ice_revision: null },
  { ice_revision: '-1' }, { ice_revision: 1 }, { consent_version: 'future' }, { ice_blocked: null }])
  assert.throws(() => exportsValue.parseICEPrivacyStatus({ ...blocked, ...extra }, 'A'));
assert.throws(() => exportsValue.parseICEPrivacyStatus(blocked, 'B'));
const panel = read('components/ICEPrivacyPanel.tsx');
assert.match(panel, /result\.ice_blocked === true/);
assert.match(panel, /riattivazione con nuovo consenso esplicito non è ancora disponibile/);
assert.doesNotMatch(panel, /\.rpc\('confirm_my_ice_sharing'/);
console.log('PASS ACTUAL CLIENT: old backend remains unprotected, block metadata validated, malformed/cross-account results rejected');

const sequential = read('scripts/test-ice-persistent-development.sql');
assert.match(sequential, /verified_ref text:=null; workers_stopped boolean:=false/);
assert.match(sequential, /rollback;\s*$/);
assert.doesNotMatch(strip(sequential).replace(/on commit drop/gi, ''), /\bcommit\b/i);
assert.match(sequential, /Synthetic rejection/); assert.match(sequential, /Control revision survived failed transaction/);
assert.match(sequential, /is distinct from true/); assert.match(sequential, /Internal helper accessible/);
const setup = read('scripts/ice15-concurrency-setup.sql');
assert.match(setup, /verified_ref text:=null; workers_stopped boolean:=false/);
assert.match(setup, /Existing fixture: inspect, never overwrite/);
for (const scenario of ['writer_first', 'revoker_first', 'consent_first', 'stale_consent', 'missing_row']) assert.ok(setup.includes(scenario));
const b = read('scripts/ice15-concurrency-b.sql');
assert.match(b, /exception when lock_not_available then null/);
assert.match(b, /BLOCKER: overlap not observed/);
assert.equal((b.match(/^begin;/gm) || []).length, 2);
assert.equal((b.match(/^commit;/gm) || []).length, 2);
const cleanup = read('scripts/ice15-concurrency-verify-cleanup.sql');
assert.match(cleanup, /u\.id=f\.owner_id and u\.email='ice15-concurrency-'/);
assert.match(cleanup, /contention_verified is distinct from true/);
for (const file of ['scripts/test-ice-persistent-development.sql', 'scripts/ice15-concurrency-setup.sql',
  'scripts/ice15-concurrency-a-commit.sql', 'scripts/ice15-concurrency-a-rollback.sql', 'scripts/ice15-concurrency-b.sql', 'scripts/ice15-concurrency-verify-cleanup.sql'])
  assert.doesNotMatch(strip(read(file)), /net\.|http_post|sendSMS|fetch\(/i);
console.log('PASS STATIC SQL PACKAGE: default blocked, sequential ROLLBACK, explicit real-contention probe and scoped cleanup');
console.log('NOT RUN: PostgreSQL syntax/runtime, RLS, real lock contention, old APK UX. No database contacted.');
