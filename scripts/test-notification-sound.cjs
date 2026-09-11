const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, console: { info() {}, warn() {} }, require: (name) => {
    assert.ok(modules[name], name); return modules[name];
  } });
  return exports;
}
async function main() {
  const payload = load('services/SOSNotificationPayload.ts', {});
  const policy = load('services/NotificationSoundPolicy.ts', { '@/services/SOSNotificationPayload': payload });
  const id = '00000000-0000-4000-8000-000000000001';
  for (const type of ['sos', 'sos_alert']) assert.equal(policy.requiresNotificationAttention({ type, sosId: id }), true);
  assert.equal(policy.requiresNotificationAttention({ type: 'safety_check' }), true);
  for (const type of ['sos_accepted', 'network_active', 'status_update']) {
    assert.equal(policy.requiresNotificationAttention({ type, sosId: id }), false);
  }
  assert.equal(policy.requiresNotificationAttention(null), false);
  assert.equal(policy.requiresNotificationAttention({ type: 'sos_alert', sosId: 'invalid' }), false);
  let channel = null;
  let creates = 0;
  let warnings = 0;
  const channels = load('services/OperationalNotificationChannels.ts', {
    'expo-constants': { default: { expoConfig: { android: { package: 'local.test' } } }, __esModule: true },
    'expo-notifications': {
      AndroidImportance: { DEFAULT: 5 }, AndroidNotificationVisibility: { PRIVATE: 2 },
      AndroidAudioUsage: { NOTIFICATION: 5 }, AndroidAudioContentType: { SONIFICATION: 4 },
      getNotificationChannelAsync: async () => channel,
      setNotificationChannelAsync: async (id, options) => { creates += 1; channel = { id, ...options }; },
    },
    'react-native': { Platform: { OS: 'android' }, Alert: { alert: () => { warnings += 1; } }, Linking: {} },
    '@/services/SafetyOperation': { withSafetyTimeout: async (p) => p },
  });
  await channels.ensureOperationalChannel('safety-checks', 'Safety', 6);
  assert.equal(channel.sound, 'default');
  assert.equal(channel.bypassDnd, false);
  assert.equal(channel.enableVibrate, true);
  assert.equal(channel.audioAttributes.usage, 5);
  await channels.ensureOperationalChannel('safety-checks', 'Safety', 6);
  assert.equal(creates, 1, 'no channel proliferation');
  channel.sound = null;
  channel.importance = 4;
  await channels.ensureOperationalChannel('safety-checks', 'Safety', 6);
  assert.equal(creates, 1, 'upgrade/manual mute must not recreate or replace the channel');
  assert.equal(channel.sound, null);
  assert.equal(channels.channelIsSilent(channel), true);
  channels.warnSilentOperationalChannel('safety-checks', channel);
  channels.warnSilentOperationalChannel('safety-checks', channel);
  assert.equal(warnings, 1);
  console.log('PASS operational classification, silent informational events, fresh channel, upgrade/mute preservation, warning dedup');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
