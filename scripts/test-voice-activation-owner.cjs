const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

async function run(stage) {
  const source = fs.readFileSync('app/voice-protection.tsx', 'utf8');
  const start = source.indexOf('  const activateProtection = async () => {');
  const end = source.indexOf('  const deactivateProtection = async () => {', start);
  assert.ok(start >= 0 && end > start);
  const writes = [], stops = [], ui = [];
  let release, startCalls = 0;
  const owner = { current: 'A' };
  const settings = { enabled: false, durationMinutes: 60, passphrase: 'phrase-A', enabledAt: null, expiresAt: null };
  const context = {
    exports: {}, userId: 'A', settings, settingsRef: { current: settings }, activeUserIdRef: owner,
    activationInFlightRef: { current: false }, deactivationInFlightRef: { current: false },
    activationCancellationRef: { current: 0 }, refreshGenerationRef: { current: 0 },
    settingsRefreshPendingRef: { current: false }, VOICE_SETTINGS_SAVE_TIMEOUT_MS: 8000,
    Platform: { OS: 'android' }, normalizePassphrase: value => value.trim(), voiceReadinessMessage: () => '',
    Location: { hasServicesEnabledAsync: async () => true, requestForegroundPermissionsAsync: async () => ({ status: 'granted' }) },
    VoiceProtectionService: {
      getRecognitionReadiness: async () => 'ready',
      requestPermissions: () => stage === 'permission' ? new Promise(resolve => { release = () => resolve({ microphoneGranted: true, notificationsGranted: true }); }) : Promise.resolve({ microphoneGranted: true, notificationsGranted: true }),
      start: async (_user, _duration, current) => { startCalls++; assert.equal(current(), true); return { enabledAt: '2026-11-10T10:00:00Z', expiresAt: '2026-11-10T11:00:00Z' }; },
      isRunning: () => true, stop: async user => stops.push(user),
    },
    VoiceProtectionStorage: { save: async (user, value) => { writes.push({ user, value }); if (stage === 'storage' && value.enabled) await new Promise(resolve => { release = resolve; }); } },
    VoiceProtectionRuntime: { requestRecognitionStop() {}, waitForRecognitionStart: async () => true, allowRecognitionStart() { throw new Error('stale activation must not re-enable recognition'); }, getRecognitionState: () => 'listening', notifySettingsChanged() {} },
    runWithTimeout: promise => promise, refreshState: async () => {},
  };
  for (const name of ['setActivationFeedback', 'setMessage', 'setIsSaving', 'setItalianModelDownloadRequired', 'setMicrophoneState', 'setSettings']) {
    context[name] = value => { if (owner.current !== 'A') ui.push({ name, value }); };
  }
  vm.runInNewContext(ts.transpileModule(source.slice(start, end) + '\nexports.activate = activateProtection;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const pending = context.exports.activate();
  for (let i = 0; i < 80 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  owner.current = 'B'; context.settingsRef.current = { ...settings, passphrase: 'phrase-B' };
  release(); await pending;
  assert.equal(startCalls, stage === 'permission' ? 0 : 1);
  assert.ok(stops.every(user => user === 'A'), 'cleanup must be scoped to the captured account');
  assert.ok(writes.every(({ user, value }) => user === 'A' && value.passphrase === 'phrase-A'), 'never copy successor account settings into old account');
  assert.equal(writes.at(-1).value.enabled, false);
  assert.equal(ui.length, 0, 'stale activation cannot update successor account UI');
}
(async () => {
  await run('permission'); await run('storage');
  console.log('PASS actual activation handler: account switch during permissions/storage cannot enable stale voice, overwrite successor settings/UI or stop its service');
})().catch(error => { console.error(error); process.exitCode = 1; });
