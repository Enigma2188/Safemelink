const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let granted = true, canAskAgain = true, exact = true, sound = 'default', importance = 4;
let requests = 0, settings = 0, alarms = 0;
let grantOnRequest = true;
const exportsObject = {};
const dependencies = {
  'expo-notifications': { AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: async () => ({ granted, canAskAgain }),
    requestPermissionsAsync: async () => { requests++; granted = grantOnRequest; } },
  'react-native': { Platform: { OS: 'android' }, Linking: { openSettings: async () => { settings++; } } },
  '@/services/SafetyOperation': { withSafetyTimeout: p => p, reportSafetyError() {}, SafetyOperationError: class extends Error {} },
  '@/modules/safemelink-safety': { SafeMeLinkSafety: {
    canScheduleExactAlarms: () => exact, openExactAlarmSettings: async () => { settings++; },
    armDeadlines: async () => { alarms++; return true; } } },
  '@/services/OperationalNotificationChannels': { SAFETY_NOTIFICATION_CHANNEL_ID: 'safety-checks',
    ensureOperationalChannel: async () => ({ sound, importance }),
    openOperationalChannelSettings: async () => { settings++; } },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/SafetyNotifications.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, require: n => { assert.ok(dependencies[n], n); return dependencies[n]; }, console });
(async () => {
  const api = exportsObject.SafetyNotifications;
  assert.equal(await api.configure(), true);
  granted = false;
  assert.equal(await api.configure(), true); assert.equal(requests, 1);
  granted = false; grantOnRequest = false;
  assert.equal(await api.configure(), false); assert.equal(requests, 2);
  granted = false; canAskAgain = false;
  assert.equal(await api.configure(), false); assert.equal(settings, 1);
  granted = true; exact = false;
  await assert.rejects(api.configure()); assert.equal(settings, 2);
  assert.equal(await api.configure(false), false); assert.equal(settings, 2);
  exact = true;
  assert.equal(await api.configure(false), true);
  sound = null;
  assert.equal(await api.configure(), false); assert.equal(settings, 3);
  sound = 'default'; importance = 2;
  assert.equal(await api.configure(), false);
  assert.equal(alarms, 0, 'Permission flows and resume checks never arm alarms');
  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  assert.match(home, /if \(!notificationsReady\) \{[\s\S]*?return false;/);
  assert.match(home, /if \(!notificationsReady\) \{[\s\S]*?Torno a casa non avviato[\s\S]*?return;/);
  console.log('PASS safety preflight: permissions, permanent denial, channel mute, exact alarm, resume without auto-arm');
})().catch(error => { console.error(error); process.exitCode = 1; });
