'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const sources = ['services/NetworkPrototypeDemo.ts', 'components/NetworkPrototypeActivity.ts', 'components/NetworkPrototypeConversation.tsx', 'components/NetworkPrototypeMap.tsx', 'components/NetworkPrototypeMap.web.tsx', 'screens/NetworkPrototypeScreen.tsx', 'app/network-prototype.tsx'];
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => tree === null || tree === undefined || tree === false ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ').replace(/\s+/g, ' ').trim() : text(tree.props?.children);
const context = vm.createContext({ console });
function load(file, dependencies = {}) {
  context.exports = {};
  context.require = name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInContext(`(function(exports, require) {\n${code}\n})(exports, require);`, context, { filename: file });
  return context.exports;
}
const categories = load('services/NetworkCategoryRegistryV2.ts');
const contract = load('services/NetworkMapContractV2.ts', { './NetworkCategoryRegistryV2': categories });
const demo = load('services/NetworkPrototypeDemo.ts', { './NetworkMapContractV2': contract, './NetworkCategoryRegistryV2': categories });
const activity = load('components/NetworkPrototypeActivity.ts');
const originalDataset = JSON.stringify(demo.NETWORK_DEMO_EVENTS);
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('12 valid synthetic V2 events, five categories, operational and identity-free history', () => {
  assert.equal(demo.NETWORK_DEMO_EVENTS.length, 12);
  assert.equal(new Set(demo.NETWORK_DEMO_EVENTS.map(e => e.detail.marker.publicId)).size, 12);
  assert.equal(new Set(demo.NETWORK_DEMO_EVENTS.map(e => e.detail.marker.categoryId)).size, 5);
  for (const entry of demo.NETWORK_DEMO_EVENTS) {
    assert.equal(demo.isValidNetworkDemoEvent(entry), true, entry.title);
    if (entry.detail.marker.kind === 'REVIEWED_HISTORY') assert.equal('authorNickname' in entry.detail, false);
    else assert.ok(entry.detail.authorNickname.startsWith('Demo_'));
  }
  assert.equal(demo.NETWORK_DEMO_EVENTS.filter(e => e.detail.marker.status === 'ACTIVE').length, 8);
  assert.equal(demo.NETWORK_DEMO_EVENTS.filter(e => e.detail.marker.status === 'RESOLVED').length, 2);
  assert.equal(demo.NETWORK_DEMO_EVENTS.filter(e => e.detail.marker.kind === 'REVIEWED_HISTORY').length, 2);
});
const defaultFilters = { status: 'ACTIVE', category: null, query: '', radiusMeters: 2500 };
test('real demo filtering/radii, clusters count only filtered markers, no invented risk band', () => {
  const all = demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, defaultFilters);
  assert.equal(all.length, 7);
  assert.equal(demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, { ...defaultFilters, radiusMeters: 1000 }).length, 6);
  assert.equal(demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, { ...defaultFilters, radiusMeters: 5000 }).length, 8);
  assert.equal(demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, { ...defaultFilters, radiusMeters: 1500 }).length, 0);
  assert.equal(demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, { ...defaultFilters, query: 'piazza zanti' }).length, 1);
  const light = demo.filterNetworkDemoEvents(all, { ...defaultFilters, category: 'LIGHTING' });
  assert.equal(light.length, 2);
  const clusters = demo.clusterNetworkDemoEvents(all);
  assert.ok(clusters.some(c => c.entries.length >= 3));
  assert.equal(clusters.reduce((sum, c) => sum + c.entries.length, 0), all.length);
  assert.equal(new Set(clusters.flatMap(c => c.entries.map(e => e.detail.marker.publicId))).size, all.length);
  assert.equal(demo.clusterNetworkDemoEvents(all, 0).length, 0);
  for (const c of demo.clusterNetworkDemoEvents(light)) assert.ok(c.entries.every(e => e.detail.marker.categoryId === 'LIGHTING'));
});

