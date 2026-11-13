'use strict';
// Exercise actual presentation/model code; no native engine, tiles, GPS or backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = ['components/network/NetworkMap.types.ts', 'components/network/NetworkMapModel.ts', 'components/network/NetworkMap.native.tsx'];
let time = Date.parse('2026-11-05T12:00:00.000Z');
class Clock extends Date { static now() { return time; } }
const timers = new Map(); let timerId = 0;
function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, Object, Reflect, Array, Number, Date: Clock, console,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    require: name => { assert.ok(Object.hasOwn(deps, name), `Forbidden/unexpected dependency ${name}`); return deps[name]; } });
  return exports;
}
const categories = load('services/NetworkCategoryRegistryV2.ts');
const contract = load('services/NetworkMapContractV2.ts', { './NetworkCategoryRegistryV2': categories });
const model = load(files[1], { '@/services/NetworkMapContractV2': contract });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const marker = (n = 1) => ({ schemaVersion: 2, publicId: id(n), territoryId: id(99), zoneId: id(98), kind: 'OPERATIONAL_EVENT',
  categoryId: 'LIGHTING', status: 'ACTIVE', locationPolicyVersion: 'synthetic-test', revision: 1,
  validUntil: '2026-11-05T13:00:00.000Z', createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z', resolvedAt: null,
  publicPosition: { latitude: 0, longitude: 0, generalizationMeters: 1000, representation: 'GENERALIZED_EVENT_POINT' } });
const snapshot = (markers = [marker()], sequence = 1) => ({ scopeKey: 'synthetic-scope', sequence, state: 'READY', markers });
const region = { latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0.1 };
const size = { width: 400, height: 700 };
let passed = 0;
const test = (label, run) => { run(); passed++; console.log(`PASS ${label}`); };
test('public projection rejects extra private fields, malformed coordinates, duplicates and invalid snapshots', () => {
  const valid = model.prepareNetworkMapPoints(snapshot(), time); assert.equal(valid.state, 'READY');
  assert.deepEqual(Object.keys(valid.points[0]).sort(), ['publicId', 'categoryId', 'kind', 'status', 'coordinate', 'expiresAt'].sort());
  for (const value of [{ ...marker(), accountId: id(90) }, { ...marker(), authorPosition: { latitude: 1, longitude: 2 } },
    { ...marker(), publicPosition: { ...marker().publicPosition, latitude: NaN } }, { ...marker(), categoryId: 'UNKNOWN' }]) {
    assert.equal(model.prepareNetworkMapPoints(snapshot([value]), time).state, 'INVALID');
  }
  assert.equal(model.prepareNetworkMapPoints(snapshot([marker(), marker()]), time).state, 'INVALID');
  assert.equal(model.prepareNetworkMapPoints({ ...snapshot(), scopeKey: '' }, time).state, 'INVALID');
  assert.equal(model.prepareNetworkMapPoints({ ...snapshot(), sequence: NaN }, time).state, 'INVALID');
});
test('expired/loading/error snapshots clear data; rendering limit is fail-closed, never silent truncation', () => {
  assert.equal(model.prepareNetworkMapPoints(snapshot([{ ...marker(), validUntil: new Date(time).toISOString() }]), time).points.length, 0);
  for (const state of ['LOADING', 'ERROR']) assert.equal(model.prepareNetworkMapPoints({ ...snapshot(), state }, time).points.length, 0);
  assert.equal(model.prepareNetworkMapPoints(snapshot(Array.from({ length: 2001 }, (_, i) => marker(i + 1))), time).state, 'LIMIT');
});
test('stable zoom grid, distinct lifecycle/history clusters, world/dateline and existing radii', () => {
  const markers = [marker(1), marker(2), { ...marker(3), status: 'RESOLVED', resolvedAt: marker().updatedAt }];
  const history = { ...marker(4), kind: 'REVIEWED_HISTORY', status: 'CONCLUDED', period: { startMonth: '2026-09-01', endMonthExclusive: '2026-10-01' },
    publicPosition: { ...marker().publicPosition, representation: 'ZONE_REPRESENTATIVE_POINT' } };
  delete history.createdAt; delete history.updatedAt; delete history.resolvedAt; markers.push(history);
  const points = model.prepareNetworkMapPoints(snapshot(markers), time).points;
  const clusters = model.clusterNetworkMapPoints(points, region, size);
  assert.equal(clusters.length, 3); assert.equal(clusters.reduce((n, c) => n + c.points.length, 0), 4);
  assert.equal(JSON.stringify(clusters), JSON.stringify(model.clusterNetworkMapPoints([...points].reverse(), region, size)));
  const across = points.slice(0, 2).map((point, i) => ({ ...point, coordinate: { latitude: 0, longitude: i ? -179.99 : 179.99 } }));
  assert.equal(model.clusterNetworkMapPoints(across, { ...region, longitude: 180 }, size).reduce((n, c) => n + c.points.length, 0), 2);
  for (const radius of [1000, 2500, 5000, 10000]) assert.ok(model.validNetworkMapRegion(model.networkMapRegionForRadius({ latitude: -35, longitude: 140 }, radius, 0.6)));
  assert.equal(model.networkMapRegionForRadius({ latitude: 0, longitude: 0 }, 999, 1), null);
  assert.equal(model.clusterNetworkMapPoints(points, { ...region, latitudeDelta: 0 }, size).length, 0);
  const padding = model.networkMapPadding({ top: 200, right: 10, bottom: 500, left: 10 }, { width: 390, height: 844 });
  assert.equal(padding.top, 200); assert.equal(padding.bottom, 500);
  const constrained = model.networkMapPadding({ top: 900, bottom: 900, left: -10, right: NaN }, size);
  assert.ok(constrained.top + constrained.bottom <= size.height - 96);
  assert.equal(constrained.left, 0); assert.equal(constrained.right, 0);
});
let hooks;
const effect = (fn, deps) => { const owner = hooks, i = owner.ei++, previous = owner.effects[i];
  if (!previous || !deps || deps.some((d, n) => d !== previous.deps[n])) owner.effects[i] = { fn, deps, dirty: true, cleanup: previous?.cleanup }; };
