const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const read = (file) => fs.readFileSync(file, 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const home = ts.createSourceFile('home.tsx', read('app/(tabs)/index.tsx'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the actual Home entry functions: any access beyond the iOS gate
// fails because no runtime, storage or backend dependency is supplied.
async function testEntryGate(name, expected) {
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(home) === name) {
      initializer = node.initializer.getText(home);
    }
    ts.forEachChild(node, visit);
  };
  visit(home);
  assert.ok(initializer, name);
  const alerts = [];
  const exports = {};
  vm.runInNewContext(compile(`export const entry = ${initializer};`), {
    exports,
    Platform: { OS: 'ios' },
    Alert: { alert: (...args) => alerts.push(args) },
  });
  const result = name === 'startCheckpoint'
    ? await exports.entry(1, { enabled: false }) : await exports.entry();
  assert.equal(result, expected);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0][1], /fase successiva/);
}

async function main() {
  await testEntryGate('startCheckpoint', false);
  await testEntryGate('startGoHome', undefined);

  const requests = [];
  const cancelled = [];
  const notifications = {};
  const modules = {
    'expo-notifications': {
      AndroidImportance: { HIGH: 4 },
      SchedulableTriggerInputTypes: { DATE: 'date' },
      scheduleNotificationAsync: async (request) => { requests.push(request); return request.identifier; },
      cancelScheduledNotificationAsync: async (id) => { cancelled.push(id); },
    },
    'react-native': { Platform: { OS: 'ios' }, Alert: {}, Linking: {} },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: null },
    '@/services/SafetyOperation': {
      withSafetyTimeout: async (promise) => promise,
      reportSafetyError() {},
      SafetyOperationError: class extends Error {},
    },
    '@/services/OperationalNotificationChannels': {
      ensureOperationalChannel: async () => null,
      SAFETY_NOTIFICATION_CHANNEL_ID: 'safety-checks',
      warnSilentOperationalChannel() {},
    },
  };
  vm.runInNewContext(compile(read('services/SafetyNotifications.ts')), {
    exports: notifications, require: (name) => { assert.ok(modules[name], name); return modules[name]; },
    console: { info() {}, warn() {} }, Date,
  });
  for (const kind of ['checkpoint', 'go_home']) {
    const deadline = '2030-01-01T12:00:00.000Z';
    const before = requests.length;
    await notifications.SafetyNotifications.scheduleConfirmation('test-session', kind, deadline);
    assert.equal(requests.length - before, 1, 'one OS request per call, no T2 JS execution');
    const request = requests.at(-1);
    assert.equal(request.trigger.date, Date.parse(deadline));
    assert.equal(request.trigger.type, 'date');
    assert.equal(request.trigger.channelId, undefined);
    assert.equal(request.content.data.type, 'safety_check');
    await notifications.SafetyNotifications.scheduleConfirmation('test-session', kind, deadline);
    assert.equal(requests.at(-1).identifier, request.identifier, 'stable identifier, not proof of native dedup');
    await notifications.SafetyNotifications.cancelConfirmation('test-session');
    assert.equal(cancelled.at(-1), request.identifier);
  }

  const payload = {};
  vm.runInNewContext(compile(read('services/SOSNotificationPayload.ts')), { exports: payload });
  assert.equal(payload.parseSOSNotificationPayload({ type: 'safety_check' }), null,
    'known blocker: existing SOS parser does not route safety taps');

  const runtime = read('services/SafetyExpirationRuntime.ts');
  assert.match(runtime, /Date\.parse\(expiresAt\) \+ confirmationSeconds \* 1_000/);
  assert.match(runtime, /Platform\.OS === 'android' && kind !== 'manual_sos'/);
  assert.match(runtime, /nativeDeadlineGeneration \? \{ nativeDeadlineGeneration, operationId:/);
  const voice = read('services/VoiceProtectionService.ts');
  const monitoring = voice.slice(voice.indexOf('async ensureSafetyMonitoring'), voice.indexOf('async releaseSafetyMonitoring'));
  assert.match(monitoring, /if \(Platform\.OS !== 'android'\) return;/);
  assert.doesNotMatch(read('services/SOSLiveLocationBackgroundTask.ts'), /SafetyExpiration|processDue/);
  console.log('PASS Phase 6 boundary: disabled iOS entries, absolute notification date, stable ID/cancel, no Android trigger, safety tap gap documented.');
  console.log('NOT IMPLEMENTED: native iOS deadline execution, safety tap routing, server watchdog. These tests do not certify background escalation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
