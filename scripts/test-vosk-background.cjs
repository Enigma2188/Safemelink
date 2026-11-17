'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let passed = 0;
const read = p => fs.readFileSync(p, 'utf8');
function load(file, deps, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: key => { assert.ok(key in deps, key); return deps[key]; }, console: { info() {} }, setTimeout, clearTimeout, ...extra });
  return exports;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const timers = new Map(); let timer = 0, checks = null, enabled = true, busy = false, opened = 0, stops = 0, events = [], journal = null;
  let settings = { enabled: false }, snapshot = { state: 'OFF', busy: false, reason: '', detections: 0 };
  const runtime = load('services/VoiceProtectionRuntime.ts', { '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: { save: async () => {} } } }).VoiceProtectionRuntime;
  const platform = { OS: 'android' }, app = { currentState: 'active' };
  const native = { enabled: () => enabled, busy: () => busy, snapshot: () => snapshot,
    start: () => { opened++; busy = true; snapshot = { ...snapshot, busy: true, state: 'PREPARING' }; },
    stop: forget => { stops++; if (forget) snapshot.detections = 0; }, reset: () => { snapshot.detections = 0; } };
  const api = load('services/VoiceLabCoordinator.ts', {
    'react-native': { Platform: platform, AppState: app }, 'expo-speech-recognition': { ExpoSpeechRecognitionModule: { getStateAsync: async () => 'inactive' } },
    '@/modules/safemelink-vosk-lab': { VoskLab: native }, '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: runtime },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { canOpenVoiceLab: () => true } },
    '@/storage/VoiceProtectionStorage': { VoiceProtectionStorage: { get: async () => checks ? checks.promise : settings } },
    '@/storage/SOSStorage': { SOSStorage: { listEvents: async () => events } }, '@/storage/VoiceSOSRecoveryStorage': { VoiceSOSRecoveryStorage: { get: async () => journal } },
  }, { setInterval: fn => { timers.set(++timer, fn); return timer; }, clearInterval: id => timers.delete(id) });
  return { api, runtime, app, native, start: (owner = 'A', current = () => true) => api.startVoiceLab(owner, 'frase solo test', current),
    setEnabled: x => { enabled = x; }, setSettings: x => { settings = x; }, setEvents: x => { events = x; }, setJournal: x => { journal = x; },
    defer: () => { checks = deferred(); return checks; }, get opened() { return opened; }, get stops() { return stops; },
    finish: () => { busy = false; snapshot = { ...snapshot, busy: false, state: 'OFF' }; for (const fn of [...timers.values()]) fn(); },
    listening: () => { snapshot = { ...snapshot, busy: true, state: 'LISTENING' }; }, get timers() { return timers.size; } };
}
const test = async (name, fn) => { await fn(); console.log('PASS '+name); passed++; };
(async () => {
  await test('OFF gate and real-protection settings never start the native lab', async () => {
    const f = fixture(); f.setEnabled(false); await assert.rejects(f.start()); assert.equal(f.opened, 0);
    f.setEnabled(true); f.setSettings({ enabled: true }); await assert.rejects(f.start()); assert.equal(f.opened, 0);
  });
  await test('local active SOS and uncertain journal fail closed without native start', async () => {
    for (const mode of ['event','journal']) { const f = fixture(); if (mode === 'event') f.setEvents([{ isActive: true }]); else f.setJournal({ phase: 'unknown' });
      await assert.rejects(f.start()); assert.equal(f.opened, 0); assert.equal(f.runtime.isMicrophoneReservedForLab(), false); }
  });
  await test('PREPARING is not LISTENING; background never owns capture through JS', async () => {
    const f = fixture(); await f.start(); assert.equal(f.api.readVoiceLab('A').state, 'PREPARING');
    f.listening(); f.app.currentState = 'background'; assert.equal(f.api.readVoiceLab('A').state, 'LISTENING');
    assert.equal(f.stops, 0); assert.equal(f.runtime.reserveMicrophoneForLab(), null); f.finish();
  });
  await test('stop during initialization prevents stale start; a later owner is not released by the old callback', async () => {
    const f = fixture(), pending = f.defer(), start = f.start(); f.api.stopVoiceLab(true);
    const later = f.runtime.reserveMicrophoneForLab(); assert.ok(later); pending.resolve({ enabled: false }); await assert.rejects(start);
    assert.equal(f.opened, 0); assert.equal(f.runtime.isMicrophoneReservedForLab(), true); f.runtime.releaseMicrophoneForLab(later);
  });
  await test('notification/native stop releases only after native busy ends; no auto-restart', async () => {
    const f = fixture(); await f.start(); f.api.stopVoiceLab(); assert.equal(f.runtime.isMicrophoneReservedForLab(), true);
    f.finish(); assert.equal(f.runtime.isMicrophoneReservedForLab(), false); assert.equal(f.timers, 0); assert.equal(f.opened, 1);
  });
  await test('account invalidation stops and clears counts; old account UI cannot read the new owner', async () => {
    const f = fixture(); await f.start(); f.runtime.invalidateVoiceLab(); assert.ok(f.stops); assert.equal(f.api.readVoiceLab('B').detections, 0); f.finish();
  });
  await test('SOS execution invalidates lab without creating a second emergency path', async () => {
    const f = fixture(); await f.start(); f.runtime.notifySOSExecutionStarted('A'); assert.ok(f.stops); f.finish();
  });
  await test('native start failure releases lease, never declares listening', async () => {
    const f = fixture(); f.native.start = () => { throw Error('controlled-start-error'); }; await assert.rejects(f.start());
    assert.equal(f.runtime.isMicrophoneReservedForLab(), false); assert.notEqual(f.api.readVoiceLab('A').state, 'LISTENING');
  });
  await test('native service/manifest isolate capture, bounded wake lock, permissions and final-only counts', async () => {
    const unknown = fixture(); await unknown.start(); const busy = unknown.native.busy;
    unknown.native.busy = () => { throw Error('controlled-state-error'); };
    unknown.native.snapshot = () => { throw Error('controlled-state-error'); };
    unknown.api.stopVoiceLab(); assert.equal(unknown.runtime.isMicrophoneReservedForLab(), true);
    assert.equal(unknown.api.readVoiceLab('A').state, 'ERROR');
    unknown.native.busy = busy; unknown.finish(); assert.equal(unknown.runtime.isMicrophoneReservedForLab(), false);
    const source = read('modules/safemelink-vosk-lab/android/src/enabled/java/com/tiziano/safemelink/vosklab/VoskLabService.java');
    assert.doesNotMatch(source, /getPartialResult|SmsManager|SOSService|https?:\/\/|Log\./);
    for (const value of ['START_NOT_STICKY','FOREGROUND_SERVICE_TYPE_MICROPHONE','FLAG_IMMUTABLE','session_limit','audio_silenced','capture = null','recorder.release()','recognizer.close()','model.close()','wakeLock.release()']) assert.ok(source.includes(value), value);
    assert.match(source, /LIMIT_MS = 30 \* 60 \* 1000L/); assert.match(source, /wakeLock.acquire\(LIMIT_MS \+ 60_000\)/);
    const screen = read('app/voice-lab.tsx'); assert.doesNotMatch(screen, /openVoiceLab|SOSService|sendSms/);
    assert.match(screen, /never the native recognition service/);
    const manifest = read('modules/safemelink-vosk-lab/android/src/enabled/AndroidManifest.xml');
    assert.match(manifest, /foregroundServiceType="microphone"/); assert.match(manifest, /exported="false"/); assert.doesNotMatch(manifest, /BOOT_COMPLETED/);
    const gradle = read('modules/safemelink-vosk-lab/android/build.gradle'); assert.match(gradle, /System.getenv\('SAFEMELINK_VOSK_LAB'\) == 'true'/);
    assert.match(read('.github/workflows/android-core-test-apk.yml'), /EXPO_PUBLIC_NETWORK_V2_ENABLED: "false"/);
    for (const file of ['.github/workflows/android-core-test-apk.yml','.github/workflows/android-test-apk.yml']) assert.doesNotMatch(read(file), /SAFEMELINK_VOSK_LAB:\s*"true"/);
    const experimental = read('.github/workflows/android-vosk-lab-apk.yml');
    assert.match(experimental, /on:\s*\r?\n  workflow_dispatch:/); assert.doesNotMatch(experimental, /^  (push|pull_request|schedule):/m);
    assert.match(experimental, /SAFEMELINK_VOSK_LAB: "true"/); assert.match(experimental, /EXPO_PUBLIC_NETWORK_V2_ENABLED: "false"/);
    assert.match(experimental, /python3 scripts\/prepare-vosk-lab-model.py modules\/safemelink-vosk-lab\/model-source\/vosk-model-small-it-0.22.zip/);
  });
  console.log(passed+' Vosk background controlled checks PASS. Native Android behavior NOT tested.');
})().catch(error => { console.error(error); process.exitCode = 1; });