test('recent activity comes only from actual fixture timestamps or explicit local confirmations', () => {
  const rows = activity.buildNetworkPrototypeActivity(demo.NETWORK_DEMO_EVENTS);
  assert.equal(rows.length, 17);
  assert.equal(rows.filter(row => row.kind === 'PUBLISHED').length, 10);
  assert.equal(rows.filter(row => row.kind === 'AUTHOR_UPDATE').length, 5);
  assert.equal(rows.filter(row => row.kind === 'RESOLVED').length, 2);
  assert.equal(rows.some(row => row.kind === 'LOCAL_CONFIRMATION'), false);
  assert.ok(rows.every((row, i) => !i || Date.parse(rows[i - 1].occurredAt) >= Date.parse(row.occurredAt)));
  for (const row of rows) {
    const entry = demo.NETWORK_DEMO_EVENTS.find(e => e.detail.marker.publicId === row.eventPublicId);
    assert.ok(entry && entry.detail.marker.kind === 'OPERATIONAL_EVENT');
    const knownDates = [entry.detail.marker.createdAt, entry.detail.marker.resolvedAt, ...entry.detail.updates.map(u => u.createdAt)];
    assert.ok(knownDates.includes(row.occurredAt));
  }
  const event = demo.NETWORK_DEMO_EVENTS[0];
  const local = activity.buildNetworkPrototypeActivity(demo.NETWORK_DEMO_EVENTS,
    new Map([[event.detail.marker.publicId, '2026-11-05T12:00:00.000Z']]));
  assert.equal(local.length, 18); assert.equal(local[0].kind, 'LOCAL_CONFIRMATION'); assert.equal(local[0].local, true);
  assert.equal(JSON.stringify(demo.NETWORK_DEMO_EVENTS), originalDataset);
});

const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
let hooks;
const react = {
  Component: class {},
  useState: initial => { const owner = hooks; const i = owner.si++; if (!(i in owner.values)) owner.values[i] = typeof initial === 'function' ? initial() : initial;
    return [owner.values[i], value => { owner.values[i] = typeof value === 'function' ? value(owner.values[i]) : value; }]; },
  useRef: initial => { const i = hooks.ri++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useMemo: fn => fn(),
  useEffect: (fn, deps) => { const i = hooks.ei++, previous = hooks.effects[i];
    if (!previous || deps.some((d, n) => d !== previous.deps[n])) hooks.effects[i] = { fn, deps, dirty: true, cleanup: previous?.cleanup }; },
};
const dimensions = { height: 844, width: 390 };
const rn = { View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', Text: 'Text', Pressable: 'Button', ScrollView: 'Scroll', TextInput: 'Input', Modal: 'Modal',
  Platform: { OS: 'android' }, UIManager: { getViewManagerConfig: () => null }, useWindowDimensions: () => dimensions,
  PanResponder: { create: value => ({ panHandlers: value }) }, StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {} } };
const timers = new Map(); let timerId = 0;
context.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
context.clearTimeout = id => timers.delete(id);
const base = { react, 'react/jsx-runtime': jsx, 'react-native': rn, '@expo/vector-icons': { Ionicons: 'Icon' },
  '@/services/NetworkPrototypeDemo': demo, '@/services/NetworkCategoryRegistryV2': categories,
  '@/components/NetworkPrototypeActivity': activity };
const conversationExports = load('components/NetworkPrototypeConversation.tsx', base);
base['@/components/NetworkPrototypeConversation'] = { ...conversationExports, NetworkPrototypeConversation: 'Conversation' };
const constants = { default: { expoConfig: { extra: { androidMapsConfigured: false } } } };
let sdkLoads = 0;
const sdk = { default: 'NativeMap', Marker: 'Marker', PROVIDER_GOOGLE: 'google' };
const mapExports = load('components/NetworkPrototypeMap.tsx', { ...base, 'expo-constants': constants,
  'react-native-svg': { default: 'Svg', Path: 'Path', Rect: 'Rect' },
  'react-native-maps': new Proxy(sdk, { get: (target, key) => { sdkLoads++; return target[key]; } }) });
const screenExports = load('screens/NetworkPrototypeScreen.tsx', { ...base,
  'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
  '@/components/NetworkPrototypeMap': { ...mapExports, NetworkPrototypeMap: 'PrototypeMap' } });
const webMapExports = load('components/NetworkPrototypeMap.web.tsx', { ...base,
  'react-native-svg': { default: 'Svg', G: 'G', Path: 'Path', Rect: 'Rect' } });
