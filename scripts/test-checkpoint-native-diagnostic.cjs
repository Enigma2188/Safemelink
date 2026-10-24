const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function serviceFixture(flag, os = 'android', outcome = 'requested') {
  let reads = 0, nativeCalls = 0;
  const dependencies = {
    'expo-notifications': { getPermissionsAsync: async () => { reads++; return { granted: false, canAskAgain: false }; } },
    'react-native': { Platform: { OS: os } },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: { testCheckpointNotification: async () => {
      nativeCalls++;
      return { notificationsEnabled: false, channelExists: true, channelExistedBefore: true,
        importance: 0, sound: 'none', notifyAttempted: outcome !== 'not_requested', notifyOutcome: outcome,
        errorCategory: outcome === 'requested' ? null : 'SecurityException', errorCode: outcome === 'requested' ? null : 'notifications_disabled' };
    } } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/CheckpointNotificationDiagnostic.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; },
    process: { env: { EXPO_PUBLIC_CHECKPOINT_DIAGNOSTICS: flag } } });
  return { api: exports, get reads() { return reads; }, get calls() { return nativeCalls; } };
}

(async () => {
  for (const [flag, os] of [[undefined, 'android'], ['false', 'android'], ['true', 'ios']]) {
    const f = serviceFixture(flag, os);
    assert.equal(f.api.checkpointDiagnosticsEnabled(), false);
    await assert.rejects(f.api.runCheckpointNotificationDiagnostic());
    assert.equal(f.reads, 0); assert.equal(f.calls, 0);
  }
  console.log('PASS default OFF / production / iOS cannot invoke the diagnostic');
  for (const outcome of ['requested', 'rejected', 'not_requested']) {
    const f = serviceFixture('true', 'android', outcome);
    const result = await f.api.runCheckpointNotificationDiagnostic();
    assert.equal(f.reads, 1); assert.equal(f.calls, 1);
    assert.equal(result.permissionGranted, false); assert.equal(result.native.notifyOutcome, outcome);
    assert.equal(result.native.importance, 0); assert.equal(result.native.sound, 'none');
  }
  console.log('PASS diagnostic reads permission and reports native requested/rejected/not-called without prompting');

  const native = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineStore.kt', 'utf8');
  const show = native.slice(native.indexOf('fun show('), native.indexOf('private fun requestNotification'));
  const diagnostic = native.slice(native.indexOf('fun testCheckpointNotification'));
  for (const source of [show, diagnostic]) {
    assert.match(source, /notification\(context,/);
    assert.match(source, /checkNotificationPrerequisites\(context,/);
    assert.match(source, /requireAudible = false/);
    assert.match(source, /requestNotification\(context,/);
  }
  assert.match(diagnostic, /val channelId = "safety-checks"/);
  assert.match(diagnostic, /requestNotification\(context, 4199, notice\)/);
  assert.match(show, /requestNotification\(context, NOTICE_ID, notice\)/);
  assert.match(native, /const val NOTICE_ID = 4100/);
  assert.match(native, /NotificationManager\)\.notify\(id, notice\)/);
  // These checks cover the diagnostic call graph, not Android OS execution.
  assert.doesNotMatch(diagnostic, /\b(?:prepare|arm|claim|fired|write|read|cancel|restore|publishConfirmation)\s*\(|AlarmManager|setAlarmClock|SharedPreferences|completeSOS|sendEvent|\.sound\.toString/);
  assert.ok(diagnostic.indexOf('requestNotification(context, 4199, notice)') < diagnostic.indexOf('result["notifyOutcome"] = "requested"'));
  const builder = native.slice(native.indexOf('fun notification('), native.indexOf('fun show('));
  assert.doesNotMatch(builder, /AlarmManager|SafetyEscalationService|Receiver|putExtra|completeSOS/);
  assert.match(builder, /if \(Build.VERSION.SDK_INT < 26 && !silent\) builder.setPriority\(Notification.PRIORITY_HIGH\)\s*\.setDefaults\(Notification.DEFAULT_SOUND or Notification.DEFAULT_VIBRATE\)/);
  assert.doesNotMatch(builder, /setFullScreenIntent|setBypassDnd|IMPORTANCE_MAX/);
  console.log('PASS STATIC Android 7/7.1 audible alert has HIGH priority; silent service and Android 8+ channel policy unchanged');
  const receiver = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineReceiver.kt', 'utf8');
  assert.doesNotMatch(receiver, /testCheckpointNotification/);
  console.log('PASS STATIC native path shares T1 builder/check/notify, uses a separate ID and never touches deadlines or SOS');

  const ui = fs.readFileSync('components/CheckpointNotificationDiagnostic.tsx', 'utf8');
  assert.match(ui, /if \(!checkpointDiagnosticsEnabled\(\)\) return null/);
  assert.match(ui, /if \(inFlight.current\) return/);
  assert.match(ui, /NON confermata/); assert.match(ui, /HO VISTO LA NOTIFICA DI TEST/);
  assert.match(ui, /PUBBLICAZIONE RICHIESTA/);
  assert.doesNotMatch(ui, /SafetyExpiration|SOSService|LocationService|supabase|setInterval/);
  const service = fs.readFileSync('services/CheckpointNotificationDiagnostic.ts', 'utf8');
  assert.doesNotMatch(service, /scheduleNotificationAsync|requestPermissionsAsync|SOSService|LocationService|supabase/);
  console.log('PASS STATIC UI guards double taps and requires manual confirmation of visibility; no GPS/backend/scheduling APIs');

  const workflow = fs.readFileSync('.github/workflows/android-test-apk.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /EXPO_PUBLIC_CHECKPOINT_DIAGNOSTICS: "true"/);
  assert.doesNotMatch(fs.readFileSync('eas.json', 'utf8'), /EXPO_PUBLIC_CHECKPOINT_DIAGNOSTICS/);
  console.log('PASS diagnostic flag enabled only in the manual test APK workflow, not EAS production profiles');
})().catch(error => { console.error(error); process.exitCode = 1; });
