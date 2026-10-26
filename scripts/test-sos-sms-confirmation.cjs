const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync('services/SOSAutomaticSmsService.ts', 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(outcome, reason = 'send_failed') {
  const markers = new Set(), states = [], calls = [];
  let permission = true, account = 'synthetic-owner';
  const modules = {
    'react-native': { Platform: { OS: 'android' }, PermissionsAndroid: { PERMISSIONS: { SEND_SMS: 'sms' }, check: async () => permission } },
    'safemelink-sms': { SafeMeLinkSms: { sendSosSmsWithResult: async () => {
      calls.push('synthetic-request');
      if (outcome === 'throw') throw new Error('controlled-native-error');
      if (outcome === 'malformed') return undefined;
      return { attemptId: '11111111-1111-4111-8111-111111111111', status: outcome, reason,
        requested: !['sim_absent', 'sim_not_ready', 'default_sim_missing'].includes(reason), delivery: 'not_verified' };
    } } },
    '@/services/PhoneIdentity': { getPhoneIdentityKey: p => p },
    '@/services/SOSSessionTimeout': { getSOSSessionWithTimeout: async () => ({ user: { id: account } }) },
    '@/storage/SOSAutomaticSmsStorage': { SOSAutomaticSmsStorage: {
      hasConsent: async () => true, getAttemptedRecipients: async () => markers,
      markAttempted: async (_u, _e, p) => { if (markers.has(p)) return false; markers.add(p); return true; },
      markResult: async (_u, _e, _p, result) => states.push(result),
    } },
  };
  const exports = {};
  vm.runInNewContext(compile(source), { exports, require: id => { assert.ok(modules[id], id); return modules[id]; }, console: { info() {} } });
  return { calls, states, deny() { permission = false; }, switchAccount() { account = 'other'; },
    send: () => exports.SOSAutomaticSmsService.sendForSOS('synthetic-owner', { id: 'synthetic-event', location: null },
      [{ priority: 1, phone: '+100000001' }]) };
}
(async () => {
  const feedback = {};
  vm.runInNewContext(compile(fs.readFileSync('services/SOSAutomaticSmsFeedback.ts', 'utf8')), { exports: feedback });
  for (const [native, expected, state] of [['sent', 'sent', 'sent_confirmed'], ['failed', 'failed', 'failed'],
    ['unknown', 'uncertain', 'unknown'], ['throw', 'uncertain', 'unknown'], ['malformed', 'uncertain', 'unknown']]) {
    const f = fixture(native); const result = await f.send();
    assert.equal(result.status, expected); assert.equal(f.states[0], state);
    if (expected === 'uncertain') { assert.equal(result.sentCount, 0); assert.match(feedback.automaticSmsFeedback(result), /incerto/); }
    if (expected === 'sent') assert.match(feedback.automaticSmsFeedback(result), /consegna ai destinatari non è verificata/);
    await f.send(); assert.equal(f.calls.length, 1, 'no automatic retry after any outcome');
  }
  for (const reason of ['sim_absent', 'sim_not_ready', 'default_sim_missing']) {
    const f = fixture('failed', reason); const result = await f.send();
    assert.equal(result.requestedCount, 0); assert.equal(result.failedCount, 1);
    assert.ok(feedback.automaticSmsFeedback(result).includes('SIM'));
  }
  const denied = fixture('sent'); denied.deny(); assert.equal((await denied.send()).status, 'permission_required'); assert.equal(denied.calls.length, 0);
  const other = fixture('sent'); other.switchAccount(); await other.send(); assert.equal(other.calls.length, 0);
  const kotlin = fs.readFileSync('modules/safemelink-sms/android/src/main/java/com/tiziano/safemelink/sms/SosSmsSender.kt', 'utf8');
  assert.match(kotlin, /RECEIVER_NOT_EXPORTED/); assert.match(kotlin, /UUID.randomUUID/);
  assert.match(kotlin, /settled.compareAndSet\(false, true\)/);
  assert.match(kotlin, /unregisterReceiver/); assert.match(kotlin, /intents.forEach/);
  assert.match(kotlin, /intent\?\.action != action/);
  assert.match(kotlin, /getDefaultSmsSubscriptionId/); assert.match(kotlin, /getSlotIndex/);
  assert.doesNotMatch(kotlin, /READ_PHONE_STATE|READ_SMS|Log\.|println\(|phoneNumber|delivery_confirmed/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'safemelink-sms-test-'));
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const java = spawnSync('javac', ['-d', temp,
      'modules/safemelink-sms/android/src/main/java/com/tiziano/safemelink/sms/SmsSentAccumulator.java',
      'scripts/fixtures/SmsSentAccumulatorTest.java'], { encoding: 'utf8' });
    assert.equal(java.status, 0, java.error?.message || java.stderr);
    const run = spawnSync('java', ['-cp', temp, 'SmsSentAccumulatorTest'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr); process.stdout.write(run.stdout);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  console.log('PASS real SMS JS service with controlled native adapter: sent/failed/unknown, SIM feedback, denied permission, account isolation and no retries');
  console.log('PASS Kotlin callback wiring static checks. Android compilation, modem callbacks and real SMS NOT executed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
