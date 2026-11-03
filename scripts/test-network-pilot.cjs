const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = file => fs.readFileSync(file, 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const load = (file, modules) => { const exports = {}; vm.runInNewContext(compile(source(file)), { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, Date, Map, Set, console, setTimeout, clearTimeout }); return exports; };
const config = load('services/NetworkPilotConfig.ts', {});
const models = load('services/NetworkModels.ts', {});
const territory = load('services/NetworkTerritory.ts', { '@/services/NetworkModels': models, '@/services/NetworkPilotConfig': config });
const now = Date.now();
const row = (id, change = {}) => ({ id, status: 'ACTIVE', category: 'URBAN_HAZARD', description: 'Descrizione sintetica di test', publicArea: 'Area approssimativa', authorNickname: 'Nickname sintetico',
  distanceBucketMeters: 500, createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(), isMine: false, ...change });
const rows = [row('A'), row('B'), row('C'), row('D', { status: 'RESOLVED', description: 'Lampione spento', createdAt: new Date(now - 86400000).toISOString() }),
  row('expired', { expiresAt: new Date(now - 1).toISOString() }), row('hidden', { status: 'HIDDEN' }), row('future', { createdAt: new Date(now + 1000).toISOString() })];
const filters = territory.DEFAULT_NETWORK_FILTERS;
const filtered = territory.filterNetworkReports([...rows, rows[0]], filters, now);
assert.deepEqual(Array.from(filtered, r => r.id), ['A', 'B', 'C', 'D']);
assert.equal(territory.filterNetworkReports(rows, { ...filters, query: 'LAMPIONE', status: 'RESOLVED' }, now).length, 1);
assert.equal(territory.filterNetworkReports(rows, { ...filters, category: 'OTHER_SAFETY' }, now).length, 0);
assert.equal(territory.filterNetworkReports([row('old', { createdAt: new Date(now - 40 * 86400000).toISOString() })], filters, now).length, 0);
assert.equal(territory.filterNetworkReports(rows, { ...filters, band: 'wide' }, now).length, 0);
for (const [count, label] of [[0, 'Dati insufficienti'], [2, 'Dati insufficienti'], [3, 'Poche segnalazioni'], [5, 'Attività intermedia'], [10, 'Attività più elevata']]) assert.equal(territory.networkActivity(count).label, label);
assert.equal(territory.networkDistanceActivity(filtered)[0].count, 4);
assert.equal(territory.networkDistanceActivity([row('one')])[0].count, null);
assert.equal(territory.networkDistanceActivity([row('bad', { distanceBucketMeters: NaN })])[0].count, null);
console.log('PASS real filters, chronological order, deduplication, expiration, missing aggregates, transparent thresholds; no invented geography');

const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
function component(file, name, props, dependencies) {
  const values = [], refs = [], effects = []; let si, ri, ei;
  const react = {
    useState: initial => { const i = si++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    useRef: initial => { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }); }, useMemo: fn => fn(),
    useEffect: (fn, deps) => { const i = ei++, old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) effects[i] = { fn, deps, dirty: true, cleanup: old?.cleanup }; },
  };
  const modules = { react, 'react/jsx-runtime': { jsx: (type, p) => ({ type, props: p }), jsxs: (type, p) => ({ type, props: p }) },
    'react-native': { View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Button', ScrollView: 'Scroll', Modal: 'Modal', StyleSheet: { create: s => s }, AppState: { addEventListener: () => ({ remove() {} }) } },
    '@expo/vector-icons': { Ionicons: 'Icon' }, '@/services/NetworkModels': models, '@/services/NetworkPilotConfig': config, '@/services/NetworkTerritory': territory, ...dependencies };
  const exports = load(file, modules);
  return { render: (next = {}) => { props = { ...props, ...next }; si = ri = ei = 0; const tree = exports[name](props);
    for (const e of effects) if (e.dirty) { e.cleanup?.(); e.cleanup = e.fn(); e.dirty = false; } return tree;
  }, cleanup: () => effects.forEach(e => e.cleanup?.()) };
}
const explorer = component('components/NetworkExplorer.tsx', 'NetworkExplorer', { reports: filtered, radiusLabel: '5 km', radiusMeters: 5000, loading: false, renderReport: r => ({ type: 'Report', props: { id: r.id } }) });
let tree = explorer.render(); assert.equal(nodes(tree).filter(n => n.type === 'Report').length, 4);
nodes(tree).find(n => n.props?.label === 'Concluse').props.onPress(); tree = explorer.render();
assert.equal(nodes(tree).filter(n => n.type === 'Report').length, 1);
nodes(tree).find(n => n.type === 'Input').props.onChangeText('inesistente'); tree = explorer.render(); assert.equal(nodes(tree).filter(n => n.type === 'Report').length, 0);
nodes(tree).find(n => n.props?.label === 'AZZERA FILTRI').props.onPress(); tree = explorer.render(); assert.equal(nodes(tree).filter(n => n.type === 'Report').length, 4);
explorer.cleanup();
console.log('PASS actual explorer component: status/search/reset controls filter real loaded records');
assert.equal(config.isPilotProtectionCategoryEnabled('CYBERBULLYING'), false);
assert.equal(config.isPilotProtectionCategoryEnabled('CYBERBULLYING', true), true);
assert.equal(config.isPilotProtectionCategoryEnabled('THREATS'), true);
console.log('PASS explicit bullying category is reversibly excluded; generic support categories remain available');

