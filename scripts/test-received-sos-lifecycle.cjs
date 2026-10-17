const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const ID = '123e4567-e89b-42d3-a456-426614174000', OTHER = '123e4567-e89b-42d3-a456-426614174001';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture() {
  let now = 1_000_000, counter = 0, reads = 0, accepts = 0, concurrent = 0, maximum = 0;
  const timers = new Map(), states = [], held = [];
  let holdStatus = false, holdAccept = false, failure = null, statusError = null, status = 'open';
  let row = { sos_id: ID, sos_status: 'open', latitude: 1, longitude: 2, accuracy: 10, location_updated_at: new Date(now - 1000).toISOString() };
  const io = async fn => { concurrent++; maximum = Math.max(maximum, concurrent); try { return await fn(); } finally { concurrent--; } };
  const deps = {
    now: () => now,
    status: async id => io(async () => { reads++; if (holdStatus) return new Promise(resolve => held.push(() => resolve({ sos_id: id, sos_status: status })));
      if (statusError) throw statusError;
      if (failure) throw failure; return { sos_id: id, sos_status: status }; }),
    detail: async id => io(async () => { if (failure) throw failure; return { ...row, sos_id: id, sos_status: status }; }),
    accept: async id => io(async () => { accepts++; if (holdAccept) return new Promise(resolve => held.push(() => resolve({ sos_id: id, sos_status: 'accepted' })));
      return { sos_id: id, sos_status: 'accepted' }; }),
  };
  const exports = {};
  const modules = {
    '@/backend/errors/BackendError': { BackendError: class extends Error {}, classifyBackendError: error => error?.code === '42501' ? 'forbidden' : 'unknown' },
    '@/backend/repositories/ReceivedSOSRepository': { ReceivedSOSRepository: {} },
    '@/services/SOSLifecycleService': { SOSLifecycleService: {} },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/ReceivedSOSDetail.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => modules[name], Date, Math, Number,
      setTimeout: (fn, ms) => { const id = ++counter; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const controller = new exports.ReceivedSOSDetailController(state => states.push(state), deps);
  const advance = async ms => { now += ms; const ready = [...timers].filter(([, timer]) => timer.at <= now);
    for (const [id, timer] of ready) { timers.delete(id); timer.fn(); await flush(); } };
  return { controller, exports, advance, dependencies: deps, get state() { return states.at(-1); }, get reads() { return reads; },
    get accepts() { return accepts; }, get maximum() { return maximum; }, get timers() { return timers.size; },
    holdStatus: () => { holdStatus = true; }, holdAccept: () => { holdAccept = true; },
    release: () => { holdStatus = holdAccept = false; held.shift()?.(); },
    status: value => { status = value; }, fail: value => { failure = value; },
    statusError: value => { statusError = value; },
    row: value => { row = { ...row, ...value }; }, get now() { return now; } };
}
const cases = [
  ['actual Android screen: focus/background/account guards and stale navigator callback', async () => {
    const f = fixture(), values = [], refs = [], effects = [], urls = [];
    let stateIndex = 0, refIndex = 0, effectIndex = 0, focused = true, user = 'A', currentSOS = ID, appListener;
    const modules = {
      '@/services/ReceivedSOSDetail': { ...f.exports, ReceivedSOSDetailController: class extends f.exports.ReceivedSOSDetailController {
        constructor(publish) { super(publish, f.dependencies); }
      } },
      '@/backend/auth/AuthProvider': { useAuth: () => ({ session: user ? { user: { id: user } } : null, isInitializing: false }) },
      '@/components/ReceivedEmergencyInformation': { ReceivedEmergencyInformation: 'Profile' },
      '@/components/ReceivedSOSMap': { ReceivedSOSMap: 'Map' },
      '@/components/ReceivedPersonalSafetyInformation': { ReceivedPersonalSafetyInformation: 'PrivateProfile' },
      '@react-navigation/native': { useIsFocused: () => focused },
      'expo-router': { useLocalSearchParams: () => ({ id: currentSOS }), useRouter: () => ({ canGoBack: () => false, replace() {} }) },
      'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      'react-native': { ScrollView: 'ScrollView', View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: x => x },
        Linking: { openURL: async url => urls.push(url) }, BackHandler: { addEventListener: () => ({ remove() {} }) },
        AppState: { currentState: 'active', addEventListener: (_event, fn) => { appListener = fn; return { remove() {} }; } } },
      react: {
        useState: initial => { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = v; }]; },
        useRef: value => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: value }); },
        useEffect: (fn, deps) => { const i = effectIndex++, old = effects[i];
          if (!old || !deps || deps.some((dep, j) => dep !== old.deps[j])) effects[i] = { fn, deps, dirty: true, cleanup: old?.cleanup }; },
      },
    };
    const screenExports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('screens/AndroidReceivedSOSScreen.tsx', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports: screenExports, require: name => { assert.ok(modules[name], name); return modules[name]; }, Date, Math });
    function render(commit = true) {
      stateIndex = refIndex = effectIndex = 0; const tree = screenExports.default();
      if (commit) for (const effect of effects) if (effect.dirty) { effect.cleanup?.(); effect.cleanup = effect.fn(); effect.dirty = false; }
      return tree;
    }
    const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
    render(); await flush(); const tree = render(); assert.ok(nodes(tree).some(node => node.type === 'Profile'));
    assert.ok(!nodes(tree).some(node => node.type === 'Map'), 'no map before explicit action');
    const openMap = nodes(tree).find(node => node.type === 'Pressable' && node.props.children?.props.children === 'Apri mappa Live SOS').props.onPress;
    openMap(); const opened = nodes(render()).find(node => node.type === 'Map');
    assert.ok(opened.props.authorized); assert.equal(opened.props.selection.position.latitude, 1);
    f.holdStatus(); await f.advance(15_000);
    const refreshing = nodes(render()).find(node => node.type === 'Map');
    assert.ok(refreshing && !refreshing.props.authorized); assert.equal(refreshing.props.selection.position, null);
    f.release(); await flush(); assert.ok(nodes(render()).find(node => node.type === 'Map').props.authorized);
    const navigation = nodes(tree).find(node => node.type === 'Pressable' && node.props.children?.props.children === 'Apri nel navigatore').props.onPress;
    appListener('background'); assert.ok(!nodes(render()).some(node => node.type === 'Profile' || node.type === 'Map')); assert.equal(f.timers, 0);
    const before = f.reads; await f.advance(60_000); assert.equal(f.reads, before);
    appListener('active'); render(); await flush(); assert.equal(f.reads, before + 1);
    assert.ok(!nodes(render()).some(node => node.type === 'Map'), 'foreground never reopens map without a new explicit action');
    openMap(); assert.ok(nodes(render()).some(node => node.type === 'Map'));
    focused = false; assert.ok(!nodes(render()).some(node => node.type === 'Profile' || node.type === 'Map')); assert.equal(f.timers, 0);
    focused = true; render(); await flush(); assert.equal(f.reads, before + 2);
    render(); // Commit the resolved controller snapshot before simulating the next user tap.
    openMap(); assert.ok(nodes(render()).some(node => node.type === 'Map'));
    user = 'B'; assert.ok(!nodes(render(false)).some(node => node.type === 'Profile' || node.type === 'Map'));
    openMap(); assert.ok(!nodes(render(false)).some(node => node.type === 'Map'), 'old open action cannot authorize another account');
    navigation(); await flush(); assert.equal(urls.length, 0, 'old action cannot expose prior account coordinates');
    render(); await flush();
    const latestOpen = () => nodes(render()).find(node => node.type === 'Pressable' && node.props.children?.props.children === 'Apri mappa Live SOS').props.onPress();
    latestOpen(); assert.ok(nodes(render()).some(node => node.type === 'Map'));
    currentSOS = OTHER; assert.ok(!nodes(render(false)).some(node => node.type === 'Map'), 'SOS change removes map before passive cleanup');
    render(); await flush(); latestOpen(); assert.ok(nodes(render()).some(node => node.type === 'Map'));
    f.fail(new TypeError('synthetic')); await f.advance(15_000);
    assert.ok(!nodes(render()).some(node => node.type === 'Map'), 'transport failure removes map');
    f.fail(null); await f.advance(15_000); assert.ok(!nodes(render()).some(node => node.type === 'Map'), 'recovery does not reopen map automatically');
    latestOpen(); f.fail({ code: '42501' }); await f.advance(15_000);
    assert.ok(!nodes(render()).some(node => node.type === 'Map'), 'revocation removes map');
    f.fail(null); focused = false; render(); focused = true; render(); await flush();
    latestOpen(); user = null; assert.ok(!nodes(render()).some(node => node.type === 'Profile' || node.type === 'Map'), 'logout removes live map');
    user = 'B'; render(); await flush(); latestOpen(); f.status('closed'); await f.advance(15_000);
    assert.ok(!nodes(render()).some(node => node.type === 'Map'), 'closed SOS removes map');
    user = null; assert.ok(!nodes(render()).some(node => node.type === 'Profile' || node.type === 'Map'));
    effects.forEach(effect => effect.cleanup?.()); assert.equal(f.timers, 0);
  }],
  ['active refresh, pause/unmount and immediate foreground/focus recheck', async () => {
    const f = fixture(); f.controller.configure({ userId: 'A', sosId: ID }); await flush();
    assert.equal(f.state.kind, 'active'); assert.equal(f.timers, 1);
    await f.advance(15_000); assert.equal(f.reads, 2);
    f.controller.configure(null); assert.equal(f.state.sos, null); assert.equal(f.timers, 0);
    await f.advance(60_000); assert.equal(f.reads, 2);
    f.controller.configure({ userId: 'A', sosId: ID }); await flush(); assert.equal(f.reads, 3);
    f.controller.configure(null); assert.equal(f.timers, 0);
  }],
  ['terminal SOS and definitive denial stop timers and erase protected state', async () => {
    for (const terminal of [true, false]) {
      const f = fixture(); f.controller.configure({ userId: 'A', sosId: ID }); await flush();
      if (terminal) f.status('closed'); else f.fail({ code: '42501' });
      await f.advance(15_000); assert.equal(f.state.kind, terminal ? 'terminal' : 'denied');
      assert.equal(f.state.sos, null); assert.equal(f.state.selection.position, null); assert.equal(f.timers, 0);
      const reads = f.reads; await f.advance(60_000); assert.equal(f.reads, reads); f.controller.configure(null);
    }
  }],
  ['account/SOS change and late response never overlap requests or publish old data', async () => {
    for (const account of [true, false]) {
      const f = fixture(); f.holdStatus(); f.controller.configure({ userId: 'A', sosId: ID });
      f.controller.configure({ userId: account ? 'B' : 'A', sosId: account ? ID : OTHER });
      assert.equal(f.reads, 1); assert.equal(f.state.sos, null);
      f.release(); await flush(); assert.equal(f.maximum, 1); assert.equal(f.state.kind, 'active');
      assert.equal(f.state.context.userId, account ? 'B' : 'A'); assert.equal(f.state.sos.sos_id, account ? ID : OTHER);
      f.controller.configure(null);
    }
  }],
  ['empty status adapter requires an authoritative detail denial, not guesswork', async () => {
    const f = fixture(); f.controller.configure({ userId: 'A', sosId: ID }); await flush();
    f.statusError({ category: 'unknown' }); f.fail({ code: 'PGRST116' });
    await f.advance(15_000); assert.equal(f.state.kind, 'denied'); assert.equal(f.timers, 0);
    assert.equal(f.state.sos, null); f.controller.configure(null);
    const ambiguous = fixture(); ambiguous.statusError({ category: 'unknown' });
    ambiguous.controller.configure({ userId: 'A', sosId: ID }); await flush();
    assert.equal(ambiguous.state.kind, 'error'); assert.equal(ambiguous.timers, 1);
    assert.equal(ambiguous.state.sos, null); ambiguous.controller.configure(null);
  }],
  ['late acceptance of an old SOS cannot replace a new SOS or account', async () => {
    const f = fixture(); f.controller.configure({ userId: 'A', sosId: ID }); await flush();
    f.holdAccept(); void f.controller.accept();
    f.controller.configure({ userId: 'B', sosId: OTHER }); assert.equal(f.state.sos, null);
    f.release(); await flush(); assert.equal(f.state.context.userId, 'B'); assert.equal(f.state.sos.sos_id, OTHER);
    assert.equal(f.state.lifecycle.sos_status, 'open'); assert.equal(f.maximum, 1); assert.equal(f.accepts, 1);
    f.controller.configure(null);
  }],
  ['new fixes update; older/equal/future cannot replace selected position', async () => {
    const f = fixture(); f.controller.configure({ userId: 'A', sosId: ID }); await flush();
    f.row({ latitude: 3, location_updated_at: new Date(f.now).toISOString() }); await f.advance(15_000);
    assert.equal(f.state.selection.position.latitude, 3);
    f.row({ latitude: 9, location_updated_at: new Date(f.now - 30_000).toISOString() }); await f.advance(15_000);
    assert.equal(f.state.selection.position.latitude, 3); assert.equal(f.state.selection.lastKnown, true);
    f.row({ latitude: 8, location_updated_at: new Date(f.now + 120_000).toISOString() }); await f.advance(15_000);
    assert.equal(f.state.selection.position.latitude, 3); assert.equal(f.state.selection.issue, 'future');
    f.controller.configure(null);
  }],
  ['missing accuracy and timestamp are not invented; future without prior fix is hidden', async () => {
    const f = fixture(); const select = f.exports.selectReceivedPosition;
    const row = { latitude: 1, longitude: 2, accuracy: null, location_updated_at: null };
    assert.equal(select(null, row, f.now).position.accuracy, null);
    assert.equal(select(null, row, f.now).position.observedAt, null);
    const prior = { latitude: 1, longitude: 2, accuracy: 10, observedAt: new Date(f.now - 1000).toISOString() };
    const identical = select(prior, { ...row, latitude: 9, accuracy: 1, location_updated_at: prior.observedAt }, f.now);
    assert.equal(identical.issue, 'unchanged'); assert.equal(identical.position.latitude, 1); assert.equal(identical.position.accuracy, 10);
    assert.equal(select(null, { ...row, location_updated_at: new Date(f.now + 1).toISOString() }, f.now).position, null);
    assert.ok(f.exports.describePositionAge(new Date(f.now - 65_000).toISOString(), f.now).includes('1 minuto'));
    assert.ok(f.exports.describePositionAge(new Date(f.now + 1).toISOString(), f.now).includes('anomalo'));
  }],
  ['network failure hides protected data, bounded retry can recover', async () => {
    const f = fixture(); f.controller.configure({ userId: 'A', sosId: ID }); await flush(); f.fail(new TypeError('synthetic'));
    await f.advance(15_000); assert.equal(f.state.kind, 'error'); assert.equal(f.state.sos, null);
    f.fail(null); await f.advance(15_000); assert.equal(f.state.kind, 'active'); f.controller.configure(null);
  }],
  ['Android route, foreground/focus wiring, protected profile and no new recipient GPS', async () => {
    const route = fs.readFileSync('app/sos/[id].tsx', 'utf8');
    assert.match(route, /Platform\.OS === 'android' \? <AndroidReceivedSOSScreen \/> : <LegacyReceivedSOSScreen \/>/);
    const screen = fs.readFileSync('screens/AndroidReceivedSOSScreen.tsx', 'utf8');
    assert.match(screen, /focused && foreground && !isInitializing/); assert.match(screen, /value !== 'active'.*configure\(null\)/);
    assert.match(screen, /state\.kind === 'active' && state\.sos/); assert.match(screen, /<ReceivedEmergencyInformation/);
    assert.match(screen, /ne segue automaticamente|non segue automaticamente/);
    assert.doesNotMatch(screen, /expo-location|MapView|console\.|AsyncStorage|setInterval/);
  }],
];
(async () => { let failed = 0; for (const [name, run] of cases) {
  try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
} if (failed) process.exitCode = 1; })();
