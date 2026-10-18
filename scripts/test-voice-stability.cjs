const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture } = require('./test-voice-lifecycle.cjs');
const final = (text, generation) => ({
  isFinal: true, results: [{ transcript: text }],
  ...(generation === undefined ? {} : { safemelinkGeneration: generation }),
});
async function boot() {
  const f = fixture();
  await f.advance(250); f.enable(); await f.advance(300);
  assert.equal(f.status, 'listening');
  return f;
}
async function saveAfterUnmount({ enabled = false, stopConfirmed = true } = {}) {
  // Execute the actual screen save handler with controlled storage completion.
  const screen = fs.readFileSync('app/voice-protection.tsx', 'utf8');
  const start = screen.indexOf('  const savePassphrase = async () => {');
  const end = screen.indexOf('  const activateProtection = async () => {', start);
  assert.ok(start >= 0 && end > start);
  const source = screen.slice(start, end) + '\nexports.save = savePassphrase;';
  let settle;
  let stored = { enabled, passphrase: 'old phrase' };
  let notices = 0;
  const active = { current: true };
  const context = {
    exports: {}, userId: 'account-A', passphraseDraft: 'new phrase',
    saveInFlightRef: { current: false }, refreshGenerationRef: { current: 0 },
    screenGenerationRef: { current: 1 }, screenActiveRef: active,
    settingsRef: { current: stored }, VOICE_SETTINGS_SAVE_TIMEOUT_MS: 5000,
    Platform: { OS: 'android' }, stopVoiceRecognition: async () => stopConfirmed,
    normalizePassphrase: value => value.trim().toLowerCase(),
    runWithTimeout: promise => promise,
    VoiceProtectionStorage: {
      save: (_user, value) => new Promise(resolve => { settle = () => { stored = value; resolve(); }; }),
      get: async () => stored,
    },
    VoiceProtectionRuntime: { requestRecognitionStop() {}, notifySettingsChanged: () => { notices++; } },
    Date, console: { info() {}, error() {} },
  };
  for (const name of ['setIsSaving','setMessage','setPassphraseSaveFeedback','setSettings','setPassphraseDraft']) context[name] = () => {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, context);
  const pending = context.exports.save();
  // Native teardown now precedes persistence; the UI cannot save while ON.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  if (enabled || !stopConfirmed) {
    await pending;
    assert.equal(settle, undefined, 'unsafe passphrase changes never reach storage');
    assert.equal(stored.passphrase, 'old phrase'); assert.equal(notices, 0);
    return;
  }
  assert.equal(typeof settle, 'function', 'storage begins only after confirmed native stop');
  active.current = false;
  settle();
  await pending;
  assert.equal(stored.passphrase, 'new phrase');
  assert.equal(notices, 1, 'persisted change must notify lifecycle even after screen unmount');
}
const cases = [
  ['native session patch is guarded, private, idempotent and fail-closed', async () => {
    const { patchLocalRecognizer } = require('../plugins/withLocalSpeechRecognition.cjs');
    const path = require('node:path');
    const root = path.dirname(require.resolve('expo-speech-recognition/package.json'));
    const source = fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/speechrecognition/ExpoSpeechService.kt'), 'utf8');
    const patched = patchLocalRecognizer(source);
    assert.equal(patchLocalRecognizer(patched), patched);
    assert.equal((patched.match(/if \(listenerEpoch.get\(\) == epoch\) this@ExpoSpeechService\./g) || []).length, 12);
    assert.ok(patched.includes('if (listenerEpoch.get() != epoch) return@post'));
    assert.ok(patched.includes('if (listenerEpoch.get() != endingEpoch) return@post'));
    assert.ok(patched.includes('endingEmitter("end", null)'));
    assert.ok(patched.includes('filterKeys { it != "safemelinkGeneration" }'));
    assert.ok(patched.includes('mapOf("safemelinkGeneration" to eventGeneration)'));
    assert.throws(() => patchLocalRecognizer(source.replace('speech?.setRecognitionListener(this)', 'changedAPI()')));
    assert.equal(fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/speechrecognition/ExpoSpeechService.kt'), 'utf8'), source);
  }],
  ['second voice SOS after real close inside old cooldown', async () => {
    const f = await boot();
    try {
      f.events.result(final('test phrase')); assert.equal(f.requests, 1);
      await f.advance(10000); assert.equal(f.runtime.claimDueSOS('account-A'), true);
      f.runtime.notifySOSExecutionStarted('account-A'); await f.advance(300);
      f.runtime.notifySOSCompleted('account-A', {event:{id:'test-sos',remoteSosId:'remote-test'}}, f.runtime.getSOSAttempt('account-A').attemptId);
      f.runtime.finishSOSExecution();
      await f.advance(1700); assert.equal(f.starts, 1, 'completion is NOT real close');
      f.runtime.notifySOSClosed('account-A','test-sos'); f.runtime.notifySOSClosed('account-A','test-sos');
      await f.advance(2000); assert.equal(f.starts, 2, 'close resumes exactly once');
      f.events.result(final('test phrase')); f.events.result(final('test phrase'));
      assert.equal(f.requests, 2, 'new emergency allowed after real close; duplicate result ignored');
    } finally { f.unmount(); await f.advance(300); }
  }],
  ['stale results/start/error/end cannot affect replacement session', async () => {
    const f = await boot();
    try {
      const old = f.generation;
      f.changePassphrase('new phrase'); await f.advance(300);
      assert.equal(f.status, 'listening');
      f.events.result(final('new phrase', old));
      assert.equal(f.requests, 0, 'old callback cannot trigger new SOS');
      f.events.start({ safemelinkGeneration: old });
      f.events.error({ error: 'network', safemelinkGeneration: old });
      f.events.end({ safemelinkGeneration: old });
      assert.equal(f.status, 'listening', 'old error/end cannot stop the new recognizer');
      f.events.result(final('test phrase')); assert.equal(f.requests, 0, 'old passphrase no longer valid');
      f.events.result(final('new phrase')); f.events.result(final('new phrase'));
      assert.equal(f.requests, 1, 'new passphrase recognized once');
    } finally { f.unmount(); await f.advance(300); }
  }],
  ['persisted passphrase change after screen unmount', () => saveAfterUnmount()],
  ['passphrase cannot change while mode remains enabled', () => saveAfterUnmount({ enabled: true })],
  ['passphrase cannot change before native stop confirmation', () => saveAfterUnmount({ stopConfirmed: false })],
  ['OFF during recovery prevents late callbacks and timers', async () => {
    const f = await boot();
    try {
      f.runtime.notifySOSExecutionStarted('account-A'); await f.advance(300);
      f.runtime.notifySOSClosed('account-A'); f.disable();
      f.events.start(); f.events.result(final('test phrase')); f.events.error({ error: 'network' });
      await f.advance(40000);
      assert.equal(f.status, 'off'); assert.equal(f.starts, 1); assert.equal(f.requests, 0);
    } finally { f.unmount(); await f.advance(300); }
  }],
];
(async () => {
  let failures = 0;
  for (const [name, test] of cases) {
    try { await test(); console.log('PASS ' + name); }
    catch (error) { failures++; console.log('FAIL ' + name + ': ' + error.message.split('\n')[0]); }
  }
  if (failures) process.exitCode = 1;
})().catch(() => { process.exitCode = 1; });