// require is lexical in CJS output; retain a unified dependency map for callbacks/effects.
context.require = name => ({ ...base, 'expo-constants': constants, 'react-native-maps': sdk,
  'react-native-svg': { default: 'Svg', Path: 'Path', Rect: 'Rect' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
  '@/components/NetworkPrototypeMap': { ...mapExports, NetworkPrototypeMap: 'PrototypeMap' } })[name];
function fixture(component, props) {
  const state = { values: [], refs: [], effects: [], si: 0, ri: 0, ei: 0 };
  return {
    render: () => { hooks = state; state.si = state.ri = state.ei = 0; const tree = component(props);
      for (const node of nodes(tree)) if (node.type === 'NativeMap') node.props.ref.current = { animateToRegion: () => {} };
      for (const effect of state.effects) if (effect.dirty) { effect.cleanup?.(); effect.cleanup = effect.fn(); effect.dirty = false; }
      return tree;
    }, cleanup: () => state.effects.forEach(e => e.cleanup?.()),
  };
}
function button(tree, label) {
  const result = nodes(tree).find(n => n.type === 'Button' && (n.props.accessibilityLabel === label || text(n) === label));
  assert.ok(result, `Missing UI action: ${label}`); return result;
}
test('actual screen: status/category/search/radius, cluster/list/detail and local confirmation', () => {
  const screen = fixture(screenExports.NetworkPrototypeScreen, { onClose: () => {} });
  let tree = screen.render();
  assert.ok(text(tree).includes('DEMO'));
  assert.ok(text(tree).includes('7 esempi nel territorio'));
  const canvas = nodes(tree).find(n => n.type === 'PrototypeMap');
  const cluster = canvas.props.clusters.find(c => c.entries.length >= 3);
  canvas.props.onSelect(cluster); tree = screen.render();
  assert.ok(text(tree).includes('Selezione sulla mappa'));
  button(tree, `Dettaglio demo: ${cluster.entries[0].title}`).props.onPress(); tree = screen.render();
  assert.ok(text(tree).includes(cluster.entries[0].detail.authorNickname));
  assert.ok(text(tree).includes('Cronologia e aggiornamenti'));
  const confirm = button(tree, 'Confermo · demo'); confirm.props.onPress(); tree = screen.render();
  assert.equal(button(tree, 'Confermato · demo').props.disabled, true);
  button(tree, 'Storico').props.onPress(); tree = screen.render();
  assert.ok(text(tree).includes('2 esempi nel territorio'));
  button(tree, 'Apri elenco degli eventi demo').props.onPress(); tree = screen.render();
  button(tree, 'Dettaglio demo: Cura degli spazi condivisi').props.onPress(); tree = screen.render();
  assert.ok(text(tree).includes('Nessun nickname'));
  assert.equal(nodes(tree).some(n => n.type === 'Button' && text(n) === 'Confermo · demo'), false);
  button(tree, 'Concluse').props.onPress(); tree = screen.render(); assert.ok(text(tree).includes('2 esempi nel territorio'));
  button(tree, 'Attive').props.onPress(); tree = screen.render();
  button(tree, 'Mostra filtri e raggio').props.onPress(); tree = screen.render();
  button(tree, 'Raggio demo 1 km').props.onPress(); tree = screen.render(); assert.ok(text(tree).includes('6 esempi nel territorio'));
  nodes(tree).find(n => n.type === 'Input').props.onChangeText('inesistente'); tree = screen.render(); assert.ok(text(tree).includes('0 esempi nel territorio'));
  nodes(tree).find(n => n.type === 'Input').props.onChangeText(''); tree = screen.render();
  button(tree, 'Illuminazione').props.onPress(); tree = screen.render(); assert.ok(text(tree).includes('2 esempi nel territorio'));
  button(tree, 'Segnala, anteprima senza pubblicazione').props.onPress(); tree = screen.render();
  assert.equal(nodes(tree).find(n => n.type === 'Modal').props.visible, true);
  button(tree, 'Torna alla mappa demo').props.onPress(); tree = screen.render();
  assert.equal(nodes(tree).find(n => n.type === 'Modal').props.visible, false);
  assert.equal(JSON.stringify(demo.NETWORK_DEMO_EVENTS), originalDataset);
  screen.cleanup();
});

test('social follow/unfollow, idempotent confirm, recent activity deep-link and compact responsive panel', () => {
  for (const width of [390, 1280]) {
    dimensions.width = width; dimensions.height = 844;
    const screen = fixture(screenExports.NetworkPrototypeScreen, { onClose: () => {} });
    let tree = screen.render();
    const sheet = () => nodes(tree).find(n => n.props?.accessibilityLabel === 'Pannello NETWORK');
    assert.equal(sheet().props.style[2].height, 112);
    if (width === 1280) assert.equal(sheet().props.style[1].width, 400);
    else assert.equal(sheet().props.style[1].left, 10);
    button(tree, 'Apri elenco degli eventi demo').props.onPress(); tree = screen.render();
    button(tree, 'Dettaglio demo: Un punto luce da verificare').props.onPress(); tree = screen.render();
    button(tree, 'Segui segnalazione demo').props.onPress(); tree = screen.render();
    assert.ok(text(tree).includes('Seguita · demo'));
    button(tree, 'Smetti di seguire segnalazione demo').props.onPress(); tree = screen.render();
    assert.ok(text(tree).includes('Segui segnalazione · demo'));
    const confirm = button(tree, 'Confermo · demo'); confirm.props.onPress(); confirm.props.onPress(); tree = screen.render();
    assert.ok(text(tree).includes('4 conferme demo')); // fixture=3, exactly one local confirmation
    assert.ok(text(tree).includes('Confermata da te · demo'));
    assert.ok(text(tree).includes('ULTIMO AGGIORNAMENTO'));
    button(tree, 'Riduci pannello NETWORK').props.onPress(); tree = screen.render();
    assert.equal(sheet().props.style[2].height, 112);
    button(tree, 'Apri Attività recente demo').props.onPress(); tree = screen.render();
    assert.ok(text(tree).includes('Attività recente'));
    const firstActivity = nodes(tree).find(n => n.type === 'Button' && n.props.accessibilityLabel?.startsWith('Apri attività demo:'));
    assert.ok(firstActivity); firstActivity.props.onPress(); tree = screen.render();
    assert.ok(text(tree).includes('Un punto luce da verificare'));
    assert.ok(nodes(tree).find(n => n.type === 'PrototypeMap').props.focusTarget);
    screen.cleanup();
  }
  dimensions.width = 390;
  assert.equal(JSON.stringify(demo.NETWORK_DEMO_EVENTS), originalDataset);
});

test('actual map: no key/capability => explicit offline mode; configured native map has no user location', () => {
  const props = { clusters: demo.clusterNetworkDemoEvents(demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, defaultFilters)),
    radiusMeters: 2500, recenterToken: 0, topInset: 235, bottomInset: 168, onSelect: () => {}, onZoom: () => {} };
  const offline = fixture(mapExports.NetworkPrototypeMap, props);
  offline.render(); let tree = offline.render();
  assert.ok(text(tree).includes('Schema offline'));
  assert.equal(nodes(tree).some(n => n.type === 'NativeMap'), false);
  assert.ok(nodes(tree).some(n => n.type === 'Button' && /Apri gruppo/.test(n.props.accessibilityLabel)));
  assert.equal(sdkLoads, 0); offline.cleanup();
  constants.default.expoConfig.extra.androidMapsConfigured = true;
  rn.UIManager.getViewManagerConfig = () => ({});
  const native = fixture(mapExports.NetworkPrototypeMap, props);
  native.render(); tree = native.render();
  const map = nodes(tree).find(n => n.type === 'NativeMap'); assert.ok(map);
  assert.equal(map.props.showsUserLocation, false); assert.equal(map.props.showsMyLocationButton, false);
  assert.ok(map.props.mapPadding.bottom >= 168);
  map.props.onMapReady(); tree = native.render(); assert.ok(text(tree).includes('tutti gli eventi sono inventati'));
  native.cleanup(); assert.equal(timers.size, 0);
});

