const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ID = '123e4567-e89b-42d3-a456-426614174000';
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return exports;
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness(file, exported) {
  const pending = [], values = [], refs = [], effects = [], urls = [], dialogs = [];
  let si = 0, ri = 0, ei = 0, user = 'A', focused = true, appListener;
  let props = { sosId: ID, snapshot: {} }, capability = true;
  const modules = {
    '@/backend/supabaseClient': { requireSupabaseClient: () => ({ rpc: (name, args) => ({
      abortSignal: () => new Promise(resolve => pending.push({ name, args, resolve: data => resolve({ data, error: null }) })),
    }) }) },
    '@/backend/remoteRequest': { runRemoteRequest: fn => fn({}) },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: user ? { user: { id: user } } : null, isInitializing: false }) },
    '@/components/KeyboardSafeForm': { KeyboardSafeTextInput: 'Input' },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'android' }, View: 'View', Text: 'Text', Pressable: 'Button', Switch: 'Switch', StyleSheet: { create: x => x },
      Alert: { alert: (_title, _text, buttons) => dialogs.push(buttons) }, Linking: { canOpenURL: async () => capability, openURL: async url => urls.push(url) },
      AppState: { currentState: 'active', addEventListener: (_event, fn) => { appListener = fn; return { remove() {} }; } } },
    react: {
      useState: initial => { const i = si++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      useRef: initial => { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }); },
      useEffect: (fn, deps) => { const i = ei++, old = effects[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) effects[i] = { fn, deps, dirty: true, cleanup: old?.cleanup }; },
    },
  };
  const service = load('services/EmergencyPrivateDetails.ts', modules);
  modules['@/services/EmergencyPrivateDetails'] = service;
  const Component = load(file, modules)[exported];
  return { service, pending, urls, dialogs,
    render: (commit = true) => { si = ri = ei = 0; const tree = Component(props);
      if (commit) for (const e of effects) if (e.dirty) { e.cleanup?.(); e.cleanup = e.fn(); e.dirty = false; } return tree; },
    user: v => { user = v; }, focus: v => { focused = v; }, background: () => appListener('background'),
    refresh: () => { props = { ...props, snapshot: {} }; }, sos: v => { props = { sosId: v, snapshot: {} }; },
    capability: v => { capability = v; }, cleanup: () => effects.forEach(e => e.cleanup?.()),
  };
}
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const button = (tree, text) => nodes(tree).find(n => n.type === 'Button' && n.props.children.props.children === text);
const form = () => harness('components/EmergencyPrivateDetailsForm.tsx', 'EmergencyPrivateDetailsForm');
const received = () => harness('components/ReceivedPersonalSafetyInformation.tsx', 'ReceivedPersonalSafetyInformation');
const shared = { sos_id: ID, declared_by_user: true, share_ice: true, share_ice_phone: false, share_safety: false,
  ice_name: 'synthetic ICE', ice_relation: 'synthetic relation', ice_phone: '+3900000000', stalking: 'synthetic declaration', domestic_violence: null, other_risk: null, instructions: 'synthetic instructions' };