const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let actor = 'A', resolveRead, writes = 0, closed = 0;
const response = new Promise(resolve => { resolveRead = resolve; });
const native = { View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Button', ScrollView: 'Scroll', Modal: 'Modal',
  StyleSheet: { create: s => s }, AppState: { addEventListener: (_name, fn) => { native.background = fn; return { remove() {} }; } } };
const dependencies = { 'react-native': native, '@/backend/auth/AuthProvider': { useAuth: () => ({ session: { user: { id: actor } } }) },
  '@/services/NetworkService': { NetworkService: { getReport: () => response, reportContent: async () => { writes++; }, addUpdate: async () => { writes++; } } } };
(async () => {
  const panel = component('components/NetworkReportPanel.tsx', 'NetworkReportPanel', { report: rows[0], ownerId: 'A', canPublish: true, canInteract: true, onClose: () => { closed++; } }, dependencies);
  panel.render(); actor = 'B'; assert.equal(panel.render(), null); resolveRead({ ...rows[0], updates: [] }); await drain(); assert.equal(panel.render(), null); assert.equal(writes, 0);
  panel.cleanup(); actor = 'A';
  const own = component('components/NetworkReportPanel.tsx', 'NetworkReportPanel', { report: { ...rows[0], isMine: true }, ownerId: 'A', canPublish: false, canInteract: false, onClose: () => { closed++; } }, dependencies);
  own.render(); await drain(); tree = own.render();
  assert.equal(nodes(tree).filter(n => n.type === 'Input').length, 0);
  assert.equal(nodes(tree).filter(n => n.type === 'Button').length, 1); native.background('background'); assert.equal(closed, 1);
  own.cleanup();
  const writer = component('components/NetworkReportPanel.tsx', 'NetworkReportPanel', { report: { ...rows[0], isMine: true }, ownerId: 'A', canPublish: true, canInteract: true, onClose() {} }, dependencies);
  writer.render(); await drain(); tree = writer.render();
  nodes(tree).find(n => n.type === 'Input').props.onChangeText('Aggiornamento sintetico'); tree = writer.render();
  nodes(tree).find(n => n.type === 'Button' && n.props.children?.props.children === 'PUBBLICA AGGIORNAMENTO').props.onPress(); await drain();
  assert.equal(writes, 1); writer.cleanup();
  assert.equal(config.NETWORK_PILOT.bullyingEnabled, false);
  assert.match(source('app/protection-signal.tsx'), /values.filter\(\(\[value\]\) => isPilotProtectionCategoryEnabled\(value\)\)/);
  assert.match(source('app/protection-signal.tsx'), /draft.category && isPilotProtectionCategoryEnabled\(draft.category\)/);
  assert.match(source('app/protection-signal.tsx'), /key === 'category' && !isPilotProtectionCategoryEnabled\(value\)/);
  assert.doesNotMatch(source('services/NetworkTerritory.ts'), /latitude|longitude|sos|fetch\(/i);
  assert.doesNotMatch(source('components/NetworkExplorer.tsx'), /expo-location|fetch\(|AsyncStorage|react-native-maps|console\./);
  assert.match(source('screens/NetworkScreen.tsx'), /dataOwner === userId/);
  assert.match(source('screens/NetworkScreen.tsx'), /NETWORK_PILOT.maxLoadedReports/);
  const color = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
  for (const [fg,bg] of [['#BDD2EE','#0C274A'],['#F5FAFF','#102E56'],['#08213E','#8ADFFF'],['#FFFFFF','#C82746']]) assert.ok((Math.max(color(fg), color(bg)) + .05) / (Math.min(color(fg), color(bg)) + .05) >= 4.5);
  console.log('PASS detail stale-account response, restriction guards, background close, reversible category gate, no GPS/cache, bounded loading and text contrast');
  console.log('Mocked/local only: no RPC, publication, GPS, map tile, SMS, SOS or remote operation executed. Android rendering/performance NOT verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