test('Web-only illustration: markers/clusters, zoom, pointer pan, keyboard and recenter without native imports', () => {
  let selected = null; const zoomCalls = [];
  const props = { clusters: demo.clusterNetworkDemoEvents(demo.filterNetworkDemoEvents(demo.NETWORK_DEMO_EVENTS, defaultFilters)),
    radiusMeters: 2500, recenterToken: 0, topInset: 235, bottomInset: 168,
    onSelect: cluster => { selected = cluster; }, onZoom: value => zoomCalls.push(value) };
  const canvas = fixture(webMapExports.NetworkPrototypeMap, props);
  let tree = canvas.render(); tree = canvas.render();
  assert.ok(text(tree).includes('non è una mappa reale di Cavriago'));
  const pins = () => nodes(tree).filter(n => n.type === 'Button' && /^Apri /.test(n.props.accessibilityLabel ?? ''));
  assert.ok(pins().some(n => /gruppo/.test(n.props.accessibilityLabel)));
  pins()[0].props.onPress(); assert.ok(selected);
  const beforeZoom = pins()[0].props.style[1].left;
  button(tree, 'Ingrandisci schema demo').props.onPress(); tree = canvas.render();
  assert.ok(text(tree).includes('2.7')); assert.notEqual(pins()[0].props.style[1].left, beforeZoom);
  const beforePan = pins()[0].props.style[1].left;
  let surface = nodes(tree).find(n => n.type === 'div');
  surface.props.onPointerDown({ target: { closest: () => null }, clientX: 20, clientY: 20, pointerId: 1,
    currentTarget: { setPointerCapture: () => {} } });
  surface.props.onPointerMove({ clientX: 80, clientY: 20 }); tree = canvas.render();
  assert.ok(Math.abs(pins()[0].props.style[1].left - beforePan - 60) < 0.000001);
  surface = nodes(tree).find(n => n.type === 'div');
  surface.props.onPointerUp({ pointerId: 1, currentTarget: { hasPointerCapture: () => true, releasePointerCapture: () => {} } });
  surface.props.onKeyDown({ key: 'ArrowLeft', preventDefault: () => {} }); tree = canvas.render();
  assert.ok(Math.abs(pins()[0].props.style[1].left - beforePan - 120) < 0.000001);
  props.recenterToken++; canvas.render(); tree = canvas.render();
  assert.ok(text(tree).includes('2.0')); assert.equal(pins()[0].props.style[1].left, beforeZoom);
  assert.ok(zoomCalls.length >= 2); canvas.cleanup();
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'components/NetworkPrototypeMap.web.tsx'), 'utf8'),
    /react-native-maps|expo-constants|UIManager|fetch\(|LocationService|supabase|https?:\/\//);
});

