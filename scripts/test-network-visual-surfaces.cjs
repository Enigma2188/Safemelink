'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Synthetic UI fixtures only. Effects and remote services never run in this harness.
const user = 'synthetic-owner';
const member = { membership_id: 'synthetic-member', nickname: 'Luce Serena', member_role: 'member', is_me: true };
const network = { network_id: 'synthetic-network', network_name: 'Rete sintetica di verifica', member_count: 7, my_role: 'member' };
const data = { network, members: [member], invitations: [], discoveryOptIn: false, discussions: [] };
function harness(file, overrides) {
  const states = [], refs = []; let stateIndex = 0, refIndex = 0, tree;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = Object.hasOwn(overrides, i) ? overrides[i] : typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial }); },
    useEffect() {}, useCallback: fn => fn,
  };
  const refuse = new Proxy({}, { get: () => () => { throw Error('Remote service must not run in UI tests'); } });
  const rn = Object.fromEntries(['View','Text','Pressable','RefreshControl','SafeAreaView','KeyboardAvoidingView','Switch'].map(k => [k,k]));
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ...rn, StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: 'android' }, Keyboard: { dismiss() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-router': { useRouter: () => ({ canGoBack: () => true, back() {}, replace() {}, push() {} }), useFocusEffect() {} },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: { user: { id: user } } }) },
    '@/components/KeyboardSafeForm': { KeyboardSafeScrollView: 'ScrollView', KeyboardSafeTextInput: 'TextInput' },
    '@/components/NetworkExplorer': { NetworkExplorer: props => jsx('LoadedReports', { children: props.reports.map(props.renderReport) }) },
    '@/components/NetworkReportPanel': { NetworkReportPanel: 'ReportPanel' },
    '@/backend/errors/BackendError': { BackendError: class extends Error {} },
    '@/backend/remoteRequest': { RemoteRequestTimeoutError: class extends Error {} },
    '@/services/LocationService': { LocationPermissionError: class extends Error {}, LocationTimeoutError: class extends Error {}, LocationUnavailableError: class extends Error {} },
    '@/services/NetworkModels': { NETWORK_CATEGORIES: [], NETWORK_FEED_RADIUS_METERS: 2500, NETWORK_FEED_RADIUS_OPTIONS: [1000,2500,5000,10000], getNetworkCategoryLabel: value => value },
    '@/services/NetworkPilotConfig': { NETWORK_PILOT: { maxLoadedReports: 100 } },
    '@/services/NetworkService': { NetworkService: refuse }, '@/services/NeighborhoodNetworkService': { NeighborhoodNetworkService: refuse },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: id => { assert.ok(id in deps, id); return deps[id]; }, console });
  const Screen = exports.NetworkScreen || exports.NeighborhoodNetworkScreen;
  function materialize(node) {
    if (Array.isArray(node)) return node.map(materialize);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return materialize(node.type(node.props));
    return { ...node, props: { ...node.props, children: materialize(node.props?.children) } };
  }
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
  function find(node, test) { if (!node) return null; if (Array.isArray(node)) return node.map(n => find(n,test)).find(Boolean) ?? null; return test(node) ? node : find(node.props?.children,test); }
  const render = () => { stateIndex = 0; refIndex = 0; tree = materialize(Screen()); };
  render();
  return { render, text: () => text(tree), root: () => tree, find: test => find(tree,test), button: label => find(tree,n => n.type === 'Pressable' && text(n).trim() === label) };
}

const report = { id: 'synthetic-report', category: 'LIGHTING', status: 'ACTIVE', description: 'Descrizione sintetica caricata', publicArea: 'Zona pubblica sintetica',
  authorNickname: 'Nickname sintetico', createdAt: '2026-11-01T12:00:00Z', confirmationCount: 2, isMine: false, myConfirmation: null };
const feed = harness('screens/NetworkScreen.tsx', { 0: { eligible: true, restrictionStatus: 'NONE' }, 1: [report], 2: user, 7: false });
assert.ok(feed.text().includes('Vicino a te')); assert.ok(feed.text().includes(report.description)); assert.ok(feed.text().includes(report.authorNickname));
assert.ok(feed.text().includes(report.publicArea)); assert.ok(feed.text().includes('Scegli il raggio'));
assert.ok(feed.button('NUOVA SEGNALAZIONE')); assert.equal(feed.button('NUOVA SEGNALAZIONE').props.disabled,false);
const blocked = harness('screens/NetworkScreen.tsx', { 0: { eligible: true, restrictionStatus: 'PUBLISH_BLOCKED' }, 2: user });
assert.equal(blocked.button('NUOVA SEGNALAZIONE').props.disabled,true);
const restricted = harness('screens/NetworkScreen.tsx', { 0: { eligible: true, restrictionStatus: 'FULL_NETWORK_BLOCKED' }, 1: [report], 2: user });
assert.ok(!restricted.text().includes(report.description)); assert.equal(restricted.button('NUOVA SEGNALAZIONE'),null);

const group = harness('screens/NeighborhoodNetworkScreen.tsx', { 0: data, 1: false });
assert.ok(group.text().includes(network.network_name)); assert.match(group.text(),/7\s+membri/);
assert.ok(group.text().includes('LS')); assert.ok(group.text().includes('Ancora nessuna discussione caricata'));
assert.ok(group.text().includes('posizione precisa non viene mostrata'));
assert.equal(group.button('INVITA UN VICINO'),null,'ordinary member must not acquire admin controls');
group.button('Membri').props.onPress(); group.render(); assert.ok(group.text().includes(member.nickname));
assert.equal(group.button('RIMUOVI'),null);
group.button('Inviti').props.onPress(); group.render(); assert.ok(group.text().includes('Disponibile agli inviti'));
group.button('Discussioni').props.onPress(); group.render(); assert.ok(group.text().includes('NUOVO ARGOMENTO'));
const empty = harness('screens/NeighborhoodNetworkScreen.tsx', { 0: { ...data, network: null, members: [] }, 1: false });
assert.ok(!empty.text().includes(network.network_name)); assert.ok(!empty.text().includes('LS'));
const v2 = fs.readFileSync('screens/NetworkV2Screen.native.tsx','utf8');
assert.ok(v2.includes("brandAccent: { color: '#79E4F5' }")); assert.ok(v2.includes('NETWORK_CATEGORY_REGISTRY_V2[id].color'));
assert.doesNotMatch(v2,/NetworkPrototypeDemo|NETWORK_DEMO|SAFEMELINK_VOSK_LAB|EXPO_PUBLIC_NETWORK_V2_ENABLED\s*=/);
console.log('PASS actual NETWORK/Neighborhood presentation with synthetic loaded data, real-count binding, loaded initials, tabs, empty state and retained publishing/admin restrictions; V2 theme only. No device rendering or remote request.');
