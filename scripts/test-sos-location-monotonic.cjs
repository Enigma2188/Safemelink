const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const migration = 'supabase/migrations/20261013120000_sos_live_location_monotonic.sql';
const sql = fs.readFileSync(migration, 'utf8');
const NOW = 1_000_000;
function model() {
  const row = { owner: 'A', status: 'open', observed: null, latitude: null, accuracy: null };
  let queue = Promise.resolve();
  function update(actor, observed, latitude, wait = async () => {}) {
    const operation = queue.then(async () => {
      if (!actor) throw Object.assign(new Error('auth'), { code: '28000' });
      if (!Number.isFinite(observed) || observed < NOW - 600_000 || observed > NOW + 120_000)
        throw Object.assign(new Error('invalid'), { code: '22023' });
      if (actor !== row.owner) throw Object.assign(new Error('forbidden'), { code: '42501' });
      await wait();
      if (!['open', 'accepted'].includes(row.status)) return 'inactive';
      if (row.observed !== null && observed <= row.observed) return 'stale';
      Object.assign(row, { observed, latitude, accuracy: 10 }); return 'updated';
    });
    queue = operation.catch(() => {}); return operation;
  }
  return { row, update };
}
function clientFixture(response, networkError = false) {
  let calls = 0;
  const modules = {
    '@/backend/errors/BackendError': { BackendError: class extends Error {} },
    '@/backend/supabaseClient': { requireSupabaseClient: () => ({ rpc: (name, args) => {
      assert.equal(name, 'update_my_active_sos_location_result'); assert.equal(args.target_sos_id, 'remote');
      calls++;
      const promise = (async () => {
        if (networkError) throw new TypeError('synthetic network');
        return { data: typeof response === 'function' ? await response() : response, error: null };
      })();
      promise.abortSignal = () => promise;
      return promise;
    } }) },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    '@/backend/repositories/SOSLifecycleRepository': { SOSLifecycleRepository: {} },
    '@/backend/auth/AuthService': { AuthService: { getSession: async () => ({ user: { id: 'A' } }) } },
    '@/storage/SOSLiveLocationStorage': { SOSLiveLocationStorage: { get: async () => ({ sosId: 'remote' }), clear: async () => {} } },
    'expo-location': { hasStartedLocationUpdatesAsync: async () => false },
    'expo-task-manager': { defineTask: (_name, fn) => { modules.task = fn; } },
  };
  const load = file => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, Date, Math, setTimeout, clearTimeout, AbortController,
        console: { info() {}, warn() {} } });
    return exports;
  };
  modules['@/backend/repositories/SOSLiveLocationRepository'] = load('backend/repositories/SOSLiveLocationRepository.ts');
  modules['@/services/SOSLiveLocationRequest'] = load('services/SOSLiveLocationRequest.ts');
  modules['@/services/SOSLiveLocationService'] = load('services/SOSLiveLocationService.ts');
  const stopTracking = modules['@/services/SOSLiveLocationService'].SOSLiveLocationService.stop;
  let stops = 0;
  modules['@/services/SOSLiveLocationService'].SOSLiveLocationService.stop = async () => { stops++; };
  load('services/SOSLiveLocationBackgroundTask.ts');
  return { run: () => modules.task({ data: { locations: [{ timestamp: NOW, coords: { latitude: 1, longitude: 2, accuracy: 10, speed: 2 } }] } }),
    repository: modules['@/backend/repositories/SOSLiveLocationRepository'].SOSLiveLocationRepository,
    stopTracking, get calls() { return calls; },
    publish: modules['@/services/SOSLiveLocationService'].SOSLiveLocationService.publishBackgroundLocation,
    get stops() { return stops; } };
}
const cases = [
  ['STATIC: owned row lock precedes comparison; atomic predicate covers all GPS fields', async () => {
    assert.ok(sql.indexOf('for update;') < sql.indexOf('position_observed_at <= locked_sos.location_updated_at'));
    assert.match(sql, /where target\.id = target_sos_id and target\.user_id = current_user_id\s+for update/);
    assert.match(sql, /and target\.status in \('open', 'accepted'\)/);
    assert.match(sql, /or position_observed_at > target\.location_updated_at/);
    for (const field of ['latitude', 'longitude', 'accuracy', 'location_updated_at', 'updated_at']) assert.ok(sql.includes(field + ' ='));
    assert.match(sql, /return outcome in \('updated', 'stale'\)/);
    assert.match(sql, /get stacked diagnostics error_detail = pg_exception_detail/);
    assert.match(sql, /if error_detail = 'SOS_LOCATION_OWNER_SCOPE' then return false; end if/);
    assert.equal((sql.match(/security definer/g) || []).length, 2);
    assert.equal((sql.match(/set search_path = public, pg_temp/g) || []).length, 2);
    assert.doesNotMatch(sql, /alter table|create policy|grant.*\bselect\b|grant.*\bupdate\b|grant.*to anon/i);
    assert.ok(sql.trim().startsWith('begin;')); assert.ok(sql.trim().endsWith('commit;'));
  }],
  ['STATIC: old migrations remain byte-for-byte unchanged', async () => {
    for (const file of ['supabase/migrations/20260902120000_sos_delivery_all_nearby_and_live_location.sql',
      'supabase/migrations/20260918123000_fix_safety_sos_location_timestamp.sql']) {
      const base = execFileSync('git', ['show', `fa4644a861732b30d2c7096b2582095374cc8f98:${file}`], { encoding: 'utf8' });
      assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), base.replace(/\r\n/g, '\n'));
    }
  }],
  ['MODEL ONLY: newer then older/equal preserves coordinates, accuracy and timestamp', async () => {
    const m = model(); assert.equal(await m.update('A', NOW, 1), 'updated');
    const snapshot = JSON.stringify(m.row);
    assert.equal(await m.update('A', NOW - 1000, 9), 'stale');
    assert.equal(await m.update('A', NOW, 8), 'stale'); assert.equal(JSON.stringify(m.row), snapshot);
  }],
  ['MODEL ONLY: concurrent orders serialize and retain maximum accepted timestamp', async () => {
    for (const newerFirst of [true, false]) {
      const m = model(); let release; const held = new Promise(resolve => { release = resolve; });
      const first = m.update('A', newerFirst ? NOW : NOW - 1000, newerFirst ? 1 : 9, () => held);
      const second = m.update('A', newerFirst ? NOW - 1000 : NOW, newerFirst ? 9 : 1);
      release(); await Promise.all([first, second]); assert.equal(m.row.observed, NOW); assert.equal(m.row.latitude, 1);
    }
  }],
  ['MODEL ONLY: future bounds, terminal SOS and account/auth isolation', async () => {
    const m = model();
    await assert.rejects(m.update('A', NOW + 120_001, 1), error => error.code === '22023');
    await assert.rejects(m.update('B', NOW, 1), error => error.code === '42501');
    await assert.rejects(m.update(null, NOW, 1), error => error.code === '28000');
    assert.equal(m.row.observed, null);
    assert.equal(await m.update('A', NOW + 120_000, 1), 'updated');
    assert.equal(await m.update('A', NOW, 9), 'stale');
    m.row.status = 'closed'; assert.equal(await m.update('A', NOW + 120_000, 9), 'inactive');
    assert.equal(m.row.latitude, 1);
  }],
  ['REAL CLIENT / mocked backend: stale never stops or throttles the next fresh fix', async () => {
    let count = 0;
    const f = clientFixture(() => ++count === 1 ? 'stale' : 'updated');
    await f.run(); await f.run(); assert.equal(f.stops, 0); assert.equal(f.calls, 2);
    await f.run(); assert.equal(f.calls, 2); // confirmed update DOES throttle
  }],
  ['REAL CLIENT / mocked backend: old response after stop cannot throttle recovery', async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let first = true;
    const f = clientFixture(() => { if (first) { first = false; return held; } return 'updated'; });
    const pending = f.run();
    while (!f.calls) await Promise.resolve();
    await f.stopTracking('A'); release('updated'); await pending;
    await f.run(); assert.equal(f.calls, 1); // explicit stop prevents new background publications
  }],
  ['REAL CLIENT / mocked backend: malformed response is an error, not confirmation or inactivity', async () => {
    for (const value of [true, false, null, 'unexpected']) {
      const f = clientFixture(value); await f.run(); assert.equal(f.stops, 0);
      await assert.rejects(f.repository.update('remote', { latitude: 1, longitude: 2, accuracy: 10, observedAt: new Date(NOW).toISOString() }));
    }
  }],
  ['REAL CLIENT / mocked backend: invalid coordinates, timestamp and accuracy never reach RPC', async () => {
    const f = clientFixture('updated');
    const point = { timestamp: NOW, coords: { latitude: 1, longitude: 2, accuracy: 10, speed: 2 } };
    for (const invalid of [
      { ...point, timestamp: NaN },
      { ...point, coords: { ...point.coords, accuracy: NaN } },
      { ...point, coords: { ...point.coords, latitude: 91 } },
      { ...point, coords: { ...point.coords, longitude: Infinity } },
    ]) assert.equal(await f.publish('A', 'remote', invalid), 'ignored');
    assert.equal(f.calls, 0);
  }],
  ['REAL CLIENT / mocked backend: inactive stops; network error does not fake inactivity', async () => {
    const inactive = clientFixture('inactive'); await inactive.run(); assert.equal(inactive.stops, 1);
    const offline = clientFixture(null, true); await offline.run(); assert.equal(offline.stops, 0);
    await assert.rejects(offline.repository.update('remote', { latitude: 1, longitude: 2, accuracy: 10, observedAt: new Date(NOW).toISOString() }));
  }],
];
(async () => { let failed = 0; for (const [name, run] of cases) {
  try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
} if (failed) process.exitCode = 1;
console.log('PostgreSQL execution/concurrency NOT RUN; model is not a SQL lock proof.'); })();