const react = { Component: class {}, useEffect: effect, useLayoutEffect: effect,
  useState: initial => { const owner = hooks, i = owner.si++; if (!(i in owner.values)) owner.values[i] = typeof initial === 'function' ? initial() : initial;
    return [owner.values[i], value => { owner.values[i] = typeof value === 'function' ? value(owner.values[i]) : value; }]; },
  useRef: initial => { const i = hooks.ri++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); } };
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
let appListener, available = true, sdkLoads = 0;
const rn = { View: 'View', Text: 'Text', Pressable: 'Button', Platform: { OS: 'android' }, StyleSheet: { create: value => value, absoluteFill: {} },
  UIManager: { getViewManagerConfig: () => available ? {} : null },
  AppState: { addEventListener: (_type, callback) => { appListener = callback; return { remove: () => {} }; } } };
const native = load(files[2], { react, 'react/jsx-runtime': jsx, 'react-native': rn,
  'react-native-svg': { default: 'Svg', Path: 'Path' }, '@/services/NetworkCategoryRegistryV2': categories,
  './NetworkMapModel': model, 'react-native-maps': new Proxy({ default: 'NativeMap', Marker: 'Marker', PROVIDER_GOOGLE: 'google' }, { get: (obj, key) => { sdkLoads++; return obj[key]; } }) });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