test('development-only gate: production stays OFF even with legacy flag or extra arguments', () => {
  assert.equal(demo.networkPrototypeEnabled(false), false);
  assert.equal(Reflect.apply(demo.networkPrototypeEnabled, undefined, [false, 'true']), false);
  assert.equal(Reflect.apply(demo.networkPrototypeEnabled, undefined, ['true']), false);
  assert.equal(demo.networkPrototypeEnabled(true), true);
  for (const file of sources) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /NetworkService|NetworkRepository|supabase|AsyncStorage|LocationService|fetch\(|\.rpc\(|SOSService|sendSms/);
    assert.doesNotMatch(source, /[\t ]+\r?$/m);
  }
  const routeSource = fs.readFileSync(path.join(root, 'app/network-prototype.tsx'), 'utf8');
  assert.match(routeSource, /networkPrototypeEnabled\(__DEV__\)/);
  assert.doesNotMatch(routeSource, /EXPO_PUBLIC_NETWORK_PROTOTYPE|process\.env/);
  context.__DEV__ = false;
  context.process = { env: {} };
  const router = { canGoBack: () => true, back: () => {}, replace: () => {} };
  const route = load('app/network-prototype.tsx', { 'react/jsx-runtime': jsx, 'react-native': rn,
    'expo-router': { Stack: { Screen: 'StackScreen' }, useRouter: () => router },
    '@/screens/NetworkPrototypeScreen': { NetworkPrototypeScreen: 'PrototypeScreen' },
    '@/services/NetworkPrototypeDemo': demo }).default;
  assert.equal(nodes(route()).some(n => n.type === 'PrototypeScreen'), false);
  context.process.env.EXPO_PUBLIC_NETWORK_PROTOTYPE = 'true';
  assert.equal(nodes(route()).some(n => n.type === 'PrototypeScreen'), false);
  delete context.process.env.EXPO_PUBLIC_NETWORK_PROTOTYPE;
  context.__DEV__ = true;
  assert.equal(nodes(route()).some(n => n.type === 'PrototypeScreen'), true);
});

