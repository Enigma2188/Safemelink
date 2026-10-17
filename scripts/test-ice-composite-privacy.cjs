const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, Date, Number }); return exports;
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const status = patch => ({ owner_id: 'A', verified_at: '2026-10-15T10:00:00Z', legacy_shared: false,
  legacy_text_present: true, structured_shared: false, phone_shared: false, safety_shared: true, ...patch });
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => nodes(tree).filter(n => n.type === 'Text').map(n => JSON.stringify(n.props.children)).join(' ');
function fixture() {
  const values = [], refs = [], effects = [], pending = [], dialogs = [], busy = []; let completed = 0;
  let si = 0, ri = 0, ei = 0, owner = 'A', focused = true, app;
  const props = { revision: 'r1', disabled: false, onBusyChange: v => busy.push(v), onReloadForms: () => completed++ };
  const modules = {
    '@/backend/remoteRequest': { runRemoteRequest: fn => fn({}) },
    '@/backend/supabaseClient': { requireSupabaseClient: () => ({ rpc: (name, args) => ({
      abortSignal: () => new Promise((resolve, reject) => pending.push({ name, args, resolve: data => resolve({ data, error: null }), error: () => resolve({ data: null, error: { code: 'PGRST202' } }), reject })),
    }) }) },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: owner ? { user: { id: owner } } : null, isInitializing: false }) },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'android' }, Text: 'Text', View: 'View', Pressable: 'Button', StyleSheet: { create: x => x },
      Alert: { alert: (_title, _message, buttons) => dialogs.push(buttons) },
      AppState: { currentState: 'active', addEventListener: (_event, fn) => { app = fn; return { remove() {} }; } } },
    react: {
      useState: initial => { const i = si++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      useRef: initial => { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }); },
      useEffect: (fn, deps) => { const i = ei++, old = effects[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) effects[i] = { fn, deps, dirty: true, cleanup: old?.cleanup }; },
    },
  };
  const service = load('services/ICEPrivacyService.ts', modules);
  modules['@/services/ICEPrivacyService'] = service;
  const Panel = load('components/ICEPrivacyPanel.tsx', modules).ICEPrivacyPanel;
  const render = (commit = true) => { si = ri = ei = 0; const tree = Panel(props);
    if (commit) for (const e of effects) if (e.dirty) { e.cleanup?.(); e.cleanup = e.fn(); e.dirty = false; } return tree; };
  return { service, pending, dialogs, busy, props, render, owner: v => { owner = v; }, focus: v => { focused = v; },
    background: () => app('background'), get completed() { return completed; }, cleanup: () => effects.forEach(e => e.cleanup?.()) };
}
const revokeButton = tree => nodes(tree).find(n => n.type === 'Button' && n.props.children.props.children === 'DISATTIVA TUTTE LE CONDIVISIONI ICE');
(async () => {
  const f = fixture(), s = f.service;
  assert.match(s.describeICEPrivacy(status({ legacy_shared: true })), /non può essere considerato nascosto/);
  assert.match(s.describeICEPrivacy(status({ phone_shared: true, structured_shared: true })), /Numero ICE strutturato condiviso/);
  assert.match(s.describeICEPrivacy(status({ structured_shared: true })), /Nome e relazione/);
  assert.match(s.describeICEPrivacy(status()), /non è una garanzia/i);
  assert.throws(() => s.parseICEPrivacyStatus(null, 'A'));
  assert.throws(() => s.parseICEPrivacyStatus(status({ legacy_shared: null }), 'A'));
  assert.throws(() => s.parseICEPrivacyStatus(status(), 'B'));
  console.log('PASS legacy ON/new OFF, inverse, all OFF and incomplete/cross-account responses');
  f.render(); assert.equal(revokeButton(f.render()).props.disabled, true);
  f.pending[0].resolve(status({ legacy_shared: true })); await flush();
  let tree = f.render(); assert.match(text(tree), /intero testo resta condivisibile/);
  revokeButton(tree).props.onPress(); f.dialogs.at(-1)[1].onPress();
  assert.equal(f.pending.length, 2); assert.equal(f.pending[1].name, 'revoke_my_all_ice_sharing');
  assert.equal(f.pending[1].args.expected_owner_id, 'A');
  assert.match(text(f.render()), /nessuna garanzia/); assert.equal(f.completed, 0);
  f.pending[1].resolve(status()); await flush(); assert.equal(f.completed, 1); assert.match(text(f.render()), /confermata dal server/);
  // A future legacy writer is NOT blocked: fresh status must expose that fact.
  f.props.revision = 'r2'; assert.match(text(f.render(false)), /non verificato/); f.render();
  f.pending.at(-1).resolve(status({ legacy_shared: true })); await flush();
  assert.match(text(f.render()), /non può essere considerato nascosto/); f.cleanup();
  console.log('PASS actual panel/service: one revoke RPC, confirmed result, later legacy reactivation reported (not prevented)');
  for (const failure of ['missing', 'partial', 'still_on', 'timeout']) {
    const h = fixture(); h.render(); h.pending[0].resolve(status({ legacy_shared: true })); await flush();
    revokeButton(h.render()).props.onPress(); h.dialogs[0][1].onPress();
    if (failure === 'missing') h.pending[1].error();
    if (failure === 'partial') h.pending[1].resolve({ owner_id: 'A' });
    if (failure === 'still_on') h.pending[1].resolve(status({ legacy_shared: true }));
    if (failure === 'timeout') h.pending[1].reject(new Error('synthetic timeout'));
    await flush(); tree = h.render(); assert.match(text(tree), /REVOCA NON CONFERMATA/);
    assert.doesNotMatch(text(tree), /Revoca dei tre consensi confermata/);
    assert.equal(revokeButton(tree).props.disabled, true); h.cleanup();
  }
  console.log('PASS missing RPC, null/partial outcome, remaining ON and timeout never falsely confirm privacy');
  for (const change of ['account', 'logout', 'background', 'focus', 'revision']) {
    const h = fixture(); h.render();
    if (change === 'account') h.owner('B'); if (change === 'logout') h.owner(null);
    if (change === 'background') h.background(); if (change === 'focus') h.focus(false); if (change === 'revision') h.props.revision = 'r2';
    h.render(false); h.pending[0].resolve(status({ legacy_shared: true })); await flush();
    assert.doesNotMatch(text(h.render()), /ICE legacy condiviso:/); h.cleanup();
  }
  {
    const h = fixture(); h.render(); h.pending[0].resolve(status({ legacy_shared: true })); await flush();
    revokeButton(h.render()).props.onPress(); h.dialogs[0][1].onPress(); h.owner('B'); h.render(false);
    h.pending[1].resolve(status()); await flush(); assert.equal(h.completed, 0); assert.doesNotMatch(text(h.render()), /confermata dal server/); h.cleanup();
  }
  console.log('PASS context changes discard old status/revocation callbacks before passive cleanup');
  {
    const h = fixture(); let writable = true; h.props.canRevoke = () => writable;
    h.render(); h.pending[0].resolve(status({ legacy_shared: true })); await flush();
    revokeButton(h.render()).props.onPress(); writable = false; h.dialogs[0][1].onPress();
    assert.equal(h.pending.length, 1, 'an intervening save blocks the old confirmation before a render'); h.cleanup();
  }
  {
    const h = fixture(); h.render(); h.pending[0].resolve(status({ legacy_shared: true })); await flush();
    const press = revokeButton(h.render()).props.onPress; press(); press();
    h.dialogs[0][1].onPress(); h.dialogs[1][1].onPress();
    assert.equal(h.pending.length, 2, 'duplicate confirmations issue only one revoke RPC');
    h.pending[1].resolve(status()); await flush(); h.cleanup();
  }
  console.log('PASS synchronous write barrier and duplicate-confirmation guard');
  const sql = fs.readFileSync('supabase/migrations/20261015120000_ice_composite_privacy.sql', 'utf8');
  const body = sql.split('create function public.revoke_my_all_ice_sharing')[1].split('$$;')[0];
  assert.match(body, /update public\.emergency_profiles[\s\S]*update public\.emergency_private_details/);
  assert.match(body, /share_ice_contact_during_sos=false/); assert.match(body, /share_ice=false,share_ice_phone=false/);
  assert.doesNotMatch(body, /\bcommit\b|\bexception\s+when\b|\bdelete\b|\bice_contact\s*=|\bice_phone\s*=|\bshare_safety\s*=/i);
  assert.match(sql, /actor_id is distinct from expected_owner_id/);
  assert.doesNotMatch(sql, /create or replace|alter function public\.(update_my_emergency_profile|get_received_sos_emergency_profile)\(/i);
  assert.equal((sql.match(/security definer set search_path=pg_catalog,pg_temp/g) || []).length, 2);
  assert.match(sql, /from public,anon,authenticated,service_role/);
  const screen = fs.readFileSync('screens/EmergencyProfileScreen.tsx', 'utf8');
  assert.match(screen, /disabled=\{profileBusy \|\| advancedBusy \|\| profileActionBusy\}/); assert.match(screen, /externalBusy=\{revokeBusy\}/);
  assert.match(screen, /setPrivacyReload\(true\)/);
  for (const file of ['services/ICEPrivacyService.ts', 'components/ICEPrivacyPanel.tsx'])
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /console\.|AsyncStorage|analytics|sendSMS|pushNotification|ice_contact\b/);
  console.log('PASS STATIC: two updates in one uncaught SQL transaction, values retained, safe grants, old RPCs untouched');
  const dev = fs.readFileSync('scripts/test-ice-composite-development.sql', 'utf8');
  assert.match(dev, /verified_ref text:=null; workers_stopped boolean:=false/);
  assert.match(dev, /rollback;\s*$/);
  assert.doesNotMatch(dev.replace(/--[^\n]*/g, '').replace(/on commit drop/gi, ''), /\bcommit\b/i);
  assert.match(dev, /phase14_synthetic_rejection/); assert.match(dev, /Partial revocation survived exception/);
  console.log('PASS STATIC: Development package default blocked, injected second-update failure, final rollback');
  console.log('PostgreSQL atomicity/concurrency/RLS and legacy-writer race NOT EXECUTED. Persistent block NOT IMPLEMENTED.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
