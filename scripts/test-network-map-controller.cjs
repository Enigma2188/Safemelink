'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let now = Date.parse('2026-11-07T10:00:00.000Z'), timerId = 0;
class Clock extends Date { static now() { return now; } }
const timers = new Map();
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, Object, Array, Reflect, Date: Clock, Number, AbortController, console,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn: () => { timers.delete(id); fn(); }, delay }); return id; }, clearTimeout: id => timers.delete(id),
    require: name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; } });
  return exports;
}
const registry = load('services/NetworkCategoryRegistryV2.ts');
const contract = load('services/NetworkMapContractV2.ts', { './NetworkCategoryRegistryV2': registry });
const api = load('services/NetworkMapController.ts', { './NetworkMapContractV2': contract, './NetworkCategoryRegistryV2': registry });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const marker = (n = 1, territory = 99) => ({ schemaVersion: 2, publicId: id(n), territoryId: id(territory), zoneId: id(98), categoryId: 'LIGHTING',
  kind: 'OPERATIONAL_EVENT', status: 'ACTIVE', locationPolicyVersion: 'synthetic-test', revision: 1,
  validUntil: new Date(now + 3600000).toISOString(), createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z', resolvedAt: null,
  publicPosition: { latitude: 0, longitude: 0, generalizationMeters: 1000, representation: 'GENERALIZED_EVENT_POINT' } });