test('isolated Web entry is dev-only and never mounts operational app/providers', () => {
  const source = fs.readFileSync(path.join(root, 'prototype-web/index.tsx'), 'utf8');
  assert.doesNotMatch(source, /expo-router|AuthProvider|NetworkService|NetworkRepository|SOSService|supabase|process\.env/);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'prototype-web/package.json'), 'utf8')).dependencies ?? {}).length, 0);
  const entry = load('prototype-web/index.tsx', { react, 'react/jsx-runtime': jsx, 'react-native': rn,
    expo: { registerRootComponent: () => {} }, 'react-native-safe-area-context': { SafeAreaProvider: 'SafeProvider' },
    '../screens/NetworkPrototypeScreen': { NetworkPrototypeScreen: 'PrototypeScreen' } }).NetworkWebPreview;
  const preview = fixture(entry, {});
  context.__DEV__ = false;
  assert.equal(nodes(preview.render()).some(n => n.type === 'PrototypeScreen'), false);
  context.__DEV__ = true;
  let tree = preview.render(); const screen = nodes(tree).find(n => n.type === 'PrototypeScreen'); assert.ok(screen);
  screen.props.onClose(); tree = preview.render(); assert.equal(nodes(tree).some(n => n.type === 'PrototypeScreen'), false);
  button(tree, 'Riapri NETWORK demo').props.onPress(); tree = preview.render();
  assert.equal(nodes(tree).some(n => n.type === 'PrototypeScreen'), true); preview.cleanup();
});

