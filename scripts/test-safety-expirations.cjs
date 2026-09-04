const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve('services/SafetyExpirationRuntime.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
function fixture(initial = null) {
  let now = 1_000_000;
  let stored = initial;
  let deliveries = 0;
  let notices = 0;
  let failWrite = false;
  let holdClaim = null;
  const storage = {
    get: async () => stored,
    save: async (_user, value) => {
      if (failWrite) { failWrite = false; throw new Error('storage unavailable'); }
      if (value.phase === 'executing' && holdClaim) await holdClaim;
      stored = { ...value };
    },
    clear: async () => { stored = null; },
  };
  const exports = {};
  const modules = {
    '@/storage/SafetyExpirationStorage': { SafetyExpirationStorage: storage },
    '@/storage/CheckpointStorage': { CheckpointStorage: { getActive: async () => ({ startedAt: 'session' }), clearActive: async () => {} } },
    '@/storage/GoHomeStorage': { GoHomeStorage: { getActive: async () => ({ id: 'session' }), clearActive: async () => {} } },
    '@/services/SafetyOperation': { withSafetyTimeout: async (p) => p, reportSafetyError: () => {} },
    '@/services/SafetyNotifications': { SafetyNotifications: { show: () => { notices += 1; return new Promise(() => {}); } } },
    '@/services/SOSService': { SOSService: { completeSOS: async () => { deliveries += 1; return {}; } } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: {
      notifySOSExecutionStarted() {}, notifySOSCompleted() {}, notifySOSFailed() {}, wakeBackgroundTask() {},
    } },
  };
  class Clock extends Date { constructor(value) { super(value === undefined ? now : value); } static now() { return now; } }
  vm.runInNewContext(compiled, { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; }, Date: Clock, console });
  return {
    runtime: exports.SafetyExpirationRuntime,
    advance(ms) { now += ms; }, deadline: () => new Date(now + 1000).toISOString(),
    fail() { failWrite = true; }, hold(p) { holdClaim = p; },
    get deliveries() { return deliveries; }, get notices() { return notices; }, get stored() { return stored; },
  };
}

async function main() {
  {
    const exports = {};
    let fire;
    let cleared = 0;
    const code = ts.transpileModule(fs.readFileSync('services/SafetyOperation.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, { exports, console: { warn() {} },
      setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => { cleared += 1; },
    });
    const pending = exports.withSafetyTimeout(new Promise(() => {}), 'local_notification');
    fire();
    await assert.rejects(pending, { name: 'SafetyOperationError' });
    await assert.rejects(exports.withSafetyTimeout(Promise.reject(new Error('native failed')), 'local_notification'));
    assert.equal(await exports.withSafetyTimeout(Promise.resolve(true), 'storage_read'), true);
    assert.equal(cleared, 3, 'all timer paths clean up');
  }
  for (const kind of ['checkpoint', 'go_home']) {
    const f = fixture();
    await f.runtime.schedule('account', kind, 'session', f.deadline(), 30);
    f.advance(1000);
    await f.runtime.processDue('account');
    assert.equal(f.stored.phase, 'confirming');
    assert.equal(f.notices, 1);
    await f.runtime.processDue('account');
    assert.equal(f.notices, 1);
    f.advance(30000);
    await Promise.all([f.runtime.processDue('account'), f.runtime.processDue('account')]);
    await flush();
    assert.equal(f.deliveries, 1, `${kind}: pending notification must not block SOS`);
  }
  {
    const f = fixture({ kind: 'manual_sos', sessionId: 'session', phase: 'waiting',
      expiresAt: new Date(999999).toISOString(), confirmationExpiresAt: new Date(999999).toISOString() });
    await f.runtime.processDue('account');
    await flush();
    assert.equal(f.deliveries, 1, 'expired manual countdown restored without React');
  }
  {
    const f = fixture({ kind: 'manual_sos', sessionId: 'session', phase: 'executing',
      expiresAt: new Date(999999).toISOString(), confirmationExpiresAt: new Date(999999).toISOString() });
    await f.runtime.processDue('account');
    assert.equal(f.deliveries, 0, 'uncertain persisted execution is never replayed');
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'manual_sos', 'session', f.deadline(), 0);
    await Promise.all([f.runtime.expedite('account'), f.runtime.expedite('account')]);
    await flush();
    assert.equal(f.deliveries, 1, 'expedite single fire');
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'manual_sos', 'session', f.deadline(), 0);
    f.advance(1000);
    let release;
    f.hold(new Promise((resolve) => { release = resolve; }));
    const due = f.runtime.processDue('account');
    await flush();
    const cancel = f.runtime.cancel('account');
    release();
    await Promise.all([due, cancel]);
    assert.equal(f.deliveries, 0, 'cancel while claim is pending');
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'manual_sos', 'session', f.deadline(), 0);
    f.advance(1000);
    f.fail();
    await assert.rejects(f.runtime.processDue('account'));
    assert.equal(f.deliveries, 0);
    assert.equal(f.stored.phase, 'waiting');
    await f.runtime.processDue('account');
    await flush();
    assert.equal(f.deliveries, 1, 'storage failure is recoverable before execution');
  }
  console.log('PASS safety deadlines: pending notification, stages, duplicate callback, cancel, expedite, storage recovery');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
