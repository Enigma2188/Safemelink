const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { fixture } = require('./test-voice-lifecycle.cjs');
const baseline = process.argv.includes('--baseline');

function recovery({ attempt, events = [], active = [], state = {}, owner = 'A' }) {
  let queries = 0;
  const dependencies = {
    '@/backend/auth/AuthService': { AuthService: { getSession: async () => ({ user: { id: owner } }) } },
    '@/backend/errors/BackendError': { BackendError: class extends Error {} },
    '@/backend/repositories/SOSRepository': { SOSRepository: { findOwnActiveForVoiceRecovery: async () => active } },
    '@/backend/repositories/SOSLifecycleRepository': { SOSLifecycleRepository: { getStatus: async id => {
      queries++; return { sos_id: id, is_owner: true, sos_status: 'closed', ...state };
    } } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: { getSOSAttempt: () => null } },
    '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: { get: async () => attempt } },
  };
  const source = baseline ? execFileSync('git', ['show', 'f52f9846bfa057edb4bf64a6302a1c3a3d6a42e7:services/VoiceSOSRecovery.ts'], { encoding: 'utf8' })
    : fs.readFileSync('services/VoiceSOSRecovery.ts', 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; }, TypeError });
  return { run: () => exports.VoiceSOSRecovery.inspect('A', events), queries: () => queries };
}
const journal = { attemptId: 'attempt', eventId: 'local', remoteId: 'remote', phase: 'unknown' };
const terminal = { id: 'local', remoteSosId: 'remote', remoteStatus: 'closed', isActive: false };
const cases = [
  ['known remote terminal proof resolves uncertain journal', async () => {
    const f = recovery({ attempt: journal }); assert.equal((await f.run()).kind, 'clear'); assert.equal(f.queries(), 1);
  }],
  ['same local event recovers the missing remote binding', async () => {
    const f = recovery({ attempt: { ...journal, remoteId: null }, events: [terminal] });
    assert.equal((await f.run()).kind, 'clear'); assert.equal(f.queries(), 1);
  }],
  ['confirmed local-only close releases its own active journal', async () => {
    const f = recovery({ attempt: { ...journal, remoteId: null, phase: 'active' },
      events: [{ ...terminal, remoteSosId: undefined }] }); assert.equal((await f.run()).kind, 'clear');
  }],
  ['empty SELECT and local close do not resolve uncertain legacy INSERT', async () => {
    const f = recovery({ attempt: { ...journal, remoteId: null }, events: [{ ...terminal, remoteSosId: undefined }] });
    assert.equal((await f.run()).kind, 'uncertain'); assert.equal(f.queries(), 0);
  }],
  ['missing history is uncertain, not a confirmed active SOS', async () => {
    assert.equal((await recovery({ attempt: { ...journal, phase: 'active', remoteId: null } }).run()).kind, 'uncertain');
  }],
  ['another active emergency prevents restart', async () => {
    assert.equal((await recovery({ attempt: journal, active: [{ id: 'other' }] }).run()).kind, 'active');
  }],
  ['conflicting journal and local remote IDs cannot authorize restart', async () => {
    assert.equal((await recovery({ attempt: journal, events: [{ ...terminal, remoteSosId: 'other' }] }).run()).kind, 'uncertain');
  }],
  ['wrong owner, nonterminal and missing status fail closed', async () => {
    for (const state of [{ is_owner: false }, { sos_id: 'other' }, { sos_status: null }]) {
      assert.equal((await recovery({ attempt: journal, state }).run()).kind, 'uncertain');
    }
    assert.equal((await recovery({ attempt: journal, state: { sos_status: 'accepted' } }).run()).kind, 'active');
    assert.equal((await recovery({ attempt: journal, owner: 'B' }).run()).kind, 'uncertain');
  }],
  ['verified close resumes native listening; OFF vetoes recovery', async () => {
    for (const off of [false, true]) {
      const f = fixture(); f.setRecoveryJournal(journal); await f.advance(250);
      if (off) f.disable(); else f.enable();
      await f.advance(2000);
      assert.equal(f.starts, off ? 0 : 1); assert.equal(f.status, off ? 'off' : 'listening');
      if (!off) assert.equal(f.recoveryJournal, null);
      f.unmount(); await f.advance(300);
    }
  }],
  ['missing native tag cannot authorize listening or matching', async () => {
    const f = fixture({ confirmStart: false }); await f.advance(250); f.enable(); await f.advance(300);
    f.events.start({ safemelinkGeneration: null });
    f.events.result({ safemelinkGeneration: null, isFinal: true, results: [{ transcript: 'test phrase' }] });
    assert.notEqual(f.status, 'listening'); assert.equal(f.requests, 0);
    await f.advance(6000); assert.equal(f.status, 'error');
    f.unmount(); await f.advance(300);
  }],
  ['correlated verified remote close releases unknown phase, but not another SOS', async () => {
    for (const anotherActive of [false, true]) {
      const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
      const attempt = f.runtime.notifySOSExecutionStarted('account-A');
      f.runtime.notifySOSCompleted('account-A', { event: { id: 'local', remoteSosId: 'remote' },
        pushResult: { sosId: 'remote', reason: 'remote_creation_timeout' } }, attempt);
      if (anotherActive) f.setRemoteActive([{ id: 'other', user_id: 'account-A', status: 'open' }]);
      f.runtime.notifySOSClosed('account-A', 'local', 'remote'); await f.advance(2500);
      assert.equal(f.starts, anotherActive ? 1 : 2);
      assert.equal(f.status, anotherActive ? 'sos_active' : 'listening');
      f.unmount(); await f.advance(300);
    }
  }],
  ['UI save requires OFF and completed native teardown (static)', async () => {
    const ui = fs.readFileSync('app/voice-protection.tsx', 'utf8');
    const save = ui.slice(ui.indexOf('const savePassphrase ='), ui.indexOf('const activateProtection ='));
    assert.match(save, /if \(settingsRef.current.enabled\)/);
    assert.ok(save.indexOf('requestRecognitionStop(userId)') < save.indexOf('await stopVoiceRecognition()'));
    assert.ok(save.indexOf('await stopVoiceRecognition()') < save.indexOf('VoiceProtectionStorage.save('));
    assert.match(ui, /Modalità abilitata, ma microfono non in ascolto/);
    assert.match(ui, /DISATTIVA PROTEZIONE/);
  }],
  ['T1 diagnostics and native initial-arm gate preserve T2 (static)', async () => {
    const native = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineStore.kt', 'utf8');
    assert.match(native, /if \(!record.optBoolean\("armed"\)\) checkNotificationPrerequisites/);
    for (const marker of ['firstNoticeAttemptedAt', 'firstNoticeFailed', 'FIRST_NOTICE_REJECTED', 'NOTIFICATION_PREREQUISITE_FAILED']) assert.ok(native.includes(marker));
    assert.match(native, /t2 == t1 \+ 30_000/);
    const t1 = native.slice(native.indexOf('@Synchronized fun publishConfirmation'), native.indexOf('private fun checkNotificationPrerequisites'));
    assert.doesNotMatch(t1, /\.put\("t2"|\.put\("claimed"|\.put\("armed"|\.put\("state"|setAlarmClock|cancelAlarms/);
    assert.match(t1, /current.optString\("kind"\) == "checkpoint"/);
    assert.match(t1, /throw error/);
  }],
];
(async () => {
  let failed = 0;
  for (const [name, test] of cases) {
    try { await test(); console.log('PASS ' + name); }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message.split('\n')[0]); }
  }
  if (failed) process.exitCode = 1;
})();
