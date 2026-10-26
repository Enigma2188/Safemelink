const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  let running = false, starts = 0, stops = 0, saves = 0, blocked = false, sos = false;
  let wake, wakePending = false, nativeRelease, current = true;
  let deferStart = false, deferRead = false, readRelease;
  const expiry = new Date(Date.now() + 600_000).toISOString();
  let settings = { enabled: true, passphrase: 'synthetic', expiresAt: expiry };
  let options;
  const signal = () => { if (wake) { const resolve = wake; wake = null; resolve(); } else wakePending = true; };
  const dependencies = {
    'expo-notifications': {}, 'expo-speech-recognition': { ExpoSpeechRecognitionModule: { abort() {} } },
    'react-native': { Platform: { OS: 'android' }, Linking: {}, AppState: { currentState: 'active' } },
    'react-native-background-actions': { default: {
      isRunning: () => running,
      start: async (task, value) => {
        starts++; running = true; options = value;
        // Mirror background-actions: the old task invokes stop on completion.
        void task(value.parameters).then(() => dependencies['react-native-background-actions'].default.stop());
        if (deferStart) await new Promise(resolve => { nativeRelease = resolve; });
      },
      stop: async () => { stops++; running = false; signal(); },
    } },
    '@/services/SafetyExpirationRuntime': { SafetyExpirationRuntime: {
      processDue: async () => ({ schedule: null, waitMs: 60_000 }), get: async () => null,
    } },
    '@/services/SafetyOperation': { withSafetyTimeout: value => value, reportSafetyError() {} },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: {
      isRecognitionStopped: () => blocked, isSOSSuspended: () => sos,
      claimDueSOS: () => false, getScheduledSOS: () => null, cancelScheduledSOS() {},
      wakeBackgroundTask: signal, getBackgroundWaitMs: () => 60_000,
      waitForBackgroundWake: () => wakePending ? (wakePending = false, Promise.resolve()) : new Promise(resolve => { wake = resolve; }),
    } },
    '@/services/SOSService': { SOSService: { completeSOS: () => { throw new Error('No SOS may be created by this test'); } } },
    '@/services/VoiceRecognitionCapabilities': { getVoiceRecognitionReadiness: async () => 'ready' },
    '@/storage/VoiceProtectionStorage': { VoiceProtectionStorage: {
      get: async () => { if (deferRead) { deferRead = false; await new Promise(resolve => { readRelease = resolve; }); } return { ...settings }; },
      save: async () => { saves++; },
    } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/VoiceProtectionService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; },
    console: { info() {}, warn() {} }, Date, setTimeout });
  const api = exports.VoiceProtectionService;
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  return {
    api, flush, restore: () => api.restoreListeningService('A', () => current),
    background() { dependencies['react-native'].AppState.currentState = 'background'; },
    get starts() { return starts; }, get stops() { return stops; }, get saves() { return saves; },
    get expiry() { return expiry; }, get options() { return options; },
    off() { blocked = true; settings.enabled = false; }, sos() { sos = true; },
    changeAccount() { current = false; }, deferStart() { deferStart = true; }, releaseStart() { nativeRelease(); },
    loseNativeService() { running = false; },
    deferSettings() { deferRead = true; }, releaseSettings() { readRelease(); },
    expire() { settings.expiresAt = new Date(0).toISOString(); },
  };
}
const cases = [
  ['background restore never starts a missing microphone foreground service', async () => {
    const f = fixture(); f.background(); await assert.rejects(f.restore(), /primo piano/); assert.equal(f.starts, 0);
  }],
  ['background transition during authorization read prevents native service creation', async () => {
    const f = fixture(); f.deferSettings(); const pending = f.restore(); await f.flush(); f.background(); f.releaseSettings();
    await assert.rejects(pending, /primo piano/); assert.equal(f.starts, 0);
  }],
  ['real service serializes concurrent restoration and preserves the original expiry', async () => {
    const f = fixture(); const results = await Promise.all([f.restore(), f.restore()]);
    assert.deepEqual(results, [true, true]); assert.equal(f.starts, 1);
    assert.equal(f.options.parameters.expiresAt, f.expiry); assert.equal(f.saves, 0);
    await f.api.stop();
  }],
  ['OFF while native start is pending drains the service without a listener or SOS', async () => {
    const f = fixture(); f.deferStart(); const pending = f.restore(); await f.flush();
    assert.equal(f.starts, 1); f.off(); f.releaseStart(); assert.equal(await pending, false);
    assert.equal(f.api.isRunning(), false); assert.ok(f.stops >= 1);
  }],
  ['old stopped task cannot automatically stop the replacement service', async () => {
    const f = fixture(); assert.equal(await f.restore(), true); f.loseNativeService();
    assert.equal(await f.restore(), true); await f.flush();
    assert.equal(f.starts, 2); assert.equal(f.api.isRunning(), true);
    assert.equal(f.options.parameters.expiresAt, f.expiry); await f.api.stop();
  }],
  ['account change while native start is pending drains only the owned startup', async () => {
    const f = fixture(); f.deferStart(); const pending = f.restore(); await f.flush();
    f.changeAccount(); f.releaseStart(); assert.equal(await pending, false); assert.equal(f.api.isRunning(), false);
  }],
  ['OFF or SOS arriving during settings read vetoes native start', async () => {
    for (const action of ['off', 'sos', 'changeAccount']) {
      const f = fixture(); f.deferSettings(); const pending = f.restore(); await f.flush();
      f[action](); f.releaseSettings(); assert.equal(await pending, false); assert.equal(f.starts, 0);
    }
  }],
  ['expired voice authorization cannot be renewed by recovery', async () => {
    const f = fixture(); f.expire(); assert.equal(await f.restore(), false); assert.equal(f.starts, 0);
  }],
];
(async () => {
  let failed = 0;
  for (const [name, test] of cases) {
    try { await test(); console.log('PASS ' + name); }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
  }
  if (failed) process.exitCode = 1;
})();
