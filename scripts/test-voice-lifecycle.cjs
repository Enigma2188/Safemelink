const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual lifecycle with an asynchronous Android abort/end sequence.
function fixture({ confirmStart = true, hangStop = false } = {}) {
  let now = 100_000;
  let timerId = 0;
  const timers = new Map();
  const effects = [];
  const events = {};
  let appState;
  let running = false;
  let nativeState = 'inactive';
  let starts = 0;
  let settings = { enabled: false, passphrase: 'test phrase', expiresAt: null };
  const setTimer = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
  const advance = async (ms) => {
    await flush();
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = end;
    await flush();
  };
  const native = {
    abort() {
      nativeState = 'stopping';
      events.error?.({ error: 'aborted' });
      setTimer(() => { events.end?.(); nativeState = 'inactive'; }, 200);
    },
    getStateAsync: async () => hangStop ? new Promise(() => {}) : nativeState,
    getPermissionsAsync: async () => ({ granted: true }),
    start() {
      assert.equal(nativeState, 'inactive', 'replacement must wait for native teardown');
      nativeState = 'starting';
      starts++;
      if (confirmStart) setTimer(() => { nativeState = 'recognizing'; events.start?.(); }, 10);
    },
  };
  const modules = {
    '@/services/VoiceRecognitionCapabilities': { logVoiceEngineError() {} },
    react: { useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn) },
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: (_type, fn) => { appState = fn; return { remove() { appState = undefined; } }; } } },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: native, useSpeechRecognitionEvent: (event, fn) => { events[event] = fn; } },
    '@/backend/auth/AuthProvider': { useAuth: () => ({ session: { user: { id: 'account-A' } }, isInitializing: false }) },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { isRunning: () => running, stop: async () => { running = false; }, getRecognitionReadiness: async () => 'ready' } },
    '@/storage/VoiceProtectionStorage': { VoiceProtectionStorage: { get: async () => ({ ...settings }), save: async (_user, value) => { settings = value; } } },
    '@/storage/PassphraseStorage': { normalizePassphrase: (value) => value.trim().toLowerCase() },
  };
  function load(file) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; },
      console: { info() {}, warn() {} }, Date: class extends Date { static now() { return now; } },
      setTimeout: setTimer, clearTimeout: clearTimer, queueMicrotask,
    }, { filename: file });
    return exports;
  }
  modules['@/services/SafetyOperation'] = load('services/SafetyOperation.ts');
  modules['@/services/VoiceProtectionRuntime'] = load('services/VoiceProtectionRuntime.ts');
  modules['@/services/VoiceRecognitionStop'] = load('services/VoiceRecognitionStop.ts');
  const runtime = modules['@/services/VoiceProtectionRuntime'].VoiceProtectionRuntime;
  load('components/VoiceProtectionLifecycle.tsx').VoiceProtectionLifecycle();
  const cleanups = effects.map((effect) => effect()).filter(Boolean);
  return {
    advance, runtime, events,
    enable() { running = true; settings.enabled = true; runtime.allowRecognitionStart('account-A'); runtime.notifySettingsChanged('account-A'); },
    stopWithStaleSettings() { runtime.requestRecognitionStop('account-A'); runtime.notifySettingsChanged('account-A'); appState?.('active'); },
    disable() { runtime.requestRecognitionStop('account-A'); settings.enabled = false; running = false; runtime.notifySettingsChanged('account-A'); },
    appState: (state) => appState?.(state),
    loseEngine: () => { nativeState = 'inactive'; },
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
    get starts() { return starts; },
    get enabled() { return settings.enabled; },
    get pendingTimers() { return timers.size; },
    get status() { return runtime.getRecognitionState('account-A'); },
  };
}

