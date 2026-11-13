const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const drain = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let now = 1_800_000_000_000, timerId = 0, stored = { sosId: 'remote', startedAt: 'synthetic' };
  const timers = new Map(), calls = [], listeners = [];
  const f = { calls, actor: 'A', background: false, permission: 'granted', starts: 0, watches: 0,
    status: { sos_id: 'remote', is_owner: true, sos_status: 'open' }, statusCalls: 0,
    update: async () => 'updated', fix: null, watcher: null };
  const point = () => ({ timestamp: now, coords: { latitude: 1, longitude: 2, accuracy: 10, speed: 2 } });
  const modules = {
    'react-native': { AppState: { addEventListener: (_event, fn) => { listeners.push(fn); return { remove() {} }; } } },
    'expo-location': {
      hasStartedLocationUpdatesAsync: async () => f.background,
      stopLocationUpdatesAsync: async () => { f.background = false; },
      getForegroundPermissionsAsync: async () => { if (f.foregroundError) throw new Error('temporary permission check failure'); return { status: 'granted' }; },
      getBackgroundPermissionsAsync: async () => f.permissionWait ? f.permissionWait.promise : ({ status: f.permission }),
      getCurrentPositionAsync: () => f.fix?.promise ?? Promise.resolve(point()), Accuracy: { High: 4 },
      startLocationUpdatesAsync: async () => { f.starts++; f.background = true; },
      watchPositionAsync: async (_options, callback) => { f.watches++; f.watcher = callback; return { remove() {} }; },
    },
    'expo-task-manager': { isAvailableAsync: async () => true },
    '@/backend/auth/AuthService': { AuthService: { getSession: async () => ({ user: { id: f.actor } }) } },
    '@/backend/repositories/SOSLifecycleRepository': { SOSLifecycleRepository: { getStatus: async () => {
      f.statusCalls++; if (f.status instanceof Error) throw f.status; return f.status;
    } } },
    '@/backend/repositories/SOSLiveLocationRepository': { SOSLiveLocationRepository: { update: async (id, position, signal) => {
      calls.push({ id, position, signal }); return f.update(signal);
    } } },
    '@/storage/SOSLiveLocationStorage': { SOSLiveLocationStorage: {
      get: async () => stored, save: async (_user, value) => { stored = value; }, clear: async () => { stored = null; },
    } },
  };
  const load = file => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, AbortController,
        Date: class extends Date { static now() { return now; } },
        setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id; },
        clearTimeout: id => timers.delete(id), console: { info() {}, warn() {} } });
    return exports;
  };
  modules['@/services/SOSLiveLocationRequest'] = load('services/SOSLiveLocationRequest.ts');
  const service = load('services/SOSLiveLocationService.ts').SOSLiveLocationService;
  f.service = service;
  f.publish = () => service.publishBackgroundLocation('A', 'remote', point());
  f.foreground = async () => { listeners.forEach(fn => fn('active')); await drain(); };
  f.tick = async ms => {
    now += ms;
    for (let i = 0; i < 20; i++) {
      const due = [...timers].filter(([, t]) => t.due <= now);
      if (!due.length) break;
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
      await drain();
    }
    await drain();
  };
  return f;
}
const tests = [
  ['temporary network error: bounded backoff and recovery, single flight', async () => {
    const f = fixture(); let count = 0;
    f.update = async () => { if (++count < 3) throw { message: 'Network request failed' }; return 'updated'; };
    const pending = f.publish(); await drain(); assert.equal(f.calls.length, 1);
    assert.equal(await f.publish(), 'ignored');
    await f.tick(999); assert.equal(f.calls.length, 1);
    await f.tick(1); assert.equal(f.calls.length, 2);
    await f.tick(3000); assert.equal(await pending, 'updated'); assert.equal(f.calls.length, 3);
  }],
  ['retry budget exhausted; next native fix can recover without persistent queue', async () => {
    const f = fixture(); f.update = async () => { throw { message: 'Failed to fetch' }; };
    const pending = f.publish().catch(() => 'failed'); await drain(); await f.tick(1000); await f.tick(3000);
    assert.equal(await pending, 'failed'); assert.equal(f.calls.length, 3);
    f.update = async () => 'updated'; assert.equal(await f.publish(), 'updated');
  }],
  ['permission/auth errors are not retried', async () => {
    const f = fixture(); f.update = async () => { throw { code: '42501' }; };
    await assert.rejects(f.publish()); await f.tick(60000); assert.equal(f.calls.length, 1);
  }],
  ['stop during backoff aborts retries and blocks late background callbacks', async () => {
    const f = fixture(); f.update = async () => { throw { message: 'Network request failed' }; };
    const pending = f.publish().catch(() => 'cancelled'); await drain();
    await f.service.stop('A'); await f.tick(10000);
    assert.equal(await pending, 'cancelled'); assert.equal(await f.publish(), 'ignored'); assert.equal(f.calls.length, 1);
  }],
  ['request timeout aborts transport before retry; non-settling transport never overlaps', async () => {
    const f = fixture(); const held = deferred(); f.update = () => held.promise;
    const pending = f.publish().catch(() => 'cancelled'); await drain();
    await f.tick(8000); assert.equal(f.calls[0].signal.aborted, true);
    await f.tick(60000); assert.equal(f.calls.length, 1);
    await f.service.stop('A'); held.resolve('updated'); assert.equal(await pending, 'cancelled');
  }],
  ['abort-aware timeout releases the failed request, then bounded retry can succeed', async () => {
    const f = fixture(); let first = true;
    f.update = signal => {
      if (!first) return Promise.resolve('updated');
      first = false;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const pending = f.publish(); await drain(); await f.tick(8000);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, true);
    await f.tick(1000); assert.equal(await pending, 'updated'); assert.equal(f.calls.length, 2);
  }],
  ['account change during backoff does not send another coordinate', async () => {
    const f = fixture(); f.update = async () => { throw { message: 'Network request failed' }; };
    const pending = f.publish().catch(() => 'cancelled'); await drain(); f.actor = 'B'; await f.tick(1000);
    assert.equal(await pending, 'cancelled'); assert.equal(f.calls.length, 1);
  }],
  ['pending initial fix does not delay task/stop or publish a late fix after close', async () => {
    const f = fixture(); f.fix = deferred(); const start = f.service.start('A', 'remote'); await drain();
    assert.equal(f.starts, 1);
    await Promise.all([start, f.service.stop('A')]); assert.equal(f.background, false);
    f.fix.resolve({ timestamp: 1_800_000_000_000, coords: { latitude: 1, longitude: 2, accuracy: 10 } });
    await drain(); assert.equal(f.calls.length, 0); assert.equal(f.starts, 1);
  }],
  ['stop while background prerequisite is pending prevents late native service start', async () => {
    const f = fixture(); f.permissionWait = deferred();
    const start = f.service.start('A', 'remote'); await drain();
    const stop = f.service.stop('A'); f.permissionWait.resolve({ status: 'granted' });
    await Promise.all([start, stop]); assert.equal(f.starts, 0); assert.equal(f.watches, 0);
    const count = f.calls.length; assert.equal(await f.publish(), 'ignored'); assert.equal(f.calls.length, count);
  }],
  ['recovery requires matching owner/id and active state; uncertainty never starts GPS', async () => {
    for (const state of [
      { sos_id: 'other', is_owner: true, sos_status: 'open' },
      { sos_id: 'remote', is_owner: false, sos_status: 'open' },
      { sos_id: 'remote', is_owner: true, sos_status: 'closed' },
      { sos_id: 'remote', is_owner: true, sos_status: 'cancelled' },
      { sos_id: 'remote', is_owner: true, sos_status: 'unexpected' }, new Error('offline'),
    ]) {
      const f = fixture(); f.status = state; await f.service.restore('A', 'remote').catch(() => {});
      assert.equal(f.starts, 0); assert.equal(f.calls.length, 0);
    }
    const active = fixture(); await active.service.restore('A', 'remote'); assert.equal(active.starts, 1);
  }],
  ['foreground return upgrades fallback and recovers interrupted task only after verification', async () => {
    const f = fixture(); f.permission = 'denied'; await f.service.start('A', 'remote'); assert.equal(f.watches, 1);
    await f.service.start('A', 'remote'); f.watcher({ timestamp: 1_800_000_020_000, coords: { latitude: 1, longitude: 2, accuracy: 10 } });
    await f.tick(20000); // retained foreground listener remains usable
    f.permission = 'granted'; await f.foreground(); assert.equal(f.starts, 1); assert.ok(f.statusCalls > 0);
    f.background = false; await f.foreground(); assert.equal(f.starts, 2);
    await f.service.stop('A'); await f.foreground(); assert.equal(f.starts, 2);
  }],
  ['transient startup failure preserves recovery snapshot, without forcing restart', async () => {
    const f = fixture(); f.foregroundError = true;
    await assert.rejects(f.service.start('A', 'remote')); assert.equal(f.starts, 0);
    f.foregroundError = false; await f.foreground(); assert.equal(f.starts, 1); assert.ok(f.statusCalls > 0);
  }],
  ['late stop for another account or previous SOS cannot stop the successor', async () => {
    const f = fixture(); await f.service.start('A', 'remote');
    await f.service.stop('A', 'old-sos'); assert.equal(f.background, true);
    f.actor = 'B'; const successor = f.service.start('B', 'new-sos');
    await f.service.stop('A'); await successor; assert.equal(f.background, true); assert.equal(f.starts, 2);
  }],
];
(async () => {
  for (const [name, run] of tests) { await run(); console.log('PASS ' + name); }
  console.log('Controlled real TypeScript runtime; no native GPS, HTTP or emergencies executed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
