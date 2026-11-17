'use strict';
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let now = Date.parse('2026-11-07T12:00:00.000Z'), timerId = 0;
class Clock extends Date { static now() { return now; } }
const timers = new Map();
const context = vm.createContext({ Date: Clock, AbortController, console,
  setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { delay, fn: () => { timers.delete(id); fn(); } }); return id; }, clearTimeout: id => timers.delete(id) });
function load(file, dependencies = {}) {
  const exports = {};
  context.exports = exports; context.require = key => { assert.ok(Object.hasOwn(dependencies, key), key); return dependencies[key]; };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(`(function(exports,require){${code}\n})(exports,require);`, context); return exports;
}
const registry = load('services/NetworkCategoryRegistryV2.ts');
const contract = load('services/NetworkMapContractV2.ts', { './NetworkCategoryRegistryV2': registry });
const mapController = load('services/NetworkMapController.ts', { './NetworkMapContractV2': contract, './NetworkCategoryRegistryV2': registry });
const repository = load('backend/repositories/NetworkV2Repository.ts', { '@/services/NetworkMapContractV2': contract, '@/services/NetworkCategoryRegistryV2': registry, '@/services/NetworkMapController': mapController });
const model = load('components/network/NetworkMapModel.ts', { '@/services/NetworkMapContractV2': contract });
const runtimeModule = load('components/network/NetworkV2ScreenController.ts', { '@/services/NetworkMapController': mapController,
  '@/backend/repositories/NetworkV2Repository': repository, './NetworkMapModel': model });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const marker = (territory = id(99), status = 'ACTIVE') => ({ schemaVersion: 2, publicId: id(1), territoryId: territory, zoneId: id(90), categoryId: 'LIGHTING',
  kind: 'OPERATIONAL_EVENT', status, resolvedAt: status === 'RESOLVED' ? '2026-11-02T12:00:00.000Z' : null,
  createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z', validUntil: new Date(now + 3600000).toISOString(), revision: 1,
  locationPolicyVersion: 'synthetic', publicPosition: { latitude: 0, longitude: 0, generalizationMeters: 500, representation: 'GENERALIZED_EVENT_POINT' } });
const detail = () => ({ marker: marker(), description: 'Synthetic authorized event description.', authorNickname: 'Synthetic public nickname',
  confirmations: { confirmedCount: 0, noLongerPresentCount: 0, myConfirmation: null }, updates: [] });