(async () => {
  const f = fixture();
  await f.advance(250);
  f.enable();
  await f.advance(100);
  assert.equal(f.starts, 0, 'do not overlap abort and start');
  await f.advance(200);
  assert.equal(f.starts, 1);
  assert.equal(f.status, 'listening');
  f.appState('background'); f.appState('active');
  await f.advance(100);
  assert.equal(f.starts, 1, 'navigation/foreground must not restart a running recognizer');
  f.disable(); f.enable();
  await f.advance(300);
  assert.equal(f.starts, 2, 'OFF to ON recovers after old end');
  assert.equal(f.status, 'listening');
  f.events.error({ error: 'network' });
  f.events.end();
  assert.equal(f.status, 'retrying');
  await f.advance(3_100);
  assert.equal(f.starts, 3, 'error plus end schedule one replacement');
  f.events.result({ isFinal: true, results: [{ transcript: 'test phrase' }] });
  const scheduled = f.runtime.getScheduledSOS('account-A');
  assert.ok(scheduled);
  f.events.result({ isFinal: true, results: [{ transcript: 'test phrase' }] });
  assert.equal(f.runtime.getScheduledSOS('account-A').expiresAt, scheduled.expiresAt);
  f.runtime.notifySettingsChanged('account-B');
  assert.equal(f.starts, 3, 'another account cannot restart this owner');
  f.unmount();
  await f.advance(10_000);
  assert.equal(f.starts, 3);
  assert.equal(f.pendingTimers, 0);

  const manualOff = fixture();
  const repeated = fixture();
  await repeated.advance(250);
  let seed = 42;
  for (let cycle = 0; cycle < 100; cycle++) {
    repeated.enable(); await repeated.advance(300);
    assert.equal(repeated.status, 'listening');
    repeated.disable();
    const late = [() => repeated.events.start(), () => repeated.events.end(),
      () => repeated.events.error({ error: 'network' }), () => repeated.appState('background'),
      () => repeated.appState('active'), () => repeated.runtime.notifySOSClosed('account-A')];
    for (let i = late.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1); [late[i], late[j]] = [late[j], late[i]];
    }
    late.forEach(callback => callback());
    await repeated.advance(2_000);
    assert.equal(repeated.status, 'off');
    assert.equal(repeated.starts, cycle + 1);
    assert.equal(repeated.pendingTimers, 0);
  }
  repeated.unmount(); await repeated.advance(300);
  await manualOff.advance(250); manualOff.enable(); await manualOff.advance(300);
  manualOff.events.error({ error: 'network' });
  manualOff.stopWithStaleSettings();
  manualOff.runtime.notifySOSClosed('account-A');
  manualOff.runtime.notifySOSFailed('account-A', new Error('test'));
  manualOff.events.start(); manualOff.events.end();
  await manualOff.advance(40_000);
  assert.equal(manualOff.status, 'off', 'manual OFF wins over stale settings and native/SOS callbacks');
  assert.equal(manualOff.starts, 1, 'manual OFF cancels all pending restarts');
  assert.equal(manualOff.pendingTimers, 0);
  manualOff.enable(); await manualOff.advance(300);
  assert.equal(manualOff.status, 'listening', 'explicit ON clears the stop veto');
  manualOff.unmount(); await manualOff.advance(300);

  const sosCycle = fixture();
  await sosCycle.advance(250); sosCycle.enable(); await sosCycle.advance(300);
  sosCycle.runtime.notifySOSExecutionStarted('account-A');
  await sosCycle.advance(300); sosCycle.appState('active'); await sosCycle.advance(2_000);
  assert.equal(sosCycle.starts, 1, 'foreground cannot resume recognition during active SOS');
  sosCycle.runtime.notifySOSClosed('account-A'); await sosCycle.advance(2_000);
  assert.equal(sosCycle.starts, 2, 'real close resumes once when ON');
  sosCycle.runtime.notifySOSClosed('account-A'); sosCycle.disable();
  await sosCycle.advance(3_000); assert.equal(sosCycle.status, 'off');
  assert.equal(sosCycle.starts, 2, 'OFF wins over close timer');
  sosCycle.unmount(); await sosCycle.advance(300);
  assert.equal(sosCycle.pendingTimers, 0);

  const timeout = fixture({ confirmStart: false });
  await timeout.advance(250); timeout.enable();
  await timeout.advance(6_000);
  assert.equal(timeout.status, 'error', 'missing native start must not leave false active state');
  assert.equal(timeout.enabled, false);
  timeout.unmount(); await timeout.advance(250);
  assert.equal(timeout.pendingTimers, 0);

  const stopped = fixture({ hangStop: true });
  stopped.enable();
  await stopped.advance(2_500);
  assert.equal(stopped.starts, 0, 'uncertain native stop cannot start a competing owner');
  assert.equal(stopped.enabled, false);
  stopped.unmount(); await stopped.advance(3_000);
  assert.equal(stopped.pendingTimers, 0);

  const cancelled = fixture();
  cancelled.enable(); cancelled.unmount();
  await cancelled.advance(6_000);
  assert.equal(cancelled.starts, 0, 'cleanup invalidates pending bootstrap/start');
  const resumed = fixture();
  await resumed.advance(250); resumed.enable(); await resumed.advance(300);
  resumed.loseEngine(); resumed.appState('active');
  await resumed.advance(300);
  assert.equal(resumed.starts, 2, 'resume reconciles an engine stopped without an end event');
  assert.equal(resumed.status, 'listening');
  resumed.unmount(); await resumed.advance(250);
  const breaker = fixture();
  await breaker.advance(250); breaker.enable(); await breaker.advance(300);
  for (const delay of [3_000, 6_000, 12_000, 24_000]) {
    breaker.events.error({ error: 'network' });
    await breaker.advance(delay + 20);
  }
  breaker.events.error({ error: 'network' });
  await breaker.advance(40_000);
  assert.equal(breaker.enabled, false, 'repeated failures trip the existing circuit breaker');
  assert.equal(breaker.starts, 5, 'no unbounded retries');
  breaker.unmount(); await breaker.advance(250);
  assert.equal(breaker.pendingTimers, 0);
  console.log('Voice lifecycle: async OFF/ON, native start timeout, recovery, ownership, dedup and cleanup PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
