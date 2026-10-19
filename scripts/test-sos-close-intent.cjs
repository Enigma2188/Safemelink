const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const disk = new Map();
  let owner = 'A', networkFailure = false, finalizationFailure = false, calls = 0, changeDuringRPC = false;
  const server = new Map([['remote', 'open'], ['unrelated', 'open']]);
  let history = [{ id: 'local', remoteSosId: 'remote', isActive: true }];
  class DiagnosticError extends Error { constructor(category) { super(category); } }
  const state = id => ({ sos_id: id, sos_status: server.get(id), is_owner: true });
  const modules = {
    '@react-native-async-storage/async-storage': { default: {
      getItem: async key => disk.get(key) ?? null,
      setItem: async (key, value) => { disk.set(key, value); },
    } },
    '@/backend/auth/AuthService': { AuthService: { getSession: async () => ({ user: { id: owner } }) } },
    '@/storage/AccountScopedStorage': { getAccountStorageKey: user => user },
    '@/storage/SOSStorage': { SOSStorage: {
      listEvents: async () => history,
      finalizeEvent: async (_user, eventId, status) => {
        if (finalizationFailure) throw new Error('synthetic storage failure');
        history = history.map(event => event.id === eventId ? { ...event, isActive: false, remoteStatus: status } : event);
      },
    } },
    '@/services/SOSLifecycleService': { SOSLifecycleDiagnosticError: DiagnosticError, SOSLifecycleService: {
      getStatus: async id => { if (networkFailure) throw new Error('synthetic network failure'); return state(id); },
      close: async id => {
        calls++;
        if (networkFailure) throw new Error('synthetic timeout');
        server.set(id, 'closed');
        if (changeDuringRPC) owner = 'B';
        return state(id);
      },
      cancel: async id => { calls++; server.set(id, 'cancelled'); return state(id); },
    } },
  };
  function load() {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/SOSClosureRecovery.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
    return exports.SOSClosureRecovery;
  }
  return {
    load, disk, server, get calls() { return calls; }, get history() { return history; },
    pending: user => JSON.parse(disk.get(user + ':close-intents-v1') ?? '[]'),
    network: value => { networkFailure = value; },
    storageFailure: value => { finalizationFailure = value; },
    switchDuringRPC: () => { changeDuringRPC = true; },
    account: value => { owner = value; },
  };
}
const event = { id: 'local', remoteSosId: 'remote' };
const cases = [
  ['network timeout preserves pending intent; fresh process retries only the same SOS', async () => {
    const f = fixture(); f.network(true);
    await assert.rejects(f.load().request('A', event, 'closed'));
    assert.equal(f.pending('A')[0].phase, 'pending');
    f.network(false);
    const completed = await f.load().reconcile('A');
    assert.equal(completed.completed.length, 1); assert.equal(completed.unresolved, 0); assert.equal(f.pending('A')[0].phase, 'settled');
    assert.equal(f.server.get('remote'), 'closed'); assert.equal(f.server.get('unrelated'), 'open');
    assert.equal(f.history[0].isActive, false);
    const calls = f.calls; await f.load().reconcile('A'); assert.equal(f.calls, calls);
  }],
  ['lost response but already terminal server is reconciled without another writer call', async () => {
    const f = fixture(); f.network(true);
    await assert.rejects(f.load().request('A', event, 'closed'));
    f.network(false); f.server.set('remote', 'closed');
    const calls = f.calls; await f.load().reconcile('A'); assert.equal(f.calls, calls);
  }],
  ['local finalization failure retains confirmed intent across restart/update', async () => {
    const f = fixture(); await f.load().request('A', event, 'closed'); f.storageFailure(true);
    assert.equal((await f.load().reconcile('A')).unresolved, 1);
    assert.equal(f.pending('A')[0].phase, 'confirmed');
    f.storageFailure(false); await f.load().reconcile('A'); assert.equal(f.pending('A')[0].phase, 'settled');
  }],
  ['missing remote ID never reports a successful close and preserves the intent', async () => {
    const f = fixture(); await assert.rejects(f.load().request('A', { id: 'uncertain' }, 'closed'));
    assert.equal(f.calls, 0); assert.equal(f.pending('A')[0].remoteId, null);
    assert.equal((await f.load().reconcile('A')).unresolved, 1); assert.equal(f.pending('A')[0].phase, 'pending');
  }],
  ['account change during response cannot settle or finalize another account', async () => {
    const f = fixture(); f.switchDuringRPC();
    await assert.rejects(f.load().request('A', event, 'closed'));
    assert.equal(f.pending('A')[0].phase, 'pending'); assert.equal(f.history[0].isActive, true);
    assert.equal((await f.load().reconcile('B')).completed.length, 0);
    await assert.rejects(f.load().reconcile('A'));
  }],
  ['conflicting remote correlation fails without a second close', async () => {
    const f = fixture(); await f.load().request('A', event, 'closed'); const calls = f.calls;
    await assert.rejects(f.load().request('A', { ...event, remoteSosId: 'unrelated' }, 'closed'));
    assert.equal(f.calls, calls); assert.equal(f.server.get('unrelated'), 'open');
  }],
  ['malformed journal fails closed without overwriting the original data', async () => {
    const f = fixture(); f.disk.set('A:close-intents-v1', '{broken');
    await assert.rejects(f.load().request('A', event, 'closed'));
    assert.equal(f.disk.get('A:close-intents-v1'), '{broken'); assert.equal(f.calls, 0);
  }],
  ['an unbound old request does not starve a different verified close', async () => {
    const f = fixture(); await assert.rejects(f.load().request('A', { id: 'unbound' }, 'closed'));
    f.network(true); await assert.rejects(f.load().request('A', event, 'closed')); f.network(false);
    const result = await f.load().reconcile('A');
    assert.equal(result.unresolved, 1); assert.equal(result.completed.length, 1);
    assert.equal(f.pending('A').find(item => item.eventId === 'unbound').phase, 'pending');
    assert.equal(f.server.get('remote'), 'closed'); assert.equal(f.server.get('unrelated'), 'open');
  }],
  ['Home waits for durable request and verified RPC before local finalization (static)', async () => {
    const ui = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
    const close = ui.slice(ui.indexOf('const finishSOS ='), ui.indexOf('const deactivateSOS ='));
    assert.ok(close.indexOf('await SOSClosureRecovery.request(') < close.indexOf('SOSStorage.finalizeEvent('));
    assert.ok(close.indexOf('SOSStorage.finalizeEvent(') < close.indexOf("Chiusura completata."));
    assert.match(close, /SOSClosureUncertainError/);
  }],
];
(async () => {
  let failed = 0;
  for (const [name, test] of cases) {
    try { await test(); console.log('PASS ' + name); }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
  }
  if (failed) process.exitCode = 1;
})();