const context = (territory = 99, key = 'synthetic-access') => ({ authorizationKey: key,
  query: { territoryId: id(territory), center: { latitude: 0, longitude: 0 }, radiusMeters: 2500, status: 'ACTIVE', categoryId: null } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(setImmediate);
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await test('real service injection, loading/empty/error, immutable public snapshot, explicit refresh and withdrawal', async () => {
    let result = [marker()]; let failure = null; const requests = [];
    const controller = new api.NetworkMapController({ loadMarkers: async (query, signal) => { requests.push({ query, signal }); if (failure) throw failure; return result; } });
    assert.equal(controller.getState().status, 'IDLE');
    const pending = controller.setContext(context()); assert.equal(controller.getState().status, 'LOADING'); await pending;
    assert.equal(controller.getState().status, 'READY');
    const saved = controller.getState().snapshot.markers[0]; result[0].publicPosition.latitude = 5; assert.equal(saved.publicPosition.latitude, 0);
    assert.equal('authorizationKey' in requests[0].query, false); assert.equal(Object.isFrozen(saved.publicPosition), true);
    const scope = controller.getState().snapshot.scopeKey; result = []; await controller.invalidate();
    assert.equal(controller.getState().status, 'EMPTY'); assert.equal(controller.getState().snapshot.scopeKey, scope);
    for (const code of ['NETWORK', 'SERVER', 'ACCESS_DENIED']) {
      failure = new api.NetworkMapSourceError(code); await controller.refresh();
      assert.equal(controller.getState().errorCode, code); assert.equal(controller.getState().snapshot.markers.length, 0);
    }
    failure = null; result = [marker(2)]; await controller.refresh(); assert.equal(controller.getState().status, 'READY'); controller.dispose();
  });
  await test('territory/account/filter switches abort old loads; late results never replace current scope', async () => {
    const calls = []; const controller = new api.NetworkMapController({ loadMarkers: (query, signal) => { const request = deferred(); calls.push({ query, signal, ...request }); return request.promise; } });
    const a = controller.setContext(context()); await flush(); const oldScope = controller.getState().snapshot.scopeKey;
    const b = controller.setContext(context(100, 'another-access')); await flush(); assert.equal(calls[0].signal.aborted, true);
    assert.notEqual(controller.getState().snapshot.scopeKey, oldScope); assert.equal(controller.getState().snapshot.markers.length, 0);
    calls[1].resolve([marker(2, 100)]); await b; calls[0].resolve([marker(1)]); await a;
    assert.equal(controller.getState().snapshot.markers[0].publicId, id(2));
    const next = context(100, 'another-access'); next.query.categoryId = 'LIGHTING';
    const c = controller.setContext(next); await flush(); const filterScope = controller.getState().snapshot.scopeKey;
    assert.equal(controller.getState().status, 'LOADING'); calls[2].resolve([]); await c;
    assert.notEqual(filterScope, oldScope); await controller.setContext(null); assert.equal(controller.getState().status, 'IDLE');
    controller.dispose();
  });
  await test('overlapping refresh, logout, timeout and disposed/late callbacks fail closed without hidden retries', async () => {
    const calls = []; const controller = new api.NetworkMapController({ loadMarkers: (_query, signal) => { const d = deferred(); calls.push({ ...d, signal }); return d.promise; } }, 1234);
    const a = controller.setContext(context()); await flush(); const b = controller.refresh(); await flush();
    calls[1].resolve([marker(2)]); await b; calls[0].resolve([marker(1)]); await a; assert.equal(controller.getState().snapshot.markers[0].publicId, id(2));
    const c = controller.refresh(); await flush(); const timer = [...timers.values()].find(item => item.delay === 1234); assert.ok(timer); timer.fn(); await c;
    assert.equal(controller.getState().errorCode, 'TIMEOUT'); assert.equal(calls[2].signal.aborted, true);
    calls[2].resolve([marker()]); await flush(); assert.equal(controller.getState().errorCode, 'TIMEOUT'); assert.equal(calls.length, 3);
    const d = controller.refresh(); await flush(); await controller.setContext(null); calls[3].resolve([marker()]); await d;
    assert.equal(controller.getState().status, 'IDLE'); controller.dispose(); await controller.setContext(context()); assert.equal(calls.length, 4);
  });
  await test('expiry timer/foreground and complete snapshots cannot keep expired or withdrawn markers', async () => {
    const value = marker(); value.validUntil = new Date(now + 100).toISOString();
    const controller = new api.NetworkMapController({ loadMarkers: async () => [value] });
    await controller.setContext(context()); const timer = [...timers.values()].find(item => item.delay === 101); assert.ok(timer);
    now += 101; timer.fn(); assert.equal(controller.getState().status, 'EMPTY'); assert.equal(controller.getState().snapshot.markers.length, 0);
    await controller.refresh(); assert.equal(controller.getState().status, 'EMPTY'); controller.revalidateTime(); controller.dispose();
  });
  await test('wrong territory/category/status, private extras, duplicates and malformed query rejected', async () => {
    let result = []; const controller = new api.NetworkMapController({ loadMarkers: async () => result });
    for (const invalid of [[marker(1, 100)], [{ ...marker(), accountId: id(20) }], [marker(), marker()], [{ ...marker(), status: 'RESOLVED', resolvedAt: marker().updatedAt }]]) {
      result = invalid; await controller.setContext(context()); await controller.refresh(); assert.equal(controller.getState().errorCode, 'INVALID_DATA');
    }
    const filtered = context(); filtered.query.categoryId = 'ROADS_TRAFFIC'; result = [marker()]; await controller.setContext(filtered); assert.equal(controller.getState().errorCode, 'INVALID_DATA');
    const invalidQuery = context(); invalidQuery.query.center.latitude = NaN; await controller.setContext(invalidQuery); assert.equal(controller.getState().errorCode, 'INVALID_DATA');
    controller.dispose();
  });
  await test('reentrant logout/disposal cannot start a source request; broken subscriber cannot block clearing', async () => {
    let loads = 0; const controller = new api.NetworkMapController({ loadMarkers: async () => { loads++; return []; } });
    controller.subscribe(() => { throw new Error('subscriber failure'); });
    controller.subscribe(() => { if (controller.getState().status === 'LOADING') void controller.setContext(null); });
    await controller.setContext(context()); assert.equal(loads, 0); assert.equal(controller.getState().status, 'IDLE');
    controller.dispose(); assert.equal(timers.size, 0);
  });
  await test('native binding uses controller snapshot and foreground revalidation only; strict TypeScript', async () => {
    let used = null, listener = null, timeChecks = 0;
    const state = { snapshot: { scopeKey: 'test', sequence: 1, state: 'READY', markers: [] } };
    const react = { useSyncExternalStore: (subscribe, read) => { used = { subscribe, read }; return read(); }, useEffect: fn => fn() };
    const component = load('components/network/NetworkMapConnected.native.tsx', { react,
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      'react-native': { AppState: { addEventListener: (_event, callback) => { listener = callback; return { remove() {} }; } } },
      './NetworkMap.native': { NetworkMap: 'NetworkMap' } });
    const controller = { getState: () => state, subscribe() {}, revalidateTime: () => timeChecks++ };
    const tree = component.NetworkMapConnected({ controller, camera: {}, configuration: 'READY', onSelect() {} });
    assert.equal(tree.type, 'NetworkMap'); assert.equal(tree.props.snapshot, state.snapshot); assert.equal(used.read, controller.getState);
    listener('background'); assert.equal(timeChecks, 1); listener('active'); assert.equal(timeChecks, 2);
    const files = ['services/NetworkMapController.ts', 'components/network/NetworkMapConnected.native.tsx'];
    for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /NetworkPrototypeDemo|NETWORK_DEMO|\.rpc\(|fetch\(|createClient|AsyncStorage|expo-location|SOSService/);
    const modules = path.resolve(path.dirname(require.resolve('typescript')), '..', '..');
    const program = ts.createProgram(files.map(file => path.join(root, file)), { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, baseUrl: root, typeRoots: [path.join(modules, '@types')], types: ['react', 'node'],
      paths: { '@/*': ['./*'], react: [path.join(modules, '@types/react/index.d.ts')], 'react/*': [path.join(modules, '@types/react/*')], '*': [path.join(modules, '*'), path.join(modules, '@types/*')] } });
    const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics,
      { getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => '\n' }));
  });
  console.log(`${passed} local controller checks PASS. No real service, RPC, native rendering or multiuser authorization validated.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
