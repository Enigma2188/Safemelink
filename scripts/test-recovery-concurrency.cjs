const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.SML_REVIEW_BASE || '.';
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${root}/${path}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; },
    console: { info() {}, warn() {} }, setTimeout, clearTimeout, TypeError });
  return exports;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const attempt = { attemptId: 'one', eventId: 'event', remoteId: 'remote', phase: 'active' };
const runtime = storage => load('services/VoiceProtectionRuntime.ts', {
  '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: storage },
}).VoiceProtectionRuntime;
function recovery(getCurrent, getStored) {
  return load('services/VoiceSOSRecovery.ts', {
    '@/services/SOSClosureRecovery': { SOSClosureRecovery: { inspectState: async () => ({ pending: 0, unbound: 0, remoteIds: [] }) } },
    '@/backend/auth/AuthService': { AuthService: { getSession: async () => ({ user: { id: 'A' } }) } },
    '@/backend/errors/BackendError': { BackendError: class extends Error {} },
    '@/backend/repositories/SOSRepository': { SOSRepository: { findOwnActiveForVoiceRecovery: async () => [] } },
    '@/backend/repositories/SOSLifecycleRepository': { SOSLifecycleRepository: { getStatus: async id => ({ sos_id: id, is_owner: true, sos_status: 'closed' }) } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: { getSOSAttempt: getCurrent } },
    '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: { get: getStored } },
  }).VoiceSOSRecovery;
}
const cases = [
  ['same attempt updated after verification requires a fresh proof', async () => {
    let writes = 0; const r = runtime({ save: async () => { writes++; } }); r.restoreSOSAttempt('A', attempt);
    r.notifySOSCompleted('A', { event: { id: 'event', remoteSosId: 'different' } }, 'one'); const before = writes;
    assert.equal(await r.clearVerifiedSuspension('A', 'one', attempt), false);
    assert.equal(r.getSOSAttempt('A').remoteId, 'different'); assert.equal(writes, before);
  }],
  ['saving a new SOS while closing another preserves both events', async () => {
    let disk = JSON.stringify([{ id: 'old', isActive: true }]);
    const storage = load('storage/SOSStorage.ts', { '@/storage/AccountScopedStorage': {
      getAccountStorageItem: async () => disk, setAccountStorageItem: async (_u, _k, value) => { disk = value; },
    } }).SOSStorage;
    await Promise.all([storage.saveEvent('A', { id: 'new', isActive: true }), storage.finalizeEvent('A', 'old', 'closed')]);
    const events = await storage.listEvents('A'); assert.equal(events.find(e => e.id === 'new')?.isActive, true);
    assert.equal(events.find(e => e.id === 'old')?.isActive, false);
  }],
  ['failed persistent release retains the in-memory SOS guard', async () => {
    const r = runtime({ save: async () => { throw Error('disk failure'); } }); r.restoreSOSAttempt('A', attempt);
    await assert.rejects(r.clearVerifiedSuspension('A', 'one')); assert.equal(r.isSOSSuspended('A'), true);
    assert.equal(r.reserveMicrophoneForLab(), null);
  }],
  ['in-flight release keeps guard and cannot discard a newer SOS', async () => {
    const wait = deferred(), writes = [];
    const r = runtime({ save: async (_u, value) => { writes.push(value); if (value === null) await wait.promise; } });
    r.restoreSOSAttempt('A', attempt); const clear = r.clearVerifiedSuspension('A', 'one'); assert.equal(r.isSOSSuspended('A'), true);
    const newer = r.notifySOSExecutionStarted('A'); wait.resolve(); assert.equal(await clear, false);
    assert.equal(r.getSOSAttempt('A').attemptId, newer); assert.equal(writes.at(-1).attemptId, newer);
  }],
  ['journal read uses the current runtime binding, not a pre-await snapshot', async () => {
    const wait = deferred(); let current = { ...attempt, phase: 'unknown', remoteId: null, eventId: null };
    const r = recovery(() => ({ ...current }), async () => { await wait.promise; return { ...current }; });
    const pending = r.inspect('A', []); current = { ...attempt }; wait.resolve(); assert.equal((await pending).kind, 'clear');
  }],
  ['conflicting durable and in-memory attempts never authorize release', async () => {
    const r = recovery(() => attempt, async () => ({ ...attempt, attemptId: 'other' }));
    assert.equal((await r.inspect('A', [])).kind, 'uncertain');
  }],
];
(async () => { let failed = 0; for (const [name, run] of cases) { try { await run(); console.log('PASS '+name); }
  catch (e) { failed++; console.error('FAIL '+name+': '+e.message); } } if (failed) process.exitCode = 1; })();
