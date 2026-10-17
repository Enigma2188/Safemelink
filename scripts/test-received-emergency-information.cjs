const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER = '123e4567-e89b-42d3-a456-426614174001';
const row = { sos_id: ID, declared_by_user: true, medical_data_shared: true, ice_contact_shared: true,
  declared_blood_group: 'O+', severe_allergies: 'synthetic allergy', important_conditions: '',
  relevant_medications: null, lifesaving_medications: null, emergency_notes: 'synthetic note', ice_contact: 'synthetic ICE' };
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return exports;
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  const pending = [], states = [], refs = [], effects = [];
  let cursor = 0, refCursor = 0, effectCursor = 0, user = 'A', focused = true;
  let props = { sosId: ID, snapshot: {} }, appState;
  const modules = {
    '@/services/EmergencyProfileService': { EmergencyProfileService: { getSharedForSOS: id => new Promise((resolve, reject) => pending.push({ id, resolve, reject })) } },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: user ? { user: { id: user } } : null, isInitializing: false }) },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'android' }, View: 'View', Text: 'Text', StyleSheet: { create: x => x },
      AppState: { currentState: 'active', addEventListener: (_event, cb) => { appState = cb; return { remove() {} }; } } },
    react: {
      useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial;
        return [states[i], value => { states[i] = value; }]; },
      useRef: initial => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: initial }); },
      useEffect: (fn, deps) => { const i = effectCursor++; const old = effects[i];
        if (!old || deps.some((dep, j) => dep !== old.deps[j])) effects[i] = { deps, fn, cleanup: old?.cleanup, dirty: true }; },
    },
  };
  modules['@/services/ReceivedEmergencyProfile'] = load('services/ReceivedEmergencyProfile.ts', modules);
  const component = load('components/ReceivedEmergencyInformation.tsx', modules).ReceivedEmergencyInformation;
  function render(commit = true) {
    cursor = refCursor = effectCursor = 0;
    const tree = component(props);
    if (commit) for (const effect of effects) if (effect.dirty) {
      effect.cleanup?.(); effect.cleanup = effect.fn(); effect.dirty = false;
    }
    return tree;
  }
  return { modules, pending, render, setUser: x => { user = x; }, setFocused: x => { focused = x; },
    setSOS: x => { props = { sosId: x, snapshot: {} }; }, refresh: () => { props = { ...props, snapshot: {} }; },
    appState: x => appState(x), unmount: () => effects.forEach(x => x.cleanup?.()) };
}
const cases = [
  ['consents, empty profile, wrong SOS and undeclared data fail closed', async () => {
    const h = harness(), fields = h.modules['@/services/ReceivedEmergencyProfile'].getEmergencyInformation;
    assert.equal(fields(row, ID).length, 4);
    assert.equal(fields({ ...row, medical_data_shared: false }, ID).length, 1);
    assert.equal(fields({ ...row, ice_contact_shared: false }, ID).length, 3);
    assert.equal(fields({ ...row, medical_data_shared: false, ice_contact_shared: false }, ID).length, 0);
    assert.equal(fields(null, ID).length, 0); assert.equal(fields(row, OTHER).length, 0);
    assert.equal(fields({ ...row, declared_blood_group: '', severe_allergies: '', emergency_notes: '', ice_contact: '' }, ID).length, 0);
    assert.equal(fields({ ...row, declared_by_user: false }, ID).length, 0);
  }],
  ['new request hides old contents before effects and rejects stale response', async () => {
    const h = harness(); h.render(); h.pending[0].resolve(row); await flush(); assert.ok(h.render());
    h.refresh(); assert.equal(h.render(false), null); h.render();
    h.refresh(); h.render(); h.pending[1].resolve(row); await flush(); assert.equal(h.render(), null);
    h.pending[2].resolve(row); await flush(); assert.ok(h.render()); h.unmount();
  }],
  ['account, SOS, logout and authorization loss remove sensitive state', async () => {
    for (const change of ['account', 'SOS', 'logout', 'consent']) {
      const h = harness(); h.render(); h.pending[0].resolve(row); await flush(); assert.ok(h.render());
      if (change === 'account') h.setUser('B');
      if (change === 'SOS') h.setSOS(OTHER);
      if (change === 'logout') h.setUser(null);
      if (change === 'consent') h.refresh();
      assert.equal(h.render(false), null); h.render();
      const last = h.pending.at(-1); if (last !== h.pending[0]) last.resolve(null);
      await flush(); assert.equal(h.render(), null); h.unmount();
    }
  }],
  ['account and SOS changes during fetch reject response before passive cleanup', async () => {
    for (const changeAccount of [true, false]) {
      const h = harness(); h.render();
      if (changeAccount) h.setUser('B'); else h.setSOS(OTHER);
      assert.equal(h.render(false), null);
      h.pending[0].resolve(row); await flush(); assert.equal(h.render(), null); h.unmount();
    }
  }],
  ['terminal SOS unmount discards an in-flight profile response', async () => {
    const h = harness(); h.render(); h.unmount(); h.pending[0].resolve(row); await flush();
    assert.equal(h.render(false), null);
  }],
  ['background and screen blur hide data and resume performs a fresh RPC', async () => {
    const h = harness(); h.render(); h.pending[0].resolve(row); await flush(); assert.ok(h.render());
    h.appState('background'); assert.equal(h.render(), null);
    h.appState('active'); assert.equal(h.render(), null); assert.equal(h.pending.length, 2);
    h.setFocused(false); assert.equal(h.render(), null);
    h.pending[1].resolve(row); await flush(); assert.equal(h.render(), null); h.unmount();
  }],
  ['unauthorized and network errors never reuse contents or crash', async () => {
    for (const message of ['42501', 'offline']) {
      const h = harness(); h.render(); h.pending[0].reject(new Error(message)); await flush();
      assert.equal(h.render(), null); h.unmount();
    }
  }],
  ['Home route, unchanged SOS one-tap, active-only section and RPC boundary', async () => {
    const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
    assert.match(home, /Il mio profilo di emergenza/);
    assert.match(home, /router\.push\('\/emergency-profile' as Href\)/);
    const base = execFileSync('git', ['show', 'fa4644a861732b30d2c7096b2582095374cc8f98:app/(tabs)/index.tsx'], { encoding: 'utf8' });
    const sosButton = source => source.match(/<Pressable accessibilityRole="button" accessibilityLabel="Avvia countdown SOS"[^\n]+/)[0].trim();
    assert.equal(sosButton(home), sosButton(base));
    const screen = fs.readFileSync('app/sos/[id].tsx', 'utf8');
    assert.match(screen, /isActiveSOSStatus\(remoteState\.sos_status\) && !error/);
    assert.match(screen, /!isRefreshingEmergency/);
    assert.match(screen, /requestInFlight = true;\s+if \(Platform\.OS === 'android'\) setIsRefreshingEmergency\(true\)/);
    assert.match(screen, /key=\{`\$\{userId\}:\$\{sosId\}`\}/);
    const repository = fs.readFileSync('backend/repositories/EmergencyProfileRepository.ts', 'utf8');
    assert.match(repository, /rpc\('get_received_sos_emergency_profile', \{ target_sos_id: sosId \}\)/);
    const sql = fs.readFileSync('supabase/migrations/20260723120000_emergency_profile.sql', 'utf8').split('create or replace function public.get_received_sos_emergency_profile')[1];
    for (const required of ["status in ('open', 'accepted')", 'auth.uid() is not null', 'trusted_contact.linked_profile_id = auth.uid()', 'share_medical_data_during_sos', 'share_ice_contact_during_sos']) assert.ok(sql.includes(required));
    assert.doesNotMatch(sql, /nearby|neighborhood|network/i);
    for (const path of ['components/ReceivedEmergencyInformation.tsx', 'services/ReceivedEmergencyProfile.ts']) {
      const source = fs.readFileSync(path, 'utf8');
      assert.doesNotMatch(source, /console\.|AsyncStorage|\.from\(|Linking|fetch\(/);
    }
  }],
];
(async () => { let failed = 0; for (const [name, run] of cases) {
  try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
} if (failed) process.exitCode = 1; })();
