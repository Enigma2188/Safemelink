const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const base = 'modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/';
const journal = fs.readFileSync(base + 'CheckpointDiagnosticJournal.kt', 'utf8');
const store = fs.readFileSync(base + 'SafetyDeadlineStore.kt', 'utf8');
const receiver = fs.readFileSync(base + 'SafetyDeadlineReceiver.kt', 'utf8');
const bridge = fs.readFileSync(base + 'SafeMeLinkSafetyModule.kt', 'utf8');
const gradle = fs.readFileSync('modules/safemelink-safety/android/build.gradle', 'utf8');

assert.match(journal, /private const val LIMIT = 100/);
assert.match(journal, /events.length\(\) - LIMIT \+ 1/);
assert.match(journal, /getSharedPreferences\("checkpoint-diagnostic-journal"/);
assert.match(journal, /catch \(_: Throwable\)/);
assert.doesNotMatch(journal, /SafetyDeadlineStore\.|AlarmManager|NotificationManager|sendEvent|\.commit\(|https?:|Clipboard/);
assert.match(journal, /if \(!BuildConfig.CHECKPOINT_DIAGNOSTICS\) return/);
assert.match(gradle, /System.getenv\('EXPO_PUBLIC_CHECKPOINT_DIAGNOSTICS'\) == 'true' \? 'true' : 'false'/);
assert.match(journal, /record.optString\("generation"\) == gen/);
assert.match(journal, /record.optString\("kind"\) == "checkpoint"/);
assert.match(journal, /event.optString\("owner"\) != owner\) continue/);
const read = journal.slice(journal.indexOf('@Synchronized fun read'));
assert.doesNotMatch(read, /\.edit\(|\.apply\(|\.putString\(|record\(context/);
assert.match(read, /listOf\("timestamp", "event", "phase", "outcome", "deadline", "lateness", "session"\)/);
assert.match(receiver, /record\(context, "RECEIVER_ENTERED", generation = generation/);
assert.ok(receiver.indexOf('"RECEIVER_ENTERED"') < receiver.indexOf('SafetyDeadlineStore.fired'));
for (const event of ['ALARM_IGNORED', 'PRE_PUBLICATION_PERSISTENCE_FAILED', 'NOTICE_CANCEL_REQUESTED', 'NOTICE_REPLACEMENT_POSSIBLE']) assert.ok(store.includes('"' + event + '"'), event);
for (const reason of ['record_missing_or_unreadable', 'generation_mismatch', 'inactive_session', 'invalid_stage_or_consumed', 'lease_active', 'before_deadline']) assert.ok(store.includes('"' + reason + '"'), reason);
assert.match(bridge, /AsyncFunction\("getCheckpointDiagnosticEvents"\)/);
assert.match(bridge, /Function\("copyCheckpointDiagnosticReport"\)/);
assert.match(bridge, /notify\(\) returned does NOT prove visibility or reading/);
console.log('PASS STATIC Kotlin: bounded separate persistence, native gate OFF, account filtering, receiver path independent of React, read-only allowlisted export, non-throwing instrumentation');
console.log('NOTE: Kotlin/Android storage and background execution are not executed by this source-level test.');

async function uiTest() {
  let currentOwner = 'A', flag = true, nativeGate = true, cursor = 0;
  const slots = [], effects = [], pending = [], listeners = new Set();
  const calls = { read: 0, copy: 0, notify: 0 };
  const react = {
    useState(value) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value };
      return [slots[i].value, next => { slots[i].value = next; }];
    },
    useRef(value) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { current: value };
      return slots[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps.some((dep, n) => dep !== previous.deps[n])) {
        previous?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = fn(); });
      }
    },
  };
  const native = {
    checkpointDiagnosticsAvailable: () => nativeGate,
    getCheckpointDiagnosticEvents(owner) {
      calls.read++;
      return new Promise(resolve => pending.push({ owner, resolve }));
    },
    copyCheckpointDiagnosticReport(owner) { assert.equal(owner, currentOwner); calls.copy++; },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', AppState: {
      currentState: 'active', addEventListener: (_event, cb) => { listeners.add(cb); return { remove: () => listeners.delete(cb) }; },
    } },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: currentOwner ? { user: { id: currentOwner } } : null }) },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: native },
    '@/services/CheckpointNotificationDiagnostic': { checkpointDiagnosticsEnabled: () => flag,
      runCheckpointNotificationDiagnostic: () => { calls.notify++; throw Error('not used'); } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/CheckpointNotificationDiagnostic.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; }, process: { env: {} } });
  function render() {
    cursor = 0;
    const tree = exports.CheckpointNotificationDiagnostic();
    while (effects.length) effects.shift()();
    return tree;
  }
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    const children = [tree.props?.children].flat(Infinity);
    return [tree, ...children.flatMap(nodes)];
  }
  render();
  assert.equal(pending[0].owner, 'A');
  currentOwner = 'B'; render();
  pending[0].resolve('ACCOUNT_A_EVENTS'); await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(JSON.stringify(render()), /ACCOUNT_A_EVENTS/);
  pending[1].resolve('ACCOUNT_B_EVENTS'); await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  assert.match(JSON.stringify(tree), /ACCOUNT_B_EVENTS/);
  const copy = nodes(tree).find(n => n.type === 'Pressable' && JSON.stringify(n.props.children).includes('COPIA RAPPORTO TECNICO'));
  copy.props.onPress(); assert.equal(calls.copy, 1);
  const readsBeforeResume = calls.read;
  for (const listener of listeners) listener('active');
  assert.equal(calls.read, readsBeforeResume + 1);
  currentOwner = null; tree = render();
  assert.doesNotMatch(JSON.stringify(tree), /ACCOUNT_[AB]_EVENTS/);
  const before = calls.read;
  flag = false; currentOwner = 'C'; assert.equal(render(), null); assert.equal(calls.read, before);
  flag = true; nativeGate = false; currentOwner = 'D'; assert.equal(render(), null); assert.equal(calls.read, before);
  assert.equal(calls.notify, 0);
  console.log('PASS actual TSX with controlled hooks: stale account response discarded, logout clears display, foreground re-read, manual copy only, JS/native OFF hides UI, reading never invokes notification test');
}
uiTest().catch(error => { console.error(error); process.exitCode = 1; });
