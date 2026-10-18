const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture } = require('./test-safety-expirations.cjs');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

async function armed() {
  const f = fixture(null, 'android', { info() {} });
  await f.runtime.schedule('A', 'checkpoint', 'session', f.deadline(), 30);
  await f.native.armDeadlines(f.stored.nativeDeadlineGeneration);
  return f;
}
function failT1(f) {
  // Controlled native boundary, not execution of Android/Kotlin notification APIs.
  f.nativeRecord.firstNoticeFailed = true;
  f.nativeRecord.firstNoticeFailureReason = 'publication_rejected';
}
function warningFixture() {
  let user = 'A', appState = 'active', raw = JSON.stringify({ generation: 'g1', sessionId: 'old', reason: 'publication_rejected' });
  let cursor = 0, effectPending = true, cleanup, nativeListener, foregroundListener;
  const states = [], refs = [];
  const native = {
    getCheckpointNoticeFailure: owner => owner === 'A' ? raw : null,
    acknowledgeCheckpointNoticeFailure: (owner, generation) => {
      if (owner !== 'A' || !raw || JSON.parse(raw).generation !== generation) return false;
      raw = null; return true;
    },
    addListener: (event, listener) => {
      assert.equal(event, 'onCheckpointNoticeFailed'); nativeListener = listener;
      return { remove() { nativeListener = null; } };
    },
  };
  const element = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: value => { const i = cursor++; return refs[i] ??= { current: value }; },
      useEffect: fn => { if (effectPending) cleanup = fn(); },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native': {
      Platform: { OS: 'android' }, Pressable: 'Pressable', Text: 'Text', View: 'View', ScrollView: 'ScrollView',
      AppState: { get currentState() { return appState; }, addEventListener: (_event, listener) => {
        foregroundListener = listener; return { remove() { foregroundListener = null; } };
      } },
    },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: { user: { id: user } }, isInitializing: false }) },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: native },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('components/CheckpointNotificationWarning.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, console });
  const render = () => { cursor = 0; const tree = exports.CheckpointNotificationWarning(); effectPending = false; return tree; };
  function button(tree) {
    if (!tree) return null;
    if (tree.type === 'Pressable') return tree;
    const children = tree.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) { const found = button(child); if (found) return found; }
    return null;
  }
  render(); render();
  return {
    render, get visible() { return Boolean(render()); },
    acknowledge: () => button(render()).props.onPress(),
    background() { appState = 'background'; foregroundListener?.(); },
    foreground() { appState = 'active'; foregroundListener?.(); render(); },
    emit() { nativeListener?.(); render(); },
    replaceWarning() { raw = JSON.stringify({ generation: 'g2', sessionId: 'new' }); },
    clearWarning() { raw = null; },
    changeAccount() { cleanup?.(); user = 'B'; effectPending = true; render(); render(); },
    unmount() { cleanup?.(); }, get raw() { return raw; },
  };
}
const cases = [
  ['T1 success and failure both keep 30 seconds and exactly one T2', async () => {
    for (const failed of [false, true]) {
      const f = await armed(); const deadline = f.stored.confirmationExpiresAt;
      f.advance(1000); if (failed) failT1(f); else f.nativeRecord.firstFired = true;
      const t1 = await f.runtime.processDue('A');
      assert.equal(f.stored.phase, 'confirming'); assert.equal(f.deliveries, 0); assert.equal(t1.waitMs, 30_000);
      f.advance(29_999); await f.runtime.processDue('A'); assert.equal(f.deliveries, 0, 'never before T1 + 30s');
      f.advance(1); await f.runtime.processDue('A'); await flush();
      assert.equal(f.deliveries, 1); assert.equal(f.operationIds.length, 1);
      await f.runtime.waitForExecution('A'); await f.runtime.processDue('A');
      assert.equal(f.deliveries, 1); assert.equal(Date.parse(deadline), 1_031_000);
    }
  }],
  ['valid response/cancel before T2 prevents SOS even after T1 failure', async () => {
    const f = await armed(); f.advance(1000); failT1(f); await f.runtime.processDue('A');
    f.advance(29_999); assert.equal(await f.runtime.cancel('A', 'checkpoint', 'session'), true);
    f.advance(1); await f.runtime.processDue('A'); assert.equal(f.deliveries, 0); assert.equal(f.nativeRecord, null);
  }],
  ['restart after failed T1 preserves deadline and remaining response time', async () => {
    const f = await armed(); f.advance(11_000); failT1(f); const original = f.stored.confirmationExpiresAt;
    f.restart(); const recovered = await f.runtime.processDue('A');
    assert.equal(recovered.waitMs, 20_000); assert.equal(f.stored.confirmationExpiresAt, original);
    f.advance(19_999); await f.runtime.processDue('A'); assert.equal(f.deliveries, 0);
    f.advance(1); await f.runtime.processDue('A'); await f.runtime.waitForExecution('A'); assert.equal(f.deliveries, 1);
  }],
  ['late recovery uses original expired T2, never invents a new deadline', async () => {
    const f = await armed(); const original = f.stored.confirmationExpiresAt; failT1(f); f.advance(120_000); f.restart();
    await f.runtime.processDue('A'); await f.runtime.waitForExecution('A');
    assert.equal(f.deliveries, 1); assert.equal(Date.parse(original), 1_031_000);
  }],
  ['T1 diagnostic failure during claim cannot veto or duplicate T2', async () => {
    const f = await armed(); const claim = f.native.claimEscalation;
    f.native.claimEscalation = (...args) => { failT1(f); return claim.apply(f.native, args); };
    f.advance(31_000); await Promise.all([f.runtime.processDue('A'), f.runtime.processDue('A')]);
    await f.runtime.waitForExecution('A'); assert.equal(f.deliveries, 1);
  }],
  ['manual SOS retains its independent path', async () => {
    const f = fixture(null, 'android', { info() {} });
    await f.runtime.schedule('A', 'manual_sos', 'session', f.deadline(), 0);
    f.advance(1000); await f.runtime.processDue('A'); await f.runtime.waitForExecution('A');
    assert.equal(f.deliveries, 1); assert.equal(f.nativeRecord, null);
  }],
  ['persistent warning survives foreground, replacement and restart without blocking controls', async () => {
    const f = warningFixture(); assert.equal(f.visible, true); assert.equal(f.render().type, 'SafeAreaView');
    f.background(); f.replaceWarning(); f.emit();
    f.acknowledge(); assert.notEqual(f.raw, null, 'old acknowledgement cannot dismiss a newer generation');
    f.foreground(); assert.equal(f.visible, true); f.acknowledge(); assert.equal(f.visible, false); assert.equal(f.raw, null);
    f.unmount();
    const restarted = warningFixture(); assert.equal(restarted.visible, true);
    restarted.changeAccount(); assert.equal(restarted.visible, false); assert.notEqual(restarted.raw, null); restarted.unmount();
  }],
  ['foreground native warning appears immediately without navigation or polling', async () => {
    const f = warningFixture(); f.clearWarning(); f.emit(); assert.equal(f.visible, false);
    f.replaceWarning(); f.emit(); assert.equal(f.visible, true); f.acknowledge(); assert.equal(f.visible, false); f.unmount();
  }],
  ['Kotlin failure path is diagnostic only; preflight and identity remain enforced (static)', async () => {
    const root = 'modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/';
    const native = fs.readFileSync(root + 'SafetyDeadlineStore.kt', 'utf8');
    const t1 = native.slice(native.indexOf('@Synchronized fun publishConfirmation'), native.indexOf('private fun checkNotificationPrerequisites'));
    assert.match(t1, /firstNoticeFailed/); assert.match(t1, /firstNoticeFailureReason/);
    assert.doesNotMatch(t1, /\.put\("(?:state|armed|claimed|t1|t2)"|cancelAlarms|setAlarmClock|completeSOS/);
    assert.doesNotMatch(native, /interrupted|checkpoint_interruption_unacknowledged/);
    assert.match(native, /t2 == t1 \+ 30_000/);
    assert.match(native, /now < record.getLong\("t2"\)/);
    assert.match(native, /System.currentTimeMillis\(\) < deadline/);
    assert.match(native, /@Synchronized fun claim/); assert.match(native, /@Synchronized fun publishConfirmation/);
    assert.match(native, /if \(!record.optBoolean\("armed"\)\) checkNotificationPrerequisites/);
    assert.match(native, /if \(JSONObject\(raw\).optString\("generation"\) != generation\) return false/);
    const warning = fs.readFileSync('components/CheckpointNotificationWarning.tsx', 'utf8');
    assert.doesNotMatch(warning, /\bModal\b|position:\s*'absolute'|SafetyExpirationRuntime|\.cancel\(|\.schedule\(/);
    assert.match(warning, /SOS automatico rimane previsto/); assert.doesNotMatch(warning, /CHECKPOINT INTERROTTO|non avvierà automaticamente/);
    const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
    assert.match(home, /CHECKPOINT NON AVVIATO/); assert.doesNotMatch(home, /checkpoint_notice_failed/);
  }],
];
(async () => {
  let failed = 0;
  for (const [name, test] of cases) { try { await test(); console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); } }
  if (failed) process.exitCode = 1;
})();
