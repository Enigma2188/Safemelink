const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; },
    Error, TypeError, setTimeout, clearTimeout, console: { info() {}, warn() {} }, ...extra });
  return exports;
}
const attempt = { attemptId: 'old-attempt', eventId: 'local', remoteId: 'remote', phase: 'active' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const state = { user: 'A', journal: null, events: [], active: [], statuses: {}, opened: 0, writes: 0,
    busy: false, enabled: false, current: true, closures: { pending: 0, unbound: 0, remoteIds: [] }, remoteFailure: false, wait: null, closeCalls: [], closed: [], finalized: [] };
  const storage = { get: async () => state.journal, save: async (_user, value) => { state.writes++; state.journal = value; } };
  const runtime = load('services/VoiceProtectionRuntime.ts', { '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: storage } }).VoiceProtectionRuntime;
  const auth = { getSession: async () => { if (state.sessionWait) await state.sessionWait.promise; return { user: { id: state.user } }; } };
  const status = async id => ({ sos_id: id, is_owner: true, sos_status: 'closed', ...state.statuses[id] });
  const recovery = load('services/VoiceSOSRecovery.ts', {
    '@/services/SOSClosureRecovery': { SOSClosureRecovery: { inspectState: async () => { if (state.closureFailure) throw Error('unreadable'); return state.closures; } } },
    '@/backend/auth/AuthService': { AuthService: auth }, '@/backend/errors/BackendError': { BackendError: class extends Error {} },
    '@/backend/repositories/SOSRepository': { SOSRepository: { findOwnActiveForVoiceRecovery: async () => {
      if (state.wait) await state.wait.promise; if (state.remoteFailure) throw Error('private failure'); return state.active;
    } } },
    '@/backend/repositories/SOSLifecycleRepository': { SOSLifecycleRepository: { getStatus: status } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: runtime }, '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: storage },
  }).VoiceSOSRecovery;
  const events = { listEvents: async () => state.events, finalizeEvent: async (_u, id, terminal) => { state.finalized.push([id, terminal]); } };
  const app = { currentState: 'active' };
  const coordinator = load('services/VoiceLabCoordinator.ts', {
    'react-native': { Platform: { OS: 'android' }, AppState: app },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: { getStateAsync: async () => 'inactive' } },
    '@/modules/safemelink-vosk-lab': { VoskLab: { enabled: () => true, busy: () => state.busy,
      start: () => { state.opened++; state.busy = true; }, stop: () => { state.busy = false; } } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: runtime },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { canOpenVoiceLab: () => true } },
    '@/storage/VoiceProtectionStorage': { VoiceProtectionStorage: { get: async () => ({ enabled: state.enabled }) } },
    '@/storage/SOSStorage': { SOSStorage: events }, '@/services/VoiceSOSRecovery': { VoiceSOSRecovery: recovery },
  }, { setInterval: () => 1, clearInterval() {} });
  const actions = load('services/VoiceSOSRecoveryActions.ts', {
    '@/backend/auth/AuthService': { AuthService: auth }, '@/services/SOSLifecycleService': { SOSLifecycleService: { getStatus: status } },
    '@/services/SOSClosureRecovery': { SOSClosureRecovery: { request: async (user, event, terminal) => {
      state.closeCalls.push({ user, event, terminal });
      if (!state.rejectCloseProof) state.statuses[event.remoteSosId] = { sos_status: 'closed' };
    } } }, '@/services/VoiceSOSRecovery': { VoiceSOSRecovery: recovery },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: { notifySOSClosed: (...args) => state.closed.push(args) } },
    '@/storage/SOSStorage': { SOSStorage: events },
  }, { setTimeout: (fn, ms) => setTimeout(fn, state.fastDeadline && ms === 30_000 ? 0 : ms) });
  return { state, runtime, coordinator, actions, recovery, app,
    start: () => coordinator.startVoiceLab('A', 'frase test', () => state.current),
    close: (id = 'remote') => actions.closeVerifiedVoiceSOS('A', id, () => state.current) };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('a timed-out close cannot begin later when a stalled session resolves', async () => {
    const f = fixture(); f.state.sessionWait = deferred(); f.state.fastDeadline = true;
    await assert.rejects(f.close(), /scaduta/); f.state.sessionWait.resolve();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(f.state.closeCalls.length, 0); assert.equal(f.state.closed.length, 0);
  });
  await test('unbound or unreadable closure journal cannot silently authorize microphone use', async () => {
    for (const unreadable of [false, true]) {
      const f = fixture(); f.state.closureFailure = unreadable; f.state.closures = { pending: 1, unbound: 1, remoteIds: [] };
      const result = await f.actions.inspectVoiceRecovery('A');
      assert.equal(result.kind, 'uncertain'); assert.equal(result.reason, unreadable ? 'closure_journal_unreadable' : 'closure_unbound');
      await assert.rejects(f.start()); assert.equal(f.state.opened, 0); assert.equal(f.state.writes, 0);
    }
  });
  await test('pending closure with no Home event still requires its own terminal proof', async () => {
    const f = fixture(); f.state.closures = { pending: 1, unbound: 0, remoteIds: ['remote'] };
    f.state.statuses.remote = { sos_status: 'accepted' };
    assert.equal((await f.actions.inspectVoiceRecovery('A')).kind, 'active');
    f.state.statuses.remote = { sos_status: 'closed' };
    assert.equal((await f.actions.inspectVoiceRecovery('A')).kind, 'clear'); assert.equal(f.state.closeCalls.length, 0);
  });
  await test('stale closed journal no longer deadlocks Vosk reservation (actual runtime + recovery)', async () => {
    const f = fixture(); f.state.journal = { ...attempt }; f.runtime.restoreSOSAttempt('A', attempt);
    f.state.events = [{ id: 'local', remoteSosId: 'remote', isActive: true, remoteStatus: 'open' }];
    await f.start(); assert.equal(f.state.opened, 1); assert.equal(f.state.journal, null); assert.equal(f.state.closeCalls.length, 0);
    f.coordinator.stopVoiceLab();
  });
  await test('remote SOS missing from Home is identified and blocks lab without closing it', async () => {
    const f = fixture(); f.state.active = [{ id: 'orphan' }];
    const result = await f.actions.inspectVoiceRecovery('A'); assert.equal(result.remoteActiveId, 'orphan');
    await assert.rejects(f.start(), e => e.code === 'sos_active'); assert.equal(f.state.opened, 0); assert.equal(f.state.closeCalls.length, 0);
  });
  await test('unknown unbound attempt remains blocked after empty server read', async () => {
    const f = fixture(); f.state.journal = { ...attempt, remoteId: null, phase: 'unknown' };
    const result = await f.actions.inspectVoiceRecovery('A'); assert.equal(result.reason, 'unbound_attempt');
    await assert.rejects(f.start(), e => e.code === 'sos_uncertain'); assert.equal(f.state.journal.phase, 'unknown'); assert.equal(f.state.writes, 0);
  });
  await test('network failure with an old journal never clears it', async () => {
    const f = fixture(); f.state.journal = attempt; f.state.remoteFailure = true;
    await assert.rejects(f.start()); assert.equal(f.state.writes, 0); assert.equal(f.state.opened, 0);
  });
  await test('Stop during remote preflight prevents both journal release and native launch', async () => {
    const f = fixture(); f.state.wait = deferred(); const request = f.start();
    for (let i = 0; i < 25; i++) await Promise.resolve();
    f.coordinator.stopVoiceLab(); f.state.wait.resolve(); await assert.rejects(request);
    assert.equal(f.state.opened, 0); assert.equal(f.state.writes, 0);
  });
  await test('account change during remote verification vetoes lab start', async () => {
    const f = fixture(); f.state.wait = deferred(); const request = f.start();
    for (let i = 0; i < 25; i++) await Promise.resolve();
    f.state.user = 'B'; f.state.wait.resolve(); await assert.rejects(request); assert.equal(f.state.opened, 0);
  });
  await test('a new SOS during old-attempt verification cannot be cleared', async () => {
    const f = fixture(); f.state.journal = attempt; f.runtime.restoreSOSAttempt('A', attempt);
    f.state.wait = deferred(); const request = f.start();
    for (let i = 0; i < 25; i++) await Promise.resolve();
    f.runtime.notifySOSExecutionStarted('A'); const newAttempt = f.runtime.getSOSAttempt('A').attemptId;
    f.state.wait.resolve(); await assert.rejects(request); assert.equal(f.state.opened, 0);
    assert.equal(f.runtime.getSOSAttempt('A').attemptId, newAttempt);
  });
  await test('explicit orphan closure uses durable close path and verifies terminal owner', async () => {
    const f = fixture(); f.state.statuses.remote = { sos_status: 'open' }; await f.close();
    assert.equal(f.state.closeCalls.length, 1); const call = f.state.closeCalls[0];
    assert.equal(call.event.id, 'recovery:remote'); assert.equal(call.event.remoteSosId, 'remote'); assert.equal(call.terminal, 'closed');
    assert.equal(call.event.message, null); assert.equal(f.state.closed.length, 1); assert.equal(f.state.finalized.length, 0);
  });
  await test('existing local event is finalized only after remote terminal proof', async () => {
    const f = fixture(); f.state.statuses.remote = { sos_status: 'accepted' };
    f.state.events = [{ id: 'same-local', remoteSosId: 'remote' }]; await f.close();
    assert.equal(f.state.closeCalls[0].event.id, 'same-local'); assert.equal(f.state.finalized[0][0], 'same-local');
    const bad = fixture(); bad.state.statuses.remote = { sos_status: 'open' }; bad.state.rejectCloseProof = true;
    await assert.rejects(bad.close()); assert.equal(bad.state.closed.length, 0); assert.equal(bad.state.finalized.length, 0);
  });
  await test('wrong owner, wrong ID, switched account and stale confirmation cannot close anything', async () => {
    for (const mode of ['owner', 'id', 'account', 'stale']) {
      const f = fixture(); f.state.statuses.remote = { sos_status: 'open', ...(mode === 'owner' ? { is_owner: false } : {}), ...(mode === 'id' ? { sos_id: 'other' } : {}) };
      if (mode === 'account') f.state.user = 'B'; if (mode === 'stale') f.state.current = false;
      await assert.rejects(f.close()); assert.equal(f.state.closeCalls.length, 0); assert.equal(f.state.closed.length, 0);
    }
  });
  await test('already terminal SOS is reverified without another close RPC', async () => {
    const f = fixture(); await f.close(); assert.equal(f.state.closeCalls.length, 0); assert.equal(f.state.closed.length, 1);
  });
  await test('setting route and laboratory keep their intended boundaries', async () => {
    const voice = fs.readFileSync('app/voice-protection.tsx', 'utf8');
    assert.doesNotMatch(voice, /VOICE_INPUT_SETTINGS/); assert.match(voice, /Linking.openSettings/);
    const lab = fs.readFileSync('app/voice-lab.tsx', 'utf8');
    assert.doesNotMatch(lab, /closeVerifiedVoiceSOS|VoiceSOSRecoveryPanel|SOSClosureRecovery/);
    assert.match(lab, /VoiceLabStartError/);
  });
  console.log(`${passed} recovery integration checks PASS. No real backend, microphone or SMS used.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
