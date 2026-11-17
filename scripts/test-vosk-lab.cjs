const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = p => ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const load = (p, deps, extra = {}) => {
  const exports = {};
  vm.runInNewContext(compile(p), { exports, require: n => { assert.ok(n in deps, n); return deps[n]; }, console, setTimeout, clearTimeout, ...extra });
  return exports;
};
async function run() {
  const runtime = load('services/VoiceProtectionRuntime.ts', {
    '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: { save: async () => {} } },
  }).VoiceProtectionRuntime;
  const lease = runtime.reserveMicrophoneForLab(); assert.ok(lease);
  assert.equal(runtime.reserveMicrophoneForLab(), null);
  runtime.releaseMicrophoneForLab(Symbol('other')); assert.equal(runtime.isMicrophoneReservedForLab(), true);
  runtime.releaseMicrophoneForLab(lease); assert.equal(runtime.isMicrophoneReservedForLab(), false);
  runtime.setRecognitionState('A', 'listening'); assert.equal(runtime.reserveMicrophoneForLab(), null);
  runtime.setRecognitionState('A', 'off');
  let enabled = true, nativeBusy = false, coreFree = true, settingsEnabled = false, state = 'inactive', opened = 0, poll;
  const api = load('services/VoiceLabCoordinator.ts', {
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: { getStateAsync: async () => state } },
    '@/modules/safemelink-vosk-lab': { VoskLab: { enabled: () => enabled, busy: () => nativeBusy, start: () => { opened++; nativeBusy = true; }, stop: () => { nativeBusy = false; } } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: runtime },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { canOpenVoiceLab: () => coreFree } },
    '@/storage/VoiceProtectionStorage': { VoiceProtectionStorage: { get: async () => ({ enabled: settingsEnabled }) } },
    '@/storage/SOSStorage': { SOSStorage: { listEvents: async () => [] } },
    '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: { get: async () => null } },
  }, { setInterval: cb => { poll = cb; return 1; }, clearInterval: () => {} });
  enabled = false; await assert.rejects(api.startVoiceLab('A', 'prova', () => true)); assert.equal(opened, 0);
  enabled = true; settingsEnabled = true; await assert.rejects(api.startVoiceLab('A', 'prova', () => true));
  assert.equal(runtime.isMicrophoneReservedForLab(), false);
  settingsEnabled = false; state = 'recognizing'; await assert.rejects(api.startVoiceLab('A', 'prova', () => true));
  state = 'inactive'; coreFree = false; await assert.rejects(api.startVoiceLab('A', 'prova', () => true));
  coreFree = true; await assert.rejects(api.startVoiceLab('A', 'prova', () => false));
  await api.startVoiceLab('A', 'prova', () => true); assert.equal(opened, 1); assert.equal(runtime.isMicrophoneReservedForLab(), true);
  poll(); assert.equal(runtime.isMicrophoneReservedForLab(), true);
  nativeBusy = false; poll(); assert.equal(runtime.isMicrophoneReservedForLab(), false);
  const service = fs.readFileSync('services/VoiceProtectionService.ts', 'utf8');
  const lifecycle = fs.readFileSync('components/VoiceProtectionLifecycle.tsx', 'utf8');
  assert.match(service, /voiceRequested && VoiceProtectionRuntime.isMicrophoneReservedForLab/);
  assert.ok(lifecycle.lastIndexOf('isMicrophoneReservedForLab') < lifecycle.indexOf('ExpoSpeechRecognitionModule.start('));
  const java = fs.readFileSync('modules/safemelink-vosk-lab/android/src/enabled/java/com/tiziano/safemelink/vosklab/VoskLabService.java', 'utf8');
  assert.doesNotMatch(java, /SmsManager|SOSService|sendTextMessage|https?:\/\/|Log\./);
  assert.doesNotMatch(java, /onPause\(/);
  assert.match(java, /START_NOT_STICKY/);
  assert.match(java, /FOREGROUND_SERVICE_TYPE_MICROPHONE/);
  assert.match(fs.readFileSync('modules/safemelink-vosk-lab/android/src/enabled/AndroidManifest.xml', 'utf8'), /exported="false"/);
  const gradle = fs.readFileSync('modules/safemelink-vosk-lab/android/build.gradle', 'utf8');
  assert.match(gradle, /System.getenv\('SAFEMELINK_VOSK_LAB'\) == 'true'/);
  console.log('PASS lab gate, microphone reservation, stale release, active protection/core refusal, native lifecycle and no-emergency source checks');
  console.log('Native Android compilation, microphone and on-device recognition NOT verified by this test.');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