function fixture(component, props) {
  const state = { values: [], refs: [], effects: [], si: 0, ri: 0, ei: 0 };
  return { render: () => { hooks = state; state.si = state.ri = state.ei = 0; const tree = component(props);
    for (const item of state.effects) if (item?.dirty) { item.cleanup?.(); item.cleanup = item.fn(); item.dirty = false; } return tree; },
    cleanup: () => state.effects.forEach(item => item.cleanup?.()) };
}
const props = () => ({ snapshot: snapshot(), configuration: 'READY', camera: { requestId: 'initial', region }, onSelect: () => {} });
function session(input) {
  const root = fixture(native.NetworkMap, input); const child = root.render();
  const unit = fixture(child.type, child.props); let tree = unit.render(); tree = unit.render();
  nodes(tree).find(n => n.props?.onLayout)?.props.onLayout({ nativeEvent: { layout: size } });
  tree = unit.render(); const map = nodes(tree).find(n => n.type === 'NativeMap');
  const moves = []; map.props.ref.current = { animateToRegion: value => moves.push(value) };
  map.props.onMapReady(); tree = unit.render();
  return { root, unit, input: child.props, tree, moves };
}
test('native capability/config gates; no SDK load on Web or missing configuration', () => {
  const input = props(); input.configuration = 'MISSING'; const root = fixture(native.NetworkMap, input);
  root.render(); assert.equal(sdkLoads, 0); input.configuration = 'READY'; rn.Platform.OS = 'web';
  root.render(); assert.equal(sdkLoads, 0); rn.Platform.OS = 'android'; root.cleanup();
  available = false; const a = fixture(native.NetworkMap, props()); const child = a.render(); const b = fixture(child.type, child.props);
  b.render(); assert.equal(nodes(b.render()).some(n => n.type === 'NativeMap'), false); a.cleanup(); b.cleanup(); available = true;
});
test('actual native surface: public markers, callbacks, manual pan, explicit recenter and scope replacement', () => {
  const input = props(); const selections = []; input.onSelect = value => selections.push(value);
  const s = session(input); let tree = s.tree; const map = nodes(tree).find(n => n.type === 'NativeMap');
  assert.equal(map.props.showsUserLocation, false); assert.equal(map.props.showsMyLocationButton, false);
  assert.equal(map.props.toolbarEnabled, false); assert.equal(map.props.provider, 'google');
  const pin = nodes(tree).find(n => n.type === 'Marker'); pin.props.onPress(); assert.equal(selections.length, 1);
  assert.deepEqual(Object.keys(selections[0]).sort(), ['kind', 'publicIds']);
  const initialMoves = s.moves.length;
  map.props.onRegionChangeComplete({ ...region, longitude: 1 }); s.unit.render();
  assert.equal(s.moves.length, initialMoves, 'manual pan must not snap back');
  s.input.snapshot = snapshot([marker(2)], 2); tree = s.unit.render();
  pin.props.onPress(); assert.equal(selections.length, 1, 'obsolete pin cannot select an old snapshot');
  assert.equal(s.moves.length, initialMoves, 'data updates must not move camera');
  s.input.camera = { requestId: 'move', region: { ...region, longitude: 2 } }; s.unit.render(); assert.equal(s.moves.length, initialMoves + 1);
  const oldKey = s.root.render().key; input.snapshot = { ...snapshot([], 0), scopeKey: 'new-scope' };
  assert.notEqual(s.root.render().key, oldKey, 'scope must remount native session');
  s.unit.cleanup(); pin.props.onPress(); assert.equal(selections.length, 1); s.root.cleanup();
  rn.Platform.OS = 'ios'; const ios = session(props()); assert.equal(nodes(ios.tree).find(n => n.type === 'NativeMap').props.provider, undefined);
  ios.unit.cleanup(); ios.root.cleanup(); rn.Platform.OS = 'android';
});
test('expiry, offline/loading, out-of-order response and late native ready after timeout fail closed', () => {
  const input = props(); input.snapshot = snapshot([{ ...marker(), validUntil: new Date(time + 100).toISOString() }]);
  let count = 0; input.onSelect = () => count++; const s = session(input); const pin = nodes(s.tree).find(n => n.type === 'Marker');
  time += 101; pin.props.onPress(); assert.equal(count, 0);
  const expiry = [...timers.values()].find(timer => timer.delay === 101); assert.ok(expiry); expiry.fn();
  assert.equal(nodes(s.unit.render()).filter(n => n.type === 'Marker').length, 0);
  appListener('active'); assert.equal(nodes(s.unit.render()).filter(n => n.type === 'Marker').length, 0);
  for (const state of ['LOADING', 'ERROR']) { s.input.snapshot = { ...snapshot([marker()], 5), state }; assert.equal(nodes(s.unit.render()).filter(n => n.type === 'Marker').length, 0); }
  s.input.snapshot = snapshot([marker()], 4); assert.equal(nodes(s.unit.render()).filter(n => n.type === 'Marker').length, 0);
  s.unit.cleanup(); s.root.cleanup();
  const r = fixture(native.NetworkMap, props()); const child = r.render(); const u = fixture(child.type, child.props);
  u.render(); const tree = u.render(); const oldReady = nodes(tree).find(n => n.type === 'NativeMap').props.onMapReady;
  const timeout = [...timers.values()].find(timer => timer.delay === 10000); assert.ok(timeout); timeout.fn();
  oldReady(); assert.equal(nodes(u.render()).some(n => n.type === 'NativeMap'), false);
  u.cleanup(); r.cleanup();
});
test('explicit draft map taps are isolated from public markers, stale callbacks and invalid coordinates', () => {
  const chosen = []; const input = props(); input.eventDraft = { point: null, onChoose: point => chosen.push(point) };
  const s = session(input); let map = nodes(s.tree).find(n => n.type === 'NativeMap');
  map.props.onPress({ nativeEvent: { action: 'marker-press', coordinate: { latitude: 1, longitude: 1 } } }); assert.equal(chosen.length, 0);
  map.props.onPress({ nativeEvent: { action: 'press', coordinate: { latitude: 1, longitude: 1 } } }); assert.equal(chosen.length, 1);
  map.props.onPress({ nativeEvent: { action: 'press', coordinate: { latitude: NaN, longitude: 1 } } }); assert.equal(chosen.length, 1);
  const oldTap = map.props.onPress; s.input.eventDraft = undefined;
  s.unit.render(); oldTap({ nativeEvent: { coordinate: { latitude: 2, longitude: 2 } } }); assert.equal(chosen.length, 1);
  s.input.eventDraft = { point: { latitude: 1, longitude: 1 }, onChoose: point => chosen.push(point) };
  let tree = s.unit.render(); assert.equal(nodes(tree).filter(n => n.type === 'Marker').length, 2);
  assert.equal(s.input.snapshot.markers.length, 1, 'draft must not enter the public DTO snapshot');
  s.input.eventDraft = { ...s.input.eventDraft, point: { latitude: NaN, longitude: 1 } };
  tree = s.unit.render(); assert.equal(nodes(tree).filter(n => n.type === 'Marker').length, 1);
  s.unit.cleanup(); s.root.cleanup();
});

test('strict TypeScript and no backend/demo/GPS dependencies', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /NetworkPrototypeDemo|NETWORK_DEMO|expo-location|AsyncStorage|\.rpc\(|fetch\(|SOSService|process\.env|expo-constants/);
    assert.doesNotMatch(source, /[\t ]+\r?$/m);
  }
  const modules = path.resolve(path.dirname(require.resolve('typescript')), '..', '..');
  const program = ts.createProgram(files.map(file => path.join(root, file)), { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, baseUrl: root,
    typeRoots: [path.join(modules, '@types')], types: ['react', 'node'],
    paths: { '@/*': ['./*'], react: [path.join(modules, '@types/react/index.d.ts')], 'react/*': [path.join(modules, '@types/react/*')], '*': [path.join(modules, '*'), path.join(modules, '@types/*')] } });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => '\n' }));
});
console.log(`${passed} targeted checks PASS. Native engine, provider/network behavior, accessibility and device/load tests NOT verified.`);
