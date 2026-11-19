const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture() {
  let index = 0, user = 'A', tree, alert, result = { kind: 'active', attemptId: null, remoteActiveId: 'remote', reason: 'remote_active' };
  const slots = [], effects = [], calls = { inspect: 0, close: 0, clear: 0, notify: 0 };
  const hooks = {
    useState: initial => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef: initial => { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: fn => fn,
    useEffect: (fn, deps) => { const i = index++; const old = slots[i];
      if (!old || deps.some((d, j) => d !== old.deps[j])) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const deps = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Alert: { alert: (...args) => { alert = args; } }, Pressable: 'button', Text: 'text', View: 'view' },
    'expo-router': { Link: 'link' },
    '@/services/VoiceSOSRecoveryActions': { inspectVoiceRecovery: async () => { calls.inspect++; return result; },
      retryRequestedVoiceClosures: async () => { calls.reconcile = (calls.reconcile ?? 0) + 1; return { completed: [], unresolved: 0 }; },
      voiceRecoveryMessage: r => r.reason, closeVerifiedVoiceSOS: async (_u, _id, current) => { assert.ok(current()); calls.close++; } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: { clearVerifiedSuspension: async () => { calls.clear++; return true; }, notifySettingsChanged: () => { calls.notify++; } } },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('components/VoiceSOSRecoveryPanel.tsx', 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: key => { assert.ok(key in deps, key); return deps[key]; } });
  const render = () => { index = 0; tree = exports.VoiceSOSRecoveryPanel({ userId: user }); while (effects.length) effects.shift()(); };
  const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : '';
  function find(node, label) {
    if (!node) return null;
    if (Array.isArray(node)) return node.map(x => find(x, label)).find(Boolean);
    if (node.type === 'button' && text(node).includes(label)) return node;
    return find(node.props?.children, label);
  }
  render(); render();
  return { calls, render, setUser: value => { user = value; render(); render(); }, setResult: value => { result = value; },
    click: label => { render(); const button = find(tree, label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onPress(); },
    confirmation: () => alert?.[2]?.find(item => item.text === 'Sì, emergenza terminata')?.onPress };
}
(async () => {
  const f = fixture(); assert.deepEqual(f.calls, { inspect: 0, close: 0, clear: 0, notify: 0 });
  f.click('VERIFICA SOS'); await flush(); assert.equal(f.calls.inspect, 1); assert.equal(f.calls.close, 0);
  f.click('CONCLUDI'); assert.equal(f.calls.close, 0, 'opening confirmation cannot close an SOS');
  const confirm = f.confirmation(); assert.equal(typeof confirm, 'function'); confirm(); confirm(); await flush();
  assert.equal(f.calls.close, 1, 'double confirmation is serialized');
  const stale = fixture(); stale.click('VERIFICA SOS'); await flush(); stale.click('CONCLUDI'); const oldConfirm = stale.confirmation();
  stale.setUser('B'); oldConfirm(); await flush(); assert.equal(stale.calls.close, 0, 'old account confirmation is discarded');
  const clear = fixture(); clear.setResult({ kind: 'clear', attemptId: 'old', reason: 'verified_clear' });
  clear.click('VERIFICA SOS'); await flush(); assert.equal(clear.calls.clear, 1); assert.equal(clear.calls.notify, 1); assert.equal(clear.calls.close, 0);
  const pending = fixture(); pending.setResult({ kind: 'active', remoteActiveId: 'remote', pendingClosures: 1 });
  pending.click('VERIFICA SOS'); await flush(); assert.equal(pending.calls.reconcile, undefined);
  pending.click('RIPRENDI CHIUSURE'); await flush(); assert.equal(pending.calls.reconcile, 1);
  assert.equal(pending.calls.close, 0); assert.equal(pending.calls.inspect, 2);
  console.log('PASS actual recovery panel handlers: mount/read never close, explicit confirmation, duplicate tap, account change, verified local release');
})().catch(error => { console.error(error); process.exitCode = 1; });
