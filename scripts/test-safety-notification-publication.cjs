const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Run the real channel helper and preflight with Android API boundaries mocked.
// Native Kotlin publication assertions below are STATIC, not device execution.
let channel = null, creates = 0, settings = 0, arms = 0;
const dependencies = {
  'expo-constants': { default: { expoConfig: { android: { package: 'com.tiziano.safemelink' } } } },
  'expo-notifications': { AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    AndroidNotificationVisibility: { PRIVATE: 0 }, AndroidAudioUsage: { NOTIFICATION: 5 },
    AndroidAudioContentType: { SONIFICATION: 4 },
    getNotificationChannelAsync: async () => channel,
    setNotificationChannelAsync: async (id, value) => { creates++; channel = { ...value, id }; },
    getPermissionsAsync: async () => ({ granted: true }),
  },
  'react-native': { Platform: { OS: 'android' }, Alert: { alert() {} },
    Linking: { sendIntent: async () => { settings++; }, openSettings: async () => { settings++; } } },
  '@/services/SafetyOperation': { withSafetyTimeout: value => value, reportSafetyError() {}, SafetyOperationError: class extends Error {} },
  '@/modules/safemelink-safety': { SafeMeLinkSafety: {
    canScheduleExactAlarms: () => true,
    armDeadlines: async () => { arms++; return true; },
  } },
};
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; },
    console: { info() {}, warn() {} } });
  return exports;
}
(async () => {
  const helper = load('services/OperationalNotificationChannels.ts');
  dependencies['@/services/OperationalNotificationChannels'] = helper;
  const api = load('services/SafetyNotifications.ts').SafetyNotifications;
  for (const kind of ['checkpoint', 'go_home']) {
    channel = { id: 'safety-checks', importance: 3, sound: 'default' };
    const existing = channel;
    assert.equal(await api.configure(), false);
    assert.equal(channel, existing); assert.equal(creates, 0);
    await assert.rejects(api.scheduleConfirmation('synthetic', kind, new Date().toISOString(), 'generation'));
    channel = { id: 'safety-checks', importance: 4, sound: null };
    assert.equal(await api.configure(), false);
    await assert.rejects(api.scheduleConfirmation('synthetic', kind, new Date().toISOString(), 'generation'));
  }
  assert.equal(arms, 0); assert.equal(settings, 4);
  console.log('PASS existing channel is preserved after update; both modes require explicit settings correction before arming');
  channel = null;
  assert.equal(await api.configure(), true);
  assert.equal(creates, 1); assert.equal(channel.id, 'safety-checks');
  assert.equal(channel.importance, 4); assert.equal(channel.sound, 'default');
  for (const kind of ['checkpoint', 'go_home']) {
    await api.scheduleConfirmation('synthetic', kind, new Date().toISOString(), 'generation');
  }
  assert.equal(arms, 2);
  console.log('PASS new channel uses HIGH and sound; both modes use the same native arming path');

  const native = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineStore.kt', 'utf8');
  const show = native.slice(native.indexOf('fun show('));
  const preflight = native.slice(native.indexOf('private fun checkNotificationPrerequisites'), native.indexOf('fun notification('));
  const publish = native.slice(native.indexOf('@Synchronized fun publishConfirmation'), native.indexOf('@Synchronized fun checkpointNoticeFailure'));
  assert.match(show, /requireAudible = false/);
  assert.match(show, /manager.notify\(NOTICE_ID, notice\)/);
  assert.match(preflight, /requireAudible: Boolean = true/);
  assert.match(preflight, /if \(requireAudible && !audible\)/);
  assert.match(preflight, /channel.importance == NotificationManager.IMPORTANCE_NONE/);
  assert.match(preflight, /manager.areNotificationsEnabled\(\)/);
  assert.match(show, /FIRST_NOTICE_DEGRADED/); assert.match(show, /FIRST_NOTICE_POSTED/);
  assert.match(publish, /notification_channel_degraded/);
  assert.match(publish, /current.optString\("kind"\) == "go_home"/);
  assert.doesNotMatch(publish, /\.put\("(?:state|armed|claimed|t1|t2)"|cancelAlarms|setAlarmClock|completeSOS/);
  assert.ok(publish.indexOf('show(context, current)') < publish.indexOf('current.put("firstFired", true)'));
  assert.match(publish, /FIRST_NOTICE_REJECTED/);
  const receiver = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineReceiver.kt', 'utf8');
  assert.match(receiver, /if \(stage == 1\) SafetyDeadlineStore.publishConfirmation/);
  console.log('PASS STATIC Kotlin: strict pre-arm gate; degraded active channel does not veto notify; blocked channel/permission fail; T2 untouched');
  const ui = fs.readFileSync('components/CheckpointNotificationWarning.tsx', 'utf8');
  assert.match(ui, /notification_channel_degraded/); assert.match(ui, /TORNO A CASA/);
  assert.match(ui, /non garantisce suono o rilievo/); assert.match(ui, /NON MODIFICA IL TIMER/);
  console.log('PASS STATIC warning distinguishes degraded publication from rejection for both modes');
})().catch(error => { console.error(error); process.exitCode = 1; });
