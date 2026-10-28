const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
function fixture(configured = true, native = true) {
  const values = [], refs = [], effects = [], cameras = [], timers = new Map();
  let si = 0, ri = 0, ei = 0, loads = 0, timerId = 0;
  const modules = {
    'expo-constants': { default: { expoConfig: { extra: { androidMapsConfigured: configured } } } },
    'react-native': { Platform: { OS: 'android' }, UIManager: { getViewManagerConfig: () => native ? {} : null },
      View: 'View', Text: 'Text', Pressable: 'Button', StyleSheet: { create: x => x, absoluteFill: {}, absoluteFillObject: {} } },
    '@/services/ReceivedSOSDetail': { describePositionAge: () => 'age' },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native-maps': { default: 'NativeMap', Marker: 'Marker', PROVIDER_GOOGLE: 'google' },
    react: {
      Component: class {},
      useState: initial => { const i = si++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = v; }]; },
      useRef: value => { const i = ri++; return refs[i] ?? (refs[i] = { current: value }); },
      useEffect: (fn, deps) => { const i = ei++, old = effects[i];
        if (!old || deps.some((v, j) => v !== old.deps[j])) effects[i] = { fn, deps, dirty: true, cleanup: old?.cleanup }; },
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/ReceivedSOSMap.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => { assert.ok(modules[name], name); if (name === 'react-native-maps') loads++; return modules[name]; },
    Date, Math, setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const selection = { position: { latitude: 1, longitude: 2, observedAt: null, accuracy: null }, lastKnown: false, issue: null };
  let props = { authorized: true, selection, verifiedAt: 1000 };
  function render(next = {}) {
    props = { ...props, ...next }; si = ri = ei = 0;
    const tree = exports.ReceivedSOSMap(props);
    const map = nodes(tree).find(n => n.type === 'NativeMap');
    if (map) map.props.ref.current = { animateCamera: v => cameras.push(v) };
    for (const effect of effects) if (effect.dirty) { effect.cleanup?.(); effect.cleanup = effect.fn(); effect.dirty = false; }
    return tree;
  }
  return { render, cameras, timers, get loads() { return loads; }, selection,
    cleanup: () => effects.forEach(e => e.cleanup?.()) };
}
for (const [configured, native] of [[false, true], [true, false]]) {
  const f = fixture(configured, native); f.render(); const tree = f.render();
  assert.equal(f.loads, 0); assert.ok(!nodes(tree).some(n => n.type === 'NativeMap')); f.cleanup();
}
console.log('PASS missing key/native capability: safe fallback without SDK loading');
{
  const f = fixture(); f.render(); let tree = f.render();
  assert.equal(f.loads, 1);
  const first = nodes(tree).find(n => n.type === 'NativeMap');
  assert.equal(first.props.initialRegion.latitude, 1);
  assert.equal(first.props.showsUserLocation, false); assert.equal(first.props.toolbarEnabled, false);
  assert.equal(nodes(tree).find(n => n.type === 'Marker').props.coordinate.longitude, 2);
  first.props.onMapReady(); f.render(); assert.equal(f.cameras.length, 1);
  first.props.onRegionChangeComplete({}, { isGesture: false }); f.render();
  tree = f.render({ selection: { ...f.selection, position: { ...f.selection.position, latitude: 3 } } });
  assert.equal(f.cameras.at(-1).center.latitude, 3);
  assert.equal(f.cameras.length, 2, 'programmatic region callbacks do not disable following');
  nodes(tree).find(n => n.type === 'NativeMap').props.onRegionChangeComplete({}, { isGesture: true }); f.render();
  const pan = nodes(tree).find(n => n.type === 'NativeMap').props.onPanDrag;
  pan(); f.render(); const count = f.cameras.length;
  tree = f.render({ selection: { ...f.selection, position: { ...f.selection.position, latitude: 4 } } });
  assert.equal(f.cameras.length, count); assert.equal(nodes(tree).find(n => n.type === 'Marker').props.coordinate.latitude, 4);
  const recenter = nodes(tree).find(n => n.type === 'Button').props.onPress;
  recenter(); f.render(); assert.equal(f.cameras.length, count + 1); assert.equal(f.cameras.at(-1).center.latitude, 4);
  tree = f.render({ authorized: false, selection: { position: null, lastKnown: false, issue: null } });
  assert.ok(nodes(tree).some(n => n.type === 'NativeMap'), 'native surface stays mounted during routine authorization refresh');
  assert.ok(!nodes(tree).some(n => n.type === 'Marker'));
  assert.ok(nodes(tree).some(n => n.props.importantForAccessibility === 'no-hide-descendants'));
  const before = f.cameras.length; recenter(); pan(); assert.equal(f.cameras.length, before, 'old callbacks cannot access unverified coordinates');
  f.render({ authorized: true, selection: { ...f.selection, position: { ...f.selection.position, latitude: 4 } } });
  assert.equal(f.cameras.length, before, 'no camera movement for same fix after refresh');
  f.cleanup(); first.props.onMapReady(); recenter(); assert.equal(f.cameras.length, before); assert.equal(f.timers.size, 0);
}
console.log('PASS actual map component: marker updates, pan, recenter, refresh shield and obsolete callbacks');
{
  const f = fixture(); f.render(); f.render(); assert.equal(f.timers.size, 1);
  [...f.timers.values()][0](); const tree = f.render(); assert.ok(!nodes(tree).some(n => n.type === 'NativeMap'));
  f.cleanup();
}
console.log('PASS bounded native readiness timeout hides unavailable map');
{
  const f = fixture(); f.render(); const tree = f.render();
  const boundary = nodes(tree).find(n => typeof n.type === 'function' && n.type.prototype.componentDidCatch);
  const instance = new boundary.type(); instance.props = boundary.props; instance.componentDidCatch();
  const fallback = f.render();
  assert.ok(!nodes(fallback).some(n => n.type === 'NativeMap' || n.type === 'Button'));
  f.cleanup();
}
console.log('PASS native render failure also removes misleading follow/recenter controls');
const config = require('../app.config.js');
const previous = process.env.SAFEMELINK_ANDROID_MAPS_API_KEY;
try {
  delete process.env.SAFEMELINK_ANDROID_MAPS_API_KEY;
  const base = { android: { package: 'test' }, ios: { bundleIdentifier: 'unchanged' }, extra: { existing: true } };
  assert.equal(config({ config: base }).extra.androidMapsConfigured, false);
  process.env.SAFEMELINK_ANDROID_MAPS_API_KEY = 'process.env.FAKE';
  assert.equal(config({ config: base }).extra.androidMapsConfigured, false);
  process.env.SAFEMELINK_ANDROID_MAPS_API_KEY = 'synthetic-test-key-not-a-credential';
  const result = config({ config: base });
  assert.equal(result.extra.androidMapsConfigured, true);
  assert.equal(result.android.config.googleMaps.apiKey, process.env.SAFEMELINK_ANDROID_MAPS_API_KEY);
  assert.deepEqual(result.ios, base.ios); assert.equal(result.extra.existing, true);
} finally { if (previous === undefined) delete process.env.SAFEMELINK_ANDROID_MAPS_API_KEY; else process.env.SAFEMELINK_ANDROID_MAPS_API_KEY = previous; }
const source = fs.readFileSync('components/ReceivedSOSMap.tsx', 'utf8');
assert.doesNotMatch(source, /expo-location|setInterval|fetch\(|AsyncStorage|console\.|googleMapId|mapId|sender_display_name|sos_id/);
console.log('PASS dynamic Android-only key configuration; no extra GPS, polling, metadata or sensitive logging');
const workflow = fs.readFileSync('.github/workflows/android-test-apk.yml', 'utf8');
const prebuild = workflow.split('- name: Generate the ephemeral Android project')[1]?.split('- name:')[0];
const bundle = workflow.split('- name: Build standalone test APK')[1]?.split('- name:')[0];
for (const step of [prebuild, bundle]) {
  assert.ok(step);
  assert.match(step, /SAFEMELINK_ANDROID_MAPS_API_KEY: \$\{\{ secrets\.SAFEMELINK_ANDROID_MAPS_API_KEY \}\}/);
}
console.log('PASS optional Maps key reaches native generation AND JS config evaluation, never embedded in source');
console.log('Native rendering, gestures, tiles and API-key acceptance remain NOT VERIFIED without a real APK/device.');
