const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const calls = [];
  const state = { granted: false, canAskAgain: true, channel: null, gps: false, exact: false, fail: false, readiness: 'model_status_unknown' };
  const permission = async () => {
    if (state.fail) throw new Error('unavailable');
    return { granted: state.granted, canAskAgain: state.canAskAgain };
  };
  const record = name => async () => { calls.push(name); };
  const native = { canScheduleExactAlarms: () => state.exact, openExactAlarmSettings: record('exact-settings') };
  const platform = { OS: 'android', Version: 35 };
  const dependencies = {
    'expo-location': {
      getForegroundPermissionsAsync: permission, getBackgroundPermissionsAsync: permission,
      requestForegroundPermissionsAsync: record('location-dialog'), requestBackgroundPermissionsAsync: record('background-dialog'),
      hasServicesEnabledAsync: async () => state.gps,
    },
    'expo-notifications': {
      getPermissionsAsync: permission, requestPermissionsAsync: record('notification-dialog'),
      getNotificationChannelAsync: async () => state.channel, AndroidImportance: { HIGH: 4 },
    },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: {
      getMicrophonePermissionsAsync: permission, requestMicrophonePermissionsAsync: record('microphone-dialog'),
    } },
    'react-native': { Platform: platform, Linking: { openSettings: record('app-settings'), sendIntent: record('location-settings') } },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: native },
    '@/services/OperationalNotificationChannels': {
      SAFETY_NOTIFICATION_CHANNEL_ID: 'safety-checks', ensureOperationalChannel: record('ensure-channel'),
      openOperationalChannelSettings: record('channel-settings'),
    },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { openBatterySettings: record('battery-settings') } },
    '@/services/VoiceRecognitionCapabilities': { getVoiceRecognitionReadiness: async () => state.readiness, voiceReadinessMessage: () => '' },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('services/SecuritySetup.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(dependencies[name], `Unexpected dependency: ${name}`); return dependencies[name]; } });
  return { api: exports, state, calls, native, dependencies, platform };
}

(async () => {
  const f = fixture();
  let result = await f.api.readSecuritySetup();
  for (const id of ['notifications', 'channel', 'location', 'background', 'microphone', 'alarms', 'gps']) assert.equal(result[id], 'missing', id);
  assert.deepEqual(f.calls, [], 'first inspection must never request anything');
  f.state.granted = true; f.state.gps = true; f.state.exact = true; f.state.channel = { importance: 4, sound: 'default' };
  result = await f.api.readSecuritySetup();
  for (const id of ['notifications', 'channel', 'location', 'background', 'microphone', 'alarms', 'gps']) assert.equal(result[id], 'ready', id);
  assert.equal(result.visibility, 'unknown'); assert.equal(result.battery, 'unknown');
  assert.equal(result.recognizer, 'unknown'); assert.equal(result.microphonePrivacy, 'unknown');
  for (const readiness of ['android_version_unsupported', 'recognition_unavailable', 'on_device_unavailable', 'italian_model_missing']) {
    f.state.readiness = readiness; assert.equal((await f.api.readSecuritySetup()).recognizer, 'missing');
  }
  f.state.readiness = 'ready'; assert.equal((await f.api.readSecuritySetup()).recognizer, 'ready');
  assert.deepEqual(f.calls, [], 'already configured inspection remains read-only');
  f.state.granted = false;
  assert.equal((await f.api.readSecuritySetup()).notifications, 'missing', 'revocation detected by fresh inspection');
  await f.api.configureSecurityRequirement('microphone');
  assert.deepEqual(f.calls.splice(0), ['microphone-dialog'], 'microphone tap cannot request notifications or start listening');
  f.state.canAskAgain = false;
  await f.api.configureSecurityRequirement('location');
  assert.deepEqual(f.calls.splice(0), ['app-settings']);
  await assert.rejects(f.api.configureSecurityRequirement('background'), /Prima configura/);
  assert.deepEqual(f.calls, [], 'background must not automatically request foreground');
  f.state.granted = true;
  await f.api.configureSecurityRequirement('location');
  assert.deepEqual(f.calls, []);
  f.state.granted = false; f.state.canAskAgain = true;
  await f.api.configureSecurityRequirement('notifications');
  assert.deepEqual(f.calls.splice(0), ['ensure-channel', 'notification-dialog']);
  await f.api.configureSecurityRequirement('alarms');
  assert.deepEqual(f.calls.splice(0), ['exact-settings']);
  f.state.fail = true;
  assert.equal((await f.api.readSecuritySetup()).notifications, 'unknown', 'read errors must never produce OK');
  f.dependencies['@/modules/safemelink-safety'].SafeMeLinkSafety = null;
  assert.equal((await f.api.readSecuritySetup()).alarms, 'unknown');
  await assert.rejects(f.api.configureSecurityRequirement('alarms'));
  f.platform.OS = 'ios';
  await f.api.configureSecurityRequirement('microphone');
  assert.deepEqual(f.calls, [], 'no iOS configuration actions');
  const ui = fs.readFileSync('app/security-setup.tsx', 'utf8');
  assert.match(ui, /AppState.addEventListener/);
  assert.match(ui, /current === revision.current/);
  assert.match(ui, /subscription.remove\(\)/);
  const invitation = fs.readFileSync('components/SecuritySetupInvitation.tsx', 'utf8');
  assert.match(invitation, /AsyncStorage.getItem\(KEY\)/);
  assert.match(invitation, /setVisible\(!configured\)/);
  assert.match(invitation, /if \(!visible \|\| !home \|\| Platform.OS !== 'android'\) return null/);
  for (const source of [ui, invitation, fs.readFileSync('services/SecuritySetup.ts', 'utf8')]) {
    assert.doesNotMatch(source, /completeSOS|armDeadlines|prepareDeadlines|startListening|requestAuthorization|scheduleNotificationAsync/);
  }
  console.log('PASS: real setup service with controlled permission APIs — install/configured/revoked/denied/unknown/contextual requests/native unavailable/iOS isolation');
  console.log('PASS: static UI foreground refresh, stale-read guard, invitation suppression and no emergency invocation');
  console.log('NOT TESTED: actual Android dialogs, OEM settings and rendered UI on device');
})().catch(error => { console.error(error); process.exitCode = 1; });