(async () => {
  const h = form(), s = h.service;
  s.validatePrivateDetails(s.EMPTY_PRIVATE_DETAILS);
  assert.equal(s.EMPTY_PRIVATE_DETAILS.share_ice, false); assert.equal(s.EMPTY_PRIVATE_DETAILS.share_ice_phone, false); assert.equal(s.EMPTY_PRIVATE_DETAILS.share_safety, false);
  assert.throws(() => s.validatePrivateDetails({ ...s.EMPTY_PRIVATE_DETAILS, share_ice_phone: true }));
  assert.throws(() => s.validatePrivateDetails({ ...s.EMPTY_PRIVATE_DETAILS, share_safety: true }));
  assert.throws(() => s.validatePrivateDetails({ ...s.EMPTY_PRIVATE_DETAILS, ice_phone: 'local number' }));
  assert.throws(() => s.parseOwnedPrivateDetails({ user_id: 'B' }, 'A'));
  assert.throws(() => s.parseOwnedPrivateDetails({ user_id: 'A' }, 'A'));
  assert.equal(s.privateReceivedFields(shared, ID).length, 2, 'phone and safety withheld even if payload contains them');
  assert.equal(s.privateReceivedFields({ ...shared, share_ice: false, share_ice_phone: true }, ID).length, 0);
  assert.equal(s.privateReceivedFields({ ...shared, share_safety: true }, ID).length, 4);
  assert.equal(s.privateReceivedFields(shared, 'wrong').length, 0);
  console.log('PASS optional fields, strict parsing, separate OFF consents and phone/safety redaction');
  h.render(); assert.equal(h.pending[0].args.expected_owner_id, 'A'); h.pending[0].resolve(null); await flush();
  let tree = h.render(); assert.equal(nodes(tree).filter(n => n.type === 'Input').length, 7);
  nodes(tree).find(n => n.type === 'Input' && n.props.accessibilityLabel === 'Stalking (facoltativo)').props.onChangeText('synthetic private text');
  tree = h.render(); button(tree, 'Salva dati avanzati e consensi').props.onPress();
  const save = h.pending.at(-1); assert.equal(save.name, 'update_my_emergency_private_details'); assert.equal(save.args.next_share_safety, false);
  save.resolve({ ...s.EMPTY_PRIVATE_DETAILS, user_id: 'A', stalking: 'synthetic private text' }); await flush();
  tree = h.render(); button(tree, 'Cancella dati avanzati').props.onPress(); h.dialogs.at(-1)[1].onPress();
  assert.equal(h.pending.at(-1).name, 'delete_my_emergency_private_details'); h.pending.at(-1).resolve(null); await flush();
  tree = h.render(); assert.equal(nodes(tree).find(n => n.type === 'Input' && n.props.accessibilityLabel === 'Stalking (facoltativo)').props.value, ''); h.cleanup();
  console.log('PASS actual owner form: private save, full deletion and no legacy import');
  for (const change of ['account', 'logout', 'background', 'focus']) {
    const f = form(); f.render();
    if (change === 'account') f.user('B'); if (change === 'logout') f.user(null); if (change === 'background') f.background(); if (change === 'focus') f.focus(false);
    assert.ok(!nodes(f.render(false)).some(n => n.type === 'Input'));
    f.pending[0].resolve({ ...f.service.EMPTY_PRIVATE_DETAILS, user_id: 'A', stalking: 'synthetic stale data' }); await flush();
    assert.ok(!nodes(f.render()).some(n => n.type === 'Input')); f.cleanup();
  }
  console.log('PASS owner account/logout/background/focus isolation and late replies');
  for (const change of ['account', 'logout', 'SOS', 'snapshot', 'background', 'focus']) {
    const f = received(); f.render(); f.pending[0].resolve({ ...shared, share_safety: true }); await flush(); assert.ok(f.render());
    if (change === 'account') f.user('B'); if (change === 'logout') f.user(null); if (change === 'SOS') f.sos('other');
    if (change === 'snapshot') f.refresh(); if (change === 'background') f.background(); if (change === 'focus') f.focus(false);
    assert.equal(f.render(false), null); f.render(); f.pending.at(-1).resolve(null); await flush(); assert.equal(f.render(), null); f.cleanup();
  }
  console.log('PASS recipient identity/revocation/refresh clearing before passive cleanup');
  {
    const f = received(); f.render(); f.pending[0].resolve({ ...shared, share_ice_phone: true }); await flush();
    button(f.render(), 'Apri numero ICE nel telefono').props.onPress(); assert.equal(f.urls.length, 0);
    f.dialogs.at(-1)[1].onPress(); f.pending.at(-1).resolve(null); await flush(); assert.equal(f.urls.length, 0); assert.equal(f.render(), null); f.cleanup();
  }
  {
    const f = received(); f.render(); f.pending[0].resolve({ ...shared, share_ice_phone: true }); await flush();
    button(f.render(), 'Apri numero ICE nel telefono').props.onPress(); f.dialogs.at(-1)[1].onPress();
    f.user('B'); f.render(false); f.pending.at(-1).resolve({ ...shared, share_ice_phone: true }); await flush(); assert.equal(f.urls.length, 0); f.cleanup();
  }
  console.log('PASS dialer requires explicit confirmation, fresh RPC consent and unchanged account');
  for (const available of [true, false]) {
    const f = received(); f.capability(available); f.render();
    f.pending[0].resolve({ ...shared, share_ice_phone: true }); await flush();
    button(f.render(), 'Apri numero ICE nel telefono').props.onPress();
    f.dialogs.at(-1)[1].onPress(); f.pending.at(-1).resolve({ ...shared, share_ice_phone: true }); await flush();
    assert.equal(f.urls.length, available ? 1 : 0);
    if (available) assert.equal(f.urls[0], 'tel:' + shared.ice_phone);
    f.cleanup();
  }
  console.log('PASS mocked available/unavailable dialer; no real phone invocation');
  {
    const pluginSource = fs.readFileSync('plugins/withEmergencyDialerQueries.cjs', 'utf8');
    const pluginModule = { exports: {} };
    vm.runInNewContext(pluginSource, { module: pluginModule, require: () => ({ withAndroidManifest: (config, action) => action(config) }) });
    const manifest = { modResults: { manifest: { queries: [{ intent: [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'sms' } }] }] }] } } };
    pluginModule.exports(manifest); pluginModule.exports(manifest);
    const intents = manifest.modResults.manifest.queries[0].intent;
    assert.equal(intents.length, 2); assert.equal(intents[0].data[0].$['android:scheme'], 'sms');
    assert.equal(intents[1].data[0].$['android:scheme'], 'tel');
    assert.ok(!manifest.modResults.manifest['uses-permission']);
  }
  console.log('PASS real manifest mod: idempotent tel visibility, SMS preserved, no call permission');
  const sql = fs.readFileSync('supabase/migrations/20261014120000_emergency_private_details.sql', 'utf8');
  assert.match(sql, /^begin;/); assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /alter table public\.(sos|emergency_profiles)|drop |create or replace|http|net\.|cron\./i);
  assert.equal((sql.match(/security definer set search_path = pg_catalog, pg_temp/g) || []).length, 4);
  assert.match(sql, /force row level security/); assert.match(sql, /from public,anon,authenticated,service_role/);
  assert.match(sql, /s\.status in \('open','accepted'\)/); assert.match(sql, /tc\.user_id=s\.user_id and tc\.linked_profile_id=auth\.uid\(\)/);
  assert.match(sql, /case when d\.share_ice and d\.share_ice_phone then d\.ice_phone end/);
  assert.match(sql, /actor_id is distinct from expected_owner_id/);
  for (const file of ['services/EmergencyPrivateDetails.ts', 'components/EmergencyPrivateDetailsForm.tsx', 'components/ReceivedPersonalSafetyInformation.tsx'])
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /console\.|AsyncStorage|analytics|sendSMS|pushNotification/);
  console.log('PASS STATIC ONLY: additive SQL, scoped RPCs, default OFF, no legacy mutation or sensitive transport/log/cache');
  console.log('Real PostgreSQL, grants/RLS, concurrency, consent revocation and native dialer NOT EXECUTED.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
