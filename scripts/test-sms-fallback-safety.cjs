const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = p => fs.readFileSync(p, 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const feedback = {};
vm.runInNewContext(compile(read('services/SOSAutomaticSmsFeedback.ts')), { exports: feedback });
const home = ts.createSourceFile('home.tsx', read('app/(tabs)/index.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(tree, predicate) { if (predicate(tree)) return tree; return ts.forEachChild(tree, child => find(child, predicate)); }
const action = find(home, n => ts.isVariableDeclaration(n) && n.name.getText(home) === 'shareActiveSOS');
assert.ok(action);
function homeFixture(result = 'sms_opened') {
  const dialogs = [], calls = [], notices = [];
  const context = {
    activeEvent: { id: 'event' }, userId: 'A', contacts: [],
    smsFallbackPendingRef: { current: false }, smsFallbackContextRef: { current: { userId: 'A', eventId: 'event' } },
    statusRef: { current: 'active' }, Platform: { OS: 'android' }, AppState: { currentState: 'active' },
    Alert: { alert: (...args) => dialogs.push(args) },
    SOSService: { sendSmsFallback: async () => { calls.push('composer-request'); if (result === 'throw') throw new Error('synthetic'); return { status: result }; } },
    setPushDeliveryNotice: update => notices.push(update(null)),
  };
  const exports = {};
  vm.runInNewContext(compile('exports.share = ' + action.initializer.getText(home)), { exports, ...context });
  return { ...context, share: exports.share, calls, dialogs, notices };
}
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const serviceTree = ts.createSourceFile('service.ts', read('services/SOSService.ts'), ts.ScriptTarget.Latest, true);
const guard = find(serviceTree, n => ts.isIfStatement(n) && n.expression.getText(serviceTree).includes('allowInteractiveFallback'));
assert.ok(guard);
async function automaticFallback(result, allowed = true) {
  let opens = 0;
  const exports = {};
  const text = 'exports.run = async (automaticSmsResult, allowInteractiveFallback) => { let localDeliveryResult = {status:"not_needed",channel:null}; ' + guard.getText(serviceTree) + '; return localDeliveryResult; };';
  vm.runInNewContext(compile(text), { exports, requiresSmsFallbackConfirmation: feedback.requiresSmsFallbackConfirmation,
    sendSosAlert: async () => { opens++; return { status: 'sms_opened', channel: 'sms' }; },
    completedEvent: {}, contacts: [], console: { warn() {}, info() {} } });
  const value = await exports.run(result, allowed); return { opens, value };
}
function automaticFixture(outcomes) {
  const calls = [], markers = new Set();
  const modules = {
    'react-native': { Platform: { OS: 'android' }, PermissionsAndroid: { PERMISSIONS: { SEND_SMS: 'sms' }, check: async () => true } },
    'safemelink-sms': { SafeMeLinkSms: { sendSosSmsWithResult: async () => {
      const status = outcomes[calls.length]; calls.push(status);
      return { attemptId: '11111111-1111-4111-8111-111111111111', status, reason: 'send_failed', requested: true, delivery: 'not_verified' };
    } } },
    '@/services/PhoneIdentity': { getPhoneIdentityKey: p => p },
    '@/services/SOSSessionTimeout': { getSOSSessionWithTimeout: async () => ({ user: { id: 'A' } }) },
    '@/storage/SOSAutomaticSmsStorage': { SOSAutomaticSmsStorage: {
      hasConsent: async () => true, getAttemptedRecipients: async () => markers,
      markAttempted: async (_u, _e, p) => { if (markers.has(p)) return false; markers.add(p); return true; },
      markResult: async () => {},
    } },
  };
  const exports = {};
  vm.runInNewContext(compile(read('services/SOSAutomaticSmsService.ts')), { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, console: { info() {} } });
  return { calls, send: () => exports.SOSAutomaticSmsService.sendForSOS('A', { id: 'event', location: null },
    outcomes.map((_v, i) => ({ priority: i + 1, phone: '+10000000' + i }))) };
}
(async () => {
  const audit = ts.createSourceFile('audit.cjs', read('scripts/audit-static-checks.cjs'), ts.ScriptTarget.Latest, true);
  const smsCheck = find(audit, n => ts.isCallExpression(n) && n.expression.getText(audit) === 'check' &&
    n.arguments[0]?.text === 'SOS push and trusted automatic SMS run independently with bounded fallback');
  assert.ok(smsCheck);
  vm.runInNewContext('(' + smsCheck.arguments[1].getText(audit) + ')()', { assert,
    sosService: read('services/SOSService.ts'), sosAlertService: read('services/SOSAlertService.ts') });
  console.log('PASS only the relevant existing SMS static audit, now requiring the stronger fallback guard');
  const base = { status: 'uncertain', reason: 'native_result_unknown', sentCount: 0, failedCount: 0, unknownCount: 1, skippedCount: 0 };
  for (const value of [base, { ...base, status: 'failed', unknownCount: 0, failedCount: 1, requestedCount: 1 },
    { ...base, status: 'unavailable', unknownCount: 0, previouslyAttemptedCount: 1 }]) {
    const f = await automaticFallback(value); assert.equal(f.opens, 0); assert.equal(f.value.status, 'not_needed');
  }
  assert.equal((await automaticFallback({ ...base, status: 'permission_required', unknownCount: 0 })).opens, 1);
  assert.equal((await automaticFallback({ ...base, status: 'failed', unknownCount: 0, failedCount: 1, requestedCount: 0 })).opens, 1);
  assert.equal((await automaticFallback({ ...base, status: 'permission_required', unknownCount: 0 }, false)).opens, 0);
  console.log('PASS actual SOS fallback branch: unknown, partial handoff and previous attempts never auto-open composer; definite no-handoff and background policy preserved');
  const h = homeFixture(); await h.share(); await h.share(); assert.equal(h.dialogs.length, 1); assert.equal(h.calls.length, 0);
  assert.match(h.dialogs[0][1], /duplicarli/);
  h.dialogs[0][2][1].onPress(); h.dialogs[0][2][1].onPress(); await drain();
  assert.equal(h.calls.length, 1); assert.match(h.notices[0], /nessun invio manuale confermato/);
  assert.equal(h.smsFallbackPendingRef.current, false);
  console.log('PASS actual Home handler: explicit confirmation, double tap/callback guard and composer-open is not sent');
  const ios = homeFixture(); ios.Platform.OS = 'ios'; await ios.share();
  assert.equal(ios.calls.length, 1); assert.equal(ios.dialogs.length, 0); assert.equal(ios.notices.length, 0);
  for (const dismiss of [f => f.dialogs[0][2][0].onPress(), f => f.dialogs[0][3].onDismiss()]) {
    const f = homeFixture(); await f.share(); dismiss(f); f.dialogs[0][2][1].onPress(); await drain(); assert.equal(f.calls.length, 0);
  }
  for (const invalidate of [f => { f.smsFallbackContextRef.current = null; },
    f => { f.smsFallbackContextRef.current.userId = 'B'; }, f => { f.smsFallbackContextRef.current.eventId = 'new'; },
    f => { f.statusRef.current = 'idle'; }, f => { f.AppState.currentState = 'background'; }]) {
    const f = homeFixture(); await f.share(); invalidate(f); f.dialogs[0][2][1].onPress(); await drain(); assert.equal(f.calls.length, 0);
  }
  for (const result of ['no_channel', 'technical_error', 'throw']) {
    const f = homeFixture(result); await f.share(); f.dialogs[0][2][1].onPress(); await drain();
    assert.equal(f.notices.length, 0); assert.match(f.dialogs[1][1], /Nessun invio manuale confermato/);
  }
  console.log('PASS cancel/dismiss, stale account/event/unmount, closed SOS, background and composer failures');
  const mixed = automaticFixture(['sent', 'failed', 'unknown']); const result = await mixed.send();
  assert.equal(result.sentCount, 1); assert.equal(result.failedCount, 1); assert.equal(result.unknownCount, 1);
  const message = feedback.automaticSmsFeedback(result); assert.match(message, /Esito SMS parziale/); assert.match(message, /consegna ai destinatari non è verificata/);
  assert.match(feedback.automaticSmsFeedback({ ...result, skippedCount: 1 }), /Voci escluse dall’invio automatico: 1/);
  const replay = await mixed.send(); assert.equal(mixed.calls.length, 3); assert.equal(replay.previouslyAttemptedCount, 3);
  assert.equal(replay.sentCount, 0); assert.equal((await automaticFallback(replay)).opens, 0);
  assert.match(feedback.automaticSmsFeedback(replay), /non viene riconfermato/);
  console.log('PASS actual automatic service: mixed recipients are not all-success; persisted markers prevent replay and do not invent prior success');
  console.log('No native composer, SMS, SOS, HTTP or database operation executed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