const reply = data => ({ data: vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(data))})`, context), error: null, status: 200 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(setImmediate);
function harness() {
  let key = 'synthetic-A', hook = null, opCalls = 0; const listeners = new Set(), calls = [];
  const transport = async (name, args, signal) => {
    calls.push({ name, args, signal }); if (hook) { const response = hook(name, args, signal); if (response !== undefined) return response; }
    if (name === 'list_network_event_territories_v2') return reply([99, 100].map(n => ({ territoryId: id(n), code: `synthetic-${n}`, label: `Synthetic territory ${n}`,
      publicCenter: { latitude: 0, longitude: 0 }, locationPolicyVersion: 'synthetic', geometrySource: 'synthetic', geometryLicense: 'test-only', geometryVersion: '1' })));
    if (name === 'list_network_event_markers_v2') return reply(args.target_category && args.target_category !== 'LIGHTING' ? [] : [marker(args.target_territory, args.target_status)]);
    if (name === 'get_network_event_detail_v2') return reply(detail());
    if (name === 'get_network_author_updates_v2') return reply({ eventId: id(1), revision: 1, validUntil: detail().marker.validUntil, updates: [] });
    if (name === 'list_my_network_events_v2') return reply([{ publicId:id(1), categoryId:'LIGHTING', status:'ACTIVE', publicationState:'PENDING', createdAt:detail().marker.createdAt }]);
    if (name === 'create_network_event_v2') return reply({ publicId: id(9), status: 'ACTIVE', publicationState: 'PENDING', replayed: false });
    assert.fail(`Unexpected RPC ${name}`);
  };
  const runtime = new runtimeModule.NetworkV2ScreenController(transport, { getKey: () => key, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    () => { opCalls++; return id(77); }, { latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0.1 });
  return { runtime, calls, get opCalls() { return opCalls; }, setHook: value => { hook = value; },
    changeAuth: (value, notify = true) => { key = value; if (notify) for (const listener of [...listeners]) listener(); } };
}
async function initialized() { const h = harness(); assert.equal(h.calls.length, 0); h.runtime.start(); await flush(); await h.runtime.chooseTerritory(id(99)); return h; }
function draft(runtime) { runtime.beginDraft(); runtime.chooseEventPoint({ latitude: 0.25, longitude: 0.25 }); runtime.confirmEventPoint(); runtime.editDraft({ categoryId: 'LIGHTING', description: 'Synthetic explicit event description.' }); }
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
(async () => {
  await test('real repository/controller composition, dynamic territories/filtering and explicit refresh', async () => {
    const h = await initialized(); const r = h.runtime;
    assert.equal(r.getState().territories.length, 2); assert.equal(r.getState().territory.territoryId, id(99)); assert.equal(r.getState().feed.status, 'READY');
    const before = h.calls.filter(call => call.name === 'list_network_event_markers_v2').length;
    await r.refresh(); assert.equal(h.calls.filter(call => call.name === 'list_network_event_markers_v2').length, before + 1);
    await r.setFilters({ categoryId: 'CIVIC_SAFETY' }); assert.equal(r.getState().feed.status, 'EMPTY');
    await r.setFilters({ categoryId: null, status: 'RESOLVED', radius: 5000 });
    assert.equal(r.getState().feed.snapshot.markers[0].status, 'RESOLVED'); assert.equal(h.calls.at(-1).args.radius_meters, 5000);
    await r.chooseTerritory(id(100)); assert.equal(r.getState().feed.snapshot.markers[0].territoryId, id(100));
    r.dispose(); assert.equal(timers.size, 0);
  });
  await test('manual event selection requires confirmation; double publish uses one operation, PENDING never enters map', async () => {
    const h = await initialized(), r = h.runtime; r.beginDraft();
    r.editDraft({ categoryId: 'LIGHTING', description: 'Synthetic event description.' }); await r.publishDraft();
    assert.equal(h.calls.some(call => call.name === 'create_network_event_v2'), false);
    r.chooseEventPoint({ latitude: NaN, longitude: 0 }); assert.equal(r.getState().draft.point, null);
    r.chooseEventPoint({ latitude: 0.25, longitude: 0.25 }); await r.publishDraft(); assert.equal(h.opCalls, 0);
    r.confirmEventPoint(); const first = r.publishDraft(), second = r.publishDraft(); await Promise.all([first, second]);
    assert.equal(h.opCalls, 1); assert.equal(h.calls.filter(call => call.name === 'create_network_event_v2').length, 1);
    assert.equal(r.getState().draft.receipt.publicationState, 'PENDING'); assert.equal(r.getState().draft.state, 'RECEIVED');
    assert.equal(r.getState().feed.snapshot.markers.some(marker => marker.publicId === id(9)), false);
    const sent = h.calls.find(call => call.name === 'create_network_event_v2').args;
    assert.equal(sent.location_selection, 'EXPLICIT_EVENT_POINT'); assert.equal(sent.event_latitude, 0.25); assert.equal('author_position' in sent, false);
    r.cancelDraft(); assert.equal(r.getState().draft, null); r.dispose(); assert.equal(timers.size, 0);
  });
  await test('uncertain publication remains sticky across a rejected verification; immutable retry and no new operation', async () => {
    const h = await initialized(), r = h.runtime; let step = 0;
    h.setHook(name => { if (name !== 'create_network_event_v2') return; step++;
      return step === 1 ? Promise.reject(new Error('synthetic offline')) : step === 2 ? { data: null, error: { code: '42501' }, status: 403 } :
        reply({ publicId: id(9), status: 'ACTIVE', publicationState: 'PENDING', replayed: true }); });
    draft(r); await r.publishDraft(); assert.equal(r.getState().draft.state, 'UNKNOWN');
    r.closePanel(); r.beginDraft(); r.editDraft({ description: 'Must not replace original attempt.' }); r.chooseEventPoint({ latitude: 2, longitude: 2 });
    assert.equal(r.getState().draft.point.latitude, 0.25);
    await r.publishDraft(); assert.equal(r.getState().draft.state, 'UNKNOWN');
    await r.publishDraft(); assert.equal(r.getState().draft.state, 'RECEIVED'); assert.equal(h.opCalls, 1);
    const calls = h.calls.filter(call => call.name === 'create_network_event_v2');
    assert.ok(calls.every(call => call.args.target_operation === calls[0].args.target_operation && call.args.event_latitude === 0.25 && call.args.target_description === calls[0].args.target_description));
    r.dispose(); assert.equal(timers.size, 0);
  });
  await test('detail recovery, catalog/network errors, expiry and refresh never preserve unauthorized old content', async () => {
    const h = await initialized(), r = h.runtime; await r.openDetail(id(1)); assert.equal(r.getState().detail.authorNickname, 'Synthetic public nickname');
    const reads = h.calls.filter(call => call.name === 'list_network_event_markers_v2').length;
    await r.onForeground(); assert.equal(r.getState().detail, null); assert.equal(h.calls.filter(call => call.name === 'list_network_event_markers_v2').length, reads + 1);
    const late = deferred(); h.setHook(name => name === 'get_network_event_detail_v2' ? late.promise : undefined);
    const pending = r.openDetail(id(1)); await flush(); await r.setFilters({ categoryId: 'CIVIC_SAFETY' });
    late.resolve(reply(detail())); await pending; assert.equal(r.getState().detail, null);
    h.setHook(name => name === 'list_network_event_territories_v2' ? Promise.reject(new Error('synthetic network error')) : undefined);
    await r.discover(); assert.equal(r.getState().territoryStatus, 'ERROR'); assert.equal(r.getState().territories.length, 0); assert.equal(r.getState().feed.snapshot.markers.length, 0);
    h.setHook(null); await r.discover(); await r.chooseTerritory(id(99)); await r.setFilters({ categoryId: null }); await r.openDetail(id(1));
    now += 3600001; r.revalidateTime(); assert.equal(r.getState().detail, null); assert.equal(r.getState().feed.snapshot.markers.length, 0);
    r.dispose(); assert.equal(timers.size, 0);
  });
  await test('auth switch during write/detail clears draft and ignores callbacks; pre-cleanup switch cannot start publication', async () => {
    const h = await initialized(), r = h.runtime; const late = deferred();
    h.setHook(name => name === 'create_network_event_v2' ? late.promise : undefined);
    draft(r); const pending = r.publishDraft(); await flush(); h.changeAuth('synthetic-B'); await flush();
    assert.equal(r.getState().draft, null); assert.equal(r.getState().detail, null); assert.equal(r.getState().territory, null);
    late.resolve(reply({ publicId: id(9), status: 'ACTIVE', publicationState: 'PENDING', replayed: false })); await pending; assert.equal(r.getState().draft, null);
    h.setHook(null); await r.chooseTerritory(id(99)); draft(r);
    const count = h.calls.filter(call => call.name === 'create_network_event_v2').length;
    h.changeAuth('synthetic-C', false); await r.publishDraft(); await flush(); assert.equal(r.getState().draft, null);
    assert.equal(h.calls.filter(call => call.name === 'create_network_event_v2').length, count);
    h.changeAuth(null); assert.equal(r.getState().authenticated, false); assert.equal(r.getState().feed.snapshot.markers.length, 0);
    r.dispose(); assert.equal(timers.size, 0);
  });
  await test('native screen smartphone/desktop wiring, keyboard-reduced panel, social actions unavailable, no demo import', async () => {
    let hooks; const dimensions = { width: 390, height: 844 }; const effects = [];
    const react = { useSyncExternalStore: (_subscribe, read) => read(),
      useState: initial => { const owner = hooks, i = owner.i++; if (!(i in owner.values)) owner.values[i] = initial; return [owner.values[i], value => { owner.values[i] = typeof value === 'function' ? value(owner.values[i]) : value; }]; },
      useEffect: (fn, deps) => { if (!effects.some(item => item.runtime === deps[0])) effects.push({ runtime: deps[0], cleanup: fn() }); } };
    const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    const rn = { View: 'View', Text: 'Text', Pressable: 'Button', ScrollView: 'Scroll', TextInput: 'Input', KeyboardAvoidingView: 'Keyboard',
      Platform: { OS: 'android' }, useWindowDimensions: () => dimensions, StyleSheet: { create: value => value }, AppState: { addEventListener: () => ({ remove() {} }) } };
    const social = load('components/network/NetworkEventSocial.native.tsx', { react, 'react/jsx-runtime': jsx, 'react-native': rn });
    const screen = load('screens/NetworkV2Screen.native.tsx', { react, 'react/jsx-runtime': jsx, 'react-native': rn,
      '@expo/vector-icons': { Ionicons: 'Icon' },
      'react-native-safe-area-context': { SafeAreaView: 'SafeArea' }, '@/components/network/NetworkMapConnected.native': { NetworkMapConnected: 'ConnectedMap' },
      '@/components/network/NetworkEventSocial.native': social, '@/services/NetworkCategoryRegistryV2': registry }).NetworkV2Screen;
    const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
    const text = tree => tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
    for (const width of [390, 1280]) {
      dimensions.width = width; const h = await initialized(), r = h.runtime; const state = { i: 0, values: [] };
      let closed = 0;
      const render = () => { hooks = state; state.i = 0; return screen({ runtime: r, configuration: 'MISSING', onClose: () => closed++ }); };
      let tree = render(); assert.ok(nodes(tree).some(n => n.type === 'ConnectedMap'));
      const filters = nodes(tree).find(n => n.props?.accessibilityLabel === 'Filtri territoriali');
      assert.ok(filters); assert.equal(filters.props.accessibilityState.expanded, false);
      assert.equal(text(tree).includes('Storico revisionato'), false);
      filters.props.onPress(); tree = render();
      assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === 'Filtri territoriali').props.accessibilityState.expanded, true);
      assert.ok(text(tree).includes('Storico revisionato'));
      for (const name of ['shield-checkmark-outline', 'car-outline', 'bulb-outline', 'leaf-outline', 'information-circle-outline']) {
        assert.ok(nodes(tree).some(n => n.type === 'Icon' && n.props.name === name), `Category icon missing: ${name}`);
      }
      r.beginDraft(); tree = render(); const map = nodes(tree).find(n => n.type === 'ConnectedMap'); assert.ok(map.props.eventDraft);
      map.props.eventDraft.onChoose({ latitude: 0.25, longitude: 0.25 }); r.confirmEventPoint(); tree = render();
      assert.ok(nodes(tree).find(n => n.type === 'Input' && n.props.accessibilityLabel === 'Descrizione della segnalazione'));
      const panel = nodes(tree).find(n => n.props?.accessibilityLabel === 'Pannello NETWORK V2'); const before = panel.props.style.at(-1).height;
      nodes(tree).find(n => n.type === 'View' && n.props.onLayout).props.onLayout({ nativeEvent: { layout: { height: 500 } } });
      tree = render(); assert.ok(nodes(tree).find(n => n.props?.accessibilityLabel === 'Pannello NETWORK V2').props.style.at(-1).height < before);
      assert.equal(r.getState().draft.confirmed, true);
      r.editDraft({ categoryId: 'LIGHTING', description: 'Synthetic uncertain event.' });
      h.setHook(name => name === 'create_network_event_v2' ? Promise.reject(new Error('synthetic offline')) : undefined);
      await r.publishDraft(); tree = render(); assert.equal(r.getState().draft.state, 'UNKNOWN');
      const close = nodes(tree).find(n => n.type === 'Button' && text(n) === 'Chiudi');
      assert.equal(close.props.disabled, false); close.props.onPress(); assert.equal(closed, 1); assert.equal(r.getState().draft.state, 'UNKNOWN');
      r.dispose();
    }
    const tree = social.NetworkEventSocial({ detail: detail() }); assert.ok(text(tree).includes('RPC non disponibile'));
    assert.ok(nodes(tree).filter(n => n.type === 'Button').every(n => n.props.disabled === true));
    effects.forEach(effect => effect.cleanup?.());
    for (const name of ['screens/NetworkV2Screen.native.tsx','components/network/NetworkV2ScreenController.ts','components/network/NetworkEventSocial.native.tsx'])
      assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /NetworkPrototype|NETWORK_DEMO|Math\.random|expo-location|SOSService|sendSms|supabaseClient|expo-router/);
  });
  await test('reviewed history uses separate RPCs, no author or invented event marker, expiry clears publication', async () => {
    const h = await initialized(), r = h.runtime, until = new Date(now + 5000).toISOString();
    h.setHook(name => name === 'list_network_map_cells_v2' ? reply({ zones: [{ zoneId: id(90), level: 'BASE', label: 'Synthetic reviewed zone',
      geometry: { type: 'MultiPolygon', coordinates: [] }, availability: 'PUBLISHED', activityBand: 'LOW', periodStart: '2026-10-01', periodEnd: '2026-11-01',
      validUntil: until, policyVersion: 'synthetic' }] }) : name === 'list_network_zone_history_v2' ? reply({ entries: [{ entryId: id(300), zoneId: id(90),
      month: '2026-10-01', category: 'URBAN_HAZARD', summary: 'Synthetic reviewed historical summary.', state: 'CONCLUDED', revision: 1, validUntil: until }],
      availability: 'REVIEWED_HISTORY', nextCursor: null }) : undefined);
    await r.showHistory(); assert.equal(r.getState().history.phase, 'READY'); await r.openHistoryZone(id(90));
    assert.equal(r.getState().history.page.entries.length, 1);
    assert.equal('authorNickname' in r.getState().history.page.entries[0], false);
    assert.equal('publicPosition' in r.getState().history.page.entries[0], false);
    assert.equal(r.getState().feed.snapshot.markers.some(m => m.kind === 'REVIEWED_HISTORY'), false);
    const original = now; now += 6000;
    for (const [timer, row] of [...timers]) if (row.delay <= 6000) { timers.delete(timer); row.fn(); }
    assert.equal(r.getState().history.page, null); now = original; r.dispose(); assert.equal(timers.size, 0);
  });
  await test('late history, unauthorized replies and private field additions fail closed on account/context change', async () => {
    const h = await initialized(), r = h.runtime, late = deferred();
    h.setHook(name => name === 'list_network_map_cells_v2' ? late.promise : undefined);
    const read = r.showHistory(); await flush(); h.changeAuth(null); late.resolve(reply({ zones: [] })); await read;
    assert.equal(r.getState().history.zones.length, 0); assert.equal(r.getState().authenticated, false);
    h.changeAuth('synthetic-B'); await flush(); await r.chooseTerritory(id(99));
    h.setHook(name => name === 'list_network_map_cells_v2' ? reply({ zones: [], accountId: id(123) }) : undefined);
    await r.showHistory(); assert.equal(r.getState().history.phase, 'ERROR');
    h.setHook(name => name === 'list_network_map_cells_v2' ? { data: null, error: { code: '42501' }, status: 403 } : undefined);
    await r.showHistory(); assert.equal(r.getState().history.phase, 'ERROR'); r.dispose(); assert.equal(timers.size, 0);
  });
  await test('owner finish is server-verified, single-flight and unknown outcome retries only the same closure', async () => {
    const h = await initialized(), r = h.runtime; await r.openDetail(id(1)); const pending = deferred();
    h.setHook(name => name === 'finish_my_network_event_v2' ? pending.promise : undefined);
    const first = r.finishEvent(id(1), 'RESOLVED'); await flush(); await r.finishEvent(id(1), 'WITHDRAWN');
    assert.equal(h.calls.filter(c => c.name === 'finish_my_network_event_v2').length, 1);
    pending.reject(new Error('synthetic connection lost')); await first; assert.equal(r.getState().finish.state, 'UNKNOWN');
    await r.finishEvent(id(1), 'WITHDRAWN'); assert.equal(h.calls.filter(c => c.name === 'finish_my_network_event_v2').length, 1);
    h.setHook(name => name === 'finish_my_network_event_v2' ? reply(null) : undefined);
    await r.finishEvent(id(1), 'RESOLVED'); assert.equal(r.getState().finish, null); assert.ok(r.getState().notice.includes('confermata'));
    await r.openDetail(id(1)); h.setHook(name => name === 'finish_my_network_event_v2' ? { data: null, error: { code: '42501' }, status: 403 } : undefined);
    await r.finishEvent(id(1), 'RESOLVED'); assert.equal(r.getState().finish, null); assert.ok(!r.getState().notice.includes('confermata'));
    r.dispose(); assert.equal(timers.size, 0);
  });
  await test('approved author update detail is decoded and revision/private fields fail closed', async () => {
    const h = await initialized(), r = h.runtime;
    h.setHook(name => name === 'get_network_author_updates_v2' ? reply({ eventId: id(1), revision: 1, validUntil: detail().marker.validUntil,
      updates: [{ publicId: id(555), authorRole: 'AUTHOR', body: 'Synthetic approved author update.', createdAt: detail().marker.createdAt }] }) : undefined);
    await r.openDetail(id(1)); assert.equal(r.getState().detail.updates.length,1);
    h.setHook(name => name === 'get_network_author_updates_v2' ? reply({ eventId: id(1), revision: 2, validUntil: detail().marker.validUntil, updates: [] }) : undefined);
    await r.openDetail(id(1)); assert.equal(r.getState().detail,null);assert.equal(r.getState().detailStatus,'ERROR');
    h.setHook(name => name === 'get_network_author_updates_v2' ? reply({ eventId: id(1), revision: 1, validUntil: detail().marker.validUntil, updates: [], author_id: id(66) }) : undefined);
    await r.openDetail(id(1));assert.equal(r.getState().detail,null);r.dispose();
  });
  await test('private owner metadata includes pending events; late account replies and extra fields are rejected', async () => {
    const h=await initialized(),r=h.runtime;await r.showOwn();assert.equal(r.getState().own.rows[0].publicationState,'PENDING');
    assert.equal('publicPosition' in r.getState().own.rows[0],false);
    h.setHook(name=>name==='finish_my_network_event_v2'?reply(null):undefined);await r.finishEvent(id(1),'WITHDRAWN');
    assert.ok(h.calls.some(c=>c.name==='finish_my_network_event_v2'));
    const late=deferred();h.setHook(name=>name==='list_my_network_events_v2'?late.promise:undefined);
    const read=r.showOwn();await flush();h.changeAuth(null);late.resolve(reply([]));await read;assert.equal(r.getState().own.rows.length,0);
    r.dispose();assert.equal(timers.size,0);
  });
  await test('strict TypeScript of isolated screen/runtime/social and reused native map', async () => {
    const modules = path.resolve(path.dirname(require.resolve('typescript')), '..', '..');
    const files = ['screens/NetworkV2Screen.native.tsx','components/network/NetworkV2ScreenController.ts','components/network/NetworkEventSocial.native.tsx'];
    const program = ts.createProgram(files.map(file => path.join(root, file)), { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, baseUrl: root, types: ['react','node'], typeRoots: [path.join(modules, '@types')],
      paths: { '@/*': ['./*'], react: [path.join(modules, '@types/react/index.d.ts')], 'react/*': [path.join(modules, '@types/react/*')], '*': [path.join(modules, '*'), path.join(modules, '@types/*')] } });
    const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics,
      { getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n' }));
  });
  console.log(`${passed} local integration checks PASS. Native rendering/keyboard, provider, PostgreSQL, JWT and real multiuser behavior NOT verified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
