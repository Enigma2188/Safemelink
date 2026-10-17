const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture } = require('./test-voice-lifecycle.cjs');

const degraded = (reason = 'remote_creation_timeout') => ({
  event: { id: 'local-timeout', isActive: true },
  pushResult: { sosCreated: false, sosId: null, reason },
});
async function started() {
  const f = fixture();
  await f.advance(250); f.enable(); await f.advance(300);
  assert.equal(f.status, 'listening');
  return f;
}
async function timeout(f, reason) {
  const attempt = f.runtime.notifySOSExecutionStarted('account-A');
  f.runtime.notifySOSCompleted('account-A', degraded(reason), attempt);
  await f.advance(300);
  return attempt;
}
const cases = [
  ['real persistent journal survives a fresh module load and an empty server read', async () => {
    const disk = new Map();
    function loadProcess() {
      const modules = {
        '@react-native-async-storage/async-storage': { default: {
          getItem: async key => disk.get(key) ?? null,
          setItem: async (key, value) => { disk.set(key, value); },
        } },
        '@/storage/AccountScopedStorage': { getAccountStorageKey: (owner, key) => `${owner}:${key}` },
        '@/backend/auth/AuthService': { AuthService: { getSession: async () => ({ user: { id: 'account-A' } }) } },
        '@/backend/errors/BackendError': { BackendError: class extends Error {} },
        '@/backend/repositories/SOSRepository': { SOSRepository: { findOwnActiveForVoiceRecovery: async () => [] } },
        '@/backend/repositories/SOSLifecycleRepository': { SOSLifecycleRepository: { getStatus: async () => { throw new Error('No known remote ID'); } } },
      };
      function load(file, name) {
        const exports = {};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText, { exports, require: key => { assert.ok(modules[key], key); return modules[key]; },
          Date, Math, setTimeout, clearTimeout, queueMicrotask, console: { info() {}, warn() {} } });
        modules[name] = exports; return exports;
      }
      const storage = load('storage/VoiceSOSRecoveryStorage.ts', '@/storage/VoiceSOSRecoveryStorage').VoiceSOSRecoveryStorage;
      const runtime = load('services/VoiceProtectionRuntime.ts', '@/services/VoiceProtectionRuntime').VoiceProtectionRuntime;
      const recovery = load('services/VoiceSOSRecovery.ts', '@/services/VoiceSOSRecovery').VoiceSOSRecovery;
      return { storage, runtime, recovery };
    }
    const first = loadProcess(); const attempt = first.runtime.notifySOSExecutionStarted('account-A');
    first.runtime.notifySOSCompleted('account-A', degraded(), attempt);
    first.runtime.notifySOSClosed('account-A', 'local-timeout');
    const stored = await first.storage.get('account-A');
    assert.equal(stored.phase, 'unknown'); assert.equal(stored.attemptId, attempt);
    const second = loadProcess();
    const result = await second.recovery.inspect('account-A', []);
    assert.equal(result.kind, 'uncertain'); assert.equal(result.attempt.attemptId, attempt);
    assert.equal(await second.storage.get('account-B'), null);
  }],
  ['fulfilled timeout preserves journal through local close and empty SELECT', async () => {
    const f = await started(); const attempt = await timeout(f);
    assert.equal(f.runtime.getSOSAttempt('account-A').phase, 'unknown');
    assert.equal(f.status, 'sos_uncertain');
    f.runtime.notifySOSClosed('account-A', 'local-timeout');
    f.runtime.notifySettingsChanged('account-A'); await f.advance(3000);
    assert.equal(f.recoveryJournal.attemptId, attempt);
    assert.equal(f.recoveryJournal.eventId, 'local-timeout');
    assert.equal(f.recoveryJournal.remoteId, null);
    assert.equal(f.status, 'sos_uncertain'); assert.equal(f.starts, 1);
    assert.equal(f.runtime.requestSOS('account-A'), false);
    f.unmount(); await f.advance(300);
  }],
  ['remote creation error is not proof of failed INSERT', async () => {
    const f = await started(); await timeout(f, 'remote_creation_error');
    f.runtime.notifySOSClosed('account-A', 'local-timeout');
    f.runtime.notifySettingsChanged('account-A'); await f.advance(3000);
    assert.equal(f.starts, 1); assert.equal(f.recoveryJournal.phase, 'unknown');
    f.unmount(); await f.advance(300);
  }],
  ['confirmed remote SOS closes once and resumes normally', async () => {
    const f = await started(); let closed = 0; f.runtime.onSOSClosed(() => closed++);
    const attempt = f.runtime.notifySOSExecutionStarted('account-A');
    f.runtime.notifySOSCompleted('account-A', { event: { id: 'local', remoteSosId: 'remote' },
      pushResult: { sosCreated: true, sosId: 'remote' } }, attempt);
    await f.advance(300);
    f.runtime.notifySOSClosed('account-A', 'local', 'remote'); await f.advance(2000);
    assert.equal(closed, 1); assert.equal(f.starts, 2); assert.equal(f.status, 'listening');
    assert.equal(f.recoveryJournal, null); f.unmount(); await f.advance(300);
  }],
  ['push dispatch timeout does not downgrade confirmed remote creation', async () => {
    const f = await started(); const attempt = f.runtime.notifySOSExecutionStarted('account-A');
    f.runtime.notifySOSCompleted('account-A', { event: { id: 'confirmed', remoteSosId: 'remote' },
      pushResult: { sosCreated: true, sosId: 'remote', reason: 'edge_function_timeout' } }, attempt);
    assert.equal(f.runtime.getSOSAttempt('account-A').phase, 'active');
    f.runtime.notifySOSClosed('account-A', 'confirmed', 'remote'); await f.advance(2000);
    assert.equal(f.starts, 2); f.unmount(); await f.advance(300);
  }],
  ['explicit offline local-only flow retains existing closure behavior', async () => {
    const f = await started(); const attempt = f.runtime.notifySOSExecutionStarted('account-A');
    f.runtime.notifySOSCompleted('account-A', degraded('unavailable'), attempt);
    assert.equal(f.runtime.getSOSAttempt('account-A').phase, 'active');
    f.runtime.notifySOSClosed('account-A', 'local-timeout'); await f.advance(2000);
    assert.equal(f.starts, 2); f.unmount(); await f.advance(300);
  }],
  ['old timeout and old closure cannot overwrite a newer correlated attempt', async () => {
    const f = await started(); const old = await timeout(f);
    const next = f.runtime.notifySOSExecutionStarted('account-A');
    f.runtime.notifySOSCompleted('account-A', degraded(), old);
    f.runtime.notifySOSClosed('account-A', 'local-timeout');
    assert.equal(f.runtime.getSOSAttempt('account-A').attemptId, next);
    assert.equal(f.runtime.getSOSAttempt('account-A').phase, 'pending');
    f.runtime.notifySOSCompleted('account-A', { event: { id: 'new', remoteSosId: 'new-remote' },
      pushResult: { sosCreated: true, sosId: 'new-remote' } }, next);
    f.runtime.notifySOSClosed('account-A', 'local-timeout');
    assert.equal(f.runtime.getSOSAttempt('account-A').attemptId, next);
    f.unmount(); await f.advance(300);
  }],
  ['OFF and account change veto recovery without deleting uncertain journal', async () => {
    for (const accountChange of [false, true]) {
      const f = await started(); const attempt = await timeout(f);
      if (accountChange) f.changeAccountBeforeEffects(); else f.disable();
      f.runtime.notifySOSClosed('account-A', 'local-timeout');
      f.runtime.notifySettingsChanged('account-A'); await f.advance(5000);
      assert.equal(f.starts, 1); assert.equal(f.recoveryJournal.attemptId, attempt);
      assert.equal(f.runtime.getRecognitionState('account-B'), 'off');
      if (!accountChange) assert.equal(f.status, 'off');
      f.unmount(); await f.advance(300);
    }
  }],
  ['simulated process restart restores uncertain journal with empty local storage', async () => {
    const old = await started(); const attempt = await timeout(old);
    old.runtime.notifySOSClosed('account-A', 'local-timeout');
    const journal = old.recoveryJournal; old.unmount(); await old.advance(300);
    const fresh = fixture(); fresh.setRecoveryJournal(journal);
    await fresh.advance(250); fresh.enable(); await fresh.advance(3000);
    assert.equal(fresh.starts, 0); assert.equal(fresh.status, 'sos_uncertain');
    assert.equal(fresh.recoveryJournal.attemptId, attempt);
    assert.equal(fresh.runtime.requestSOS('account-A'), false);
    fresh.unmount(); await fresh.advance(300);
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