test('local conversations: chronological seeds, operational isolation, publish/count/report, duplicate safety and history separation', () => {
  const seeds = conversationExports.seedNetworkDemoComments(demo.NETWORK_DEMO_EVENTS);
  assert.equal(seeds.length, 20);
  assert.ok(seeds.every(comment => demo.NETWORK_DEMO_EVENTS.some(e => e.detail.marker.publicId === comment.eventPublicId && e.detail.marker.kind === 'OPERATIONAL_EVENT')));
  for (const width of [390, 1280]) {
    dimensions.width = width;
    const screen = fixture(screenExports.NetworkPrototypeScreen, { onClose: () => {} });
    let tree = screen.render();
    const event = demo.NETWORK_DEMO_EVENTS.find(e => e.detail.marker.status === 'ACTIVE');
    nodes(tree).find(n => n.type === 'PrototypeMap').props.onSelect({ entries: [event] });
    tree = screen.render();
    const beforeKeyboard = nodes(tree).find(n => n.props?.accessibilityLabel === 'Pannello NETWORK').props.style.at(-1).height;
    nodes(tree).find(n => n.type === 'View' && n.props.onLayout).props.onLayout({ nativeEvent: { layout: { height: 520 } } });
    tree = screen.render();
    const afterKeyboard = nodes(tree).find(n => n.props?.accessibilityLabel === 'Pannello NETWORK').props.style.at(-1).height;
    assert.ok(afterKeyboard < beforeKeyboard, 'panel must fit the keyboard-reduced stage');
    let link = nodes(tree).find(n => n.type === 'Conversation'); assert.ok(link);
    const props = { ...link.props };
    const discussion = fixture(conversationExports.NetworkPrototypeConversation, props);
    let ui = discussion.render(); assert.ok(text(ui).includes('2 commenti'));
    assert.equal(nodes(ui).some(n => n.type === 'Input'), false);
    button(ui, 'Apri conversazione demo').props.onPress(); ui = discussion.render();
    assert.ok(text(ui).includes('AUTORE')); assert.ok(text(ui).includes('non sono servizi attivi'));
    const dates = props.comments.filter(c => c.eventPublicId === props.eventPublicId).map(c => Date.parse(c.createdAt));
    assert.ok(dates[0] <= dates[1]);
    assert.equal(button(ui, 'Pubblica commento demo').props.disabled, true);
    nodes(ui).find(n => n.type === 'Input').props.onChangeText('  Messaggio locale di prova  '); ui = discussion.render();
    const publish = button(ui, 'Pubblica commento demo').props.onPress;
    publish(); publish();
    tree = screen.render(); link = nodes(tree).find(n => n.type === 'Conversation'); Object.assign(props, link.props);
    ui = discussion.render();
    assert.ok(text(ui).includes('3 commenti')); assert.ok(text(ui).includes('Messaggio locale di prova'));
    assert.ok(text(ui).includes('Nessun invio reale')); assert.equal(nodes(ui).find(n => n.type === 'Input').props.value, '');
    const report = nodes(ui).find(n => n.type === 'Button' && n.props.accessibilityLabel?.startsWith('Segnala commento demo'));
    report.props.onPress(); ui = discussion.render();
    assert.ok(text(ui).includes('Segnalato · demo')); assert.ok(text(ui).includes('Nessun moderatore'));
    button(ui, 'Chiudi conversazione demo').props.onPress(); ui = discussion.render();
    assert.equal(nodes(ui).some(n => n.type === 'Input'), false);
    const another = demo.NETWORK_DEMO_EVENTS.find(e => e.detail.marker.kind === 'OPERATIONAL_EVENT' && e !== event);
    nodes(tree).find(n => n.type === 'PrototypeMap').props.onSelect({ entries: [another] }); tree = screen.render();
    assert.equal(nodes(tree).find(n => n.type === 'Conversation').props.comments.filter(c => c.eventPublicId === another.detail.marker.publicId).length, 2);
    const history = demo.NETWORK_DEMO_EVENTS.find(e => e.detail.marker.kind === 'REVIEWED_HISTORY');
    nodes(tree).find(n => n.type === 'PrototypeMap').props.onSelect({ entries: [history] }); tree = screen.render();
    assert.equal(nodes(tree).some(n => n.type === 'Conversation'), false);
    const sample = { id: 'test-local', eventPublicId: history.detail.marker.publicId, nickname: 'Demo_Tu', createdAt: new Date().toISOString(), body: 'Not allowed', state: 'VISIBLE' };
    assert.equal(conversationExports.appendNetworkDemoComment(seeds, demo.NETWORK_DEMO_EVENTS, sample), seeds);
    for (const body of ['', '   ', 'x'.repeat(501)]) assert.equal(conversationExports.appendNetworkDemoComment(seeds, demo.NETWORK_DEMO_EVENTS, { ...sample, eventPublicId: event.detail.marker.publicId, body }), seeds);
    discussion.cleanup(); screen.cleanup();
  }
  const item = seeds[0];
  const hidden = fixture(conversationExports.NetworkPrototypeConversation, { eventPublicId: item.eventPublicId, authorNickname: item.nickname,
    comments: [{ ...item, state: 'HIDDEN', body: 'DO NOT DISPLAY' }], onPublish: () => assert.fail('read must not publish') });
  let ui = hidden.render(); button(ui, 'Apri conversazione demo').props.onPress(); ui = hidden.render();
  assert.ok(text(ui).includes('Commento nascosto')); assert.ok(!text(ui).includes('DO NOT DISPLAY'));
  hidden.cleanup(); dimensions.width = 390;
  assert.equal(JSON.stringify(demo.NETWORK_DEMO_EVENTS), originalDataset);
});

test('strict TypeScript of all prototype files and preserved V2 contracts', () => {
  const modules = path.resolve(path.dirname(require.resolve('typescript')), '..', '..');
  const files = [...sources, 'services/NetworkCategoryRegistryV2.ts', 'services/NetworkMapContractV2.ts', 'prototype-web/index.tsx'];
  const program = ts.createProgram(files.map(file => path.join(root, file)), {
    strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    baseUrl: root, typeRoots: [path.join(modules, '@types')], types: ['react', 'node'],
    paths: { '@/*': ['./*'], react: [path.join(modules, '@types/react/index.d.ts')],
      'react/*': [path.join(modules, '@types/react/*')], '*': [path.join(modules, '*'), path.join(modules, '@types/*')] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
  }));
});
console.log(`${passed} local prototype checks PASS; native rendering, cartography and device accessibility NOT verified.`);
