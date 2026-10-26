const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const ready = { consent: true, permission: true, supported: true, consentVerified: true, permissionVerified: true,
  verified: true, permissionState: 'granted', permanentlyDenied: false, requestInProgress: false, problem: null };

function serviceFixture(data = { consent: {}, permission: false }) {
  const state = { result: 'granted', grantOnResult: true, failRead: false, failWrite: false, failCheck: false, holdWrite: null, holdDialog: null, requests: 0, writes: 0, checks: 0 };
  const native = { SafeMeLinkSms: { sendSms() { throw Error('FORBIDDEN SMS'); }, sendSosSmsWithResult() { throw Error('FORBIDDEN SMS'); } } };
  const modules = {
    'react-native': { Platform: { OS: 'android' }, PermissionsAndroid: { PERMISSIONS: { SEND_SMS: 'sms' },
      RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never' },
      check: async () => { state.checks++; if (state.failCheck) throw Error('controlled-check-error'); return data.permission; },
      request: async () => { state.requests++; if (state.holdDialog) await state.holdDialog.promise;
        data.permission = state.result === 'granted' && state.grantOnResult; return state.result; },
    } },
    'safemelink-sms': native,
    '@/storage/SOSAutomaticSmsStorage': { SOSAutomaticSmsStorage: {
      hasConsent: async owner => { if (state.failRead) throw Error('controlled-read-error'); return data.consent[owner] === true; },
      setConsent: async (owner, value) => { state.writes++; if (state.failWrite) throw Error('controlled-write-error');
        if (state.holdWrite) await state.holdWrite.promise; data.consent[owner] = value; },
    } },
    '@/services/PhoneIdentity': {}, '@/services/SOSSessionTimeout': {},
  };
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync('services/SOSAutomaticSmsService.ts', 'utf8')), {
    exports, Error, setTimeout, clearTimeout, require: id => { assert.ok(modules[id], id); return modules[id]; }, console: { info() {} },
  });
  return { ...exports, api: exports.SOSAutomaticSmsService, data, state, native };
}

function uiFixture(service, wait = p => p) {
  let snapshot = null, pending = false, feedback = '';
  const context = { userId: 'A', activeUserIdRef: { current: 'A' }, isFocusedRef: { current: true },
    smsAuthorizationPendingRef: { current: false }, smsAuthorizationRevisionRef: { current: 0 }, smsAuthorizationActionRef: { current: null },
    setSmsAuthorization: value => { snapshot = value; }, setSmsAuthorizationPending: value => { pending = value; },
    setSmsAuthorizationFeedback: value => { feedback = value; }, useCallback: fn => fn,
    SOSAutomaticSmsService: service, awaitSmsAuthorization: wait, Error };
  const screen = fs.readFileSync('screens/TrustedContactsScreen.tsx', 'utf8');
  const load = screen.slice(screen.indexOf('  const loadSmsAuthorization ='), screen.indexOf('\n  useEffect(', screen.indexOf('  const loadSmsAuthorization =')));
  const action = screen.slice(screen.indexOf('  const setAutomaticSmsEnabled ='), screen.indexOf('\n  useEffect(', screen.indexOf('  const setAutomaticSmsEnabled =')));
  vm.runInNewContext(compile(load + action + '\nglobalThis.load = loadSmsAuthorization; globalThis.activate = setAutomaticSmsEnabled;'), context);
  return { context, load: context.load, activate: context.activate,
    get snapshot() { return snapshot; }, get pending() { return pending; }, get feedback() { return feedback; } };
}

(async () => {
  for (const result of ['granted', 'denied', 'never']) {
    const f = serviceFixture(); f.state.result = result;
    const value = await f.api.requestAuthorization('A');
    assert.equal(value.consent, true); assert.equal(value.verified, true);
    assert.equal(value.permission, result === 'granted');
    assert.equal(value.permissionState, result === 'granted' ? 'granted' : result === 'never' ? 'blocked_or_restricted' : 'not_granted');
    assert.ok(f.state.checks >= 2, 'permission is rechecked after the dialog');
    if (result === 'never') {
      assert.match(f.smsAuthorizationMessage(value), /sistema\/installer/);
      f.data.permission = true;
      const resumed = await f.api.getAuthorizationState('A');
      assert.equal(resumed.permissionState, 'granted'); assert.equal(resumed.permanentlyDenied, false);
    }
  }
  const revokedDuringCallback = serviceFixture(); revokedDuringCallback.state.grantOnResult = false;
  assert.equal((await revokedDuringCallback.api.requestAuthorization('A')).permission, false, 'GRANTED callback alone never enables SMS');
  const readFailure = serviceFixture({ consent: { A: true }, permission: true }); readFailure.state.failRead = true;
  const uncertain = await readFailure.api.getAuthorizationState('A');
  assert.equal(uncertain.verified, false); assert.equal(uncertain.permission, true); assert.equal(uncertain.permissionState, 'granted');
  assert.equal(uncertain.problem, 'consent_read'); assert.match(readFailure.smsAuthorizationMessage(uncertain), /incerto/);
  const checkFailure = serviceFixture(); checkFailure.state.failCheck = true;
  assert.equal((await checkFailure.api.getAuthorizationState('A')).permissionState, 'unknown');
  const writeFailure = serviceFixture(); writeFailure.state.failWrite = true;
  assert.equal((await writeFailure.api.requestAuthorization('A')).problem, 'consent_write');
  assert.equal(writeFailure.state.requests, 0);
  const unsupported = serviceFixture(); unsupported.native.SafeMeLinkSms = null;
  assert.equal((await unsupported.api.requestAuthorization('A')).supported, false); assert.equal(unsupported.state.writes, 0);

  const duplicate = serviceFixture(); duplicate.state.holdDialog = deferred();
  const first = duplicate.api.requestAuthorization('A'), second = duplicate.api.requestAuthorization('A');
  assert.equal(first, second); await flush(); assert.equal(duplicate.state.requests, 1);
  const other = await duplicate.api.requestAuthorization('B');
  assert.equal(other.requestInProgress, true); assert.equal(duplicate.data.consent.B, undefined);
  duplicate.state.holdDialog.resolve(); await first;
  const restart = serviceFixture(duplicate.data);
  const recovered = await restart.api.getAuthorizationState('A');
  assert.equal(recovered.consent, true); assert.equal(recovered.permission, true); assert.equal(restart.state.requests, 0);

  const cancelled = serviceFixture(); cancelled.state.holdWrite = deferred(); let current = true;
  const old = cancelled.api.requestAuthorization('A', () => current); current = false; cancelled.state.holdWrite.resolve();
  assert.equal((await old).problem, 'account_changed'); assert.equal(cancelled.state.requests, 0); assert.equal(cancelled.data.consent.B, undefined);
  const revoke = serviceFixture(); revoke.state.holdWrite = deferred(); let stillCurrent = true;
  const enabling = revoke.api.requestAuthorization('A', () => stillCurrent); await flush();
  stillCurrent = false; const revoking = revoke.api.revokeAuthorization('A');
  revoke.state.holdWrite.resolve(); await Promise.all([enabling, revoking]);
  assert.equal(revoke.data.consent.A, false, 'late activation write cannot overwrite a later explicit revocation');
  assert.equal(revoke.state.requests, 0);
  const slow = serviceFixture(); slow.state.holdDialog = deferred();
  const inFlight = slow.api.requestAuthorization('A'); await flush();
  await assert.rejects(slow.awaitSmsAuthorization(inFlight, 1), /timeout/);
  assert.equal(slow.api.requestAuthorization('A'), inFlight, 'UI timeout cannot release the native dialog lock');
  assert.equal(slow.state.requests, 1); slow.state.holdDialog.resolve(); await inFlight;

  const oldRead = deferred(); let reads = 0;
  const ui = uiFixture({ getAuthorizationState: async () => ++reads === 1 ? oldRead.promise : ready, requestAuthorization: async () => ready });
  const loading = ui.load(); await flush(); await ui.activate(true);
  oldRead.resolve({ ...ready, consent: false }); await loading;
  assert.equal(ui.snapshot.state.consent, true, 'stale read cannot overwrite activation');
  const lateAction = deferred(); let requests = 0;
  const uiDouble = uiFixture({ requestAuthorization: () => { requests++; return lateAction.promise; } });
  const actionA = uiDouble.activate(true); await uiDouble.activate(true); assert.equal(requests, 1);
  uiDouble.context.activeUserIdRef.current = 'B'; lateAction.resolve(ready); await actionA;
  assert.equal(uiDouble.snapshot, null, 'old account result cannot populate B');
  const timed = deferred(); const waitApi = serviceFixture();
  const uiTimeout = uiFixture({ requestAuthorization: () => timed.promise, getAuthorizationState: async () => ready }, p => waitApi.awaitSmsAuthorization(p, 1));
  await uiTimeout.activate(true); assert.equal(uiTimeout.pending, false); assert.equal(uiTimeout.snapshot, null);
  assert.match(uiTimeout.feedback, /ancora pendente/); timed.resolve(ready); await flush(); assert.equal(uiTimeout.snapshot, null);
  await uiTimeout.load(); assert.equal(uiTimeout.snapshot.state.permission, true, 'manual/foreground verification can resolve unknown state');

  const screen = fs.readFileSync('screens/TrustedContactsScreen.tsx', 'utf8');
  const expression = screen.match(/const smsReady = ([^;]+);/)[1];
  for (const consent of [false, true]) for (const permission of [false, true]) for (const verified of [false, true]) {
    const actual = vm.runInNewContext(expression, { authorization: { verified, problem: null }, smsSupported: true, smsConsent: consent, smsPermission: permission });
    assert.equal(actual, verified && consent && permission);
  }
  assert.match(screen, /SMS autorizzati — nessun contatto fidato configurato/);
  assert.match(screen, /ATTIVA INVIO AUTOMATICO/); assert.match(screen, /NON ORA/);
  assert.match(screen, /state === 'active' && isFocusedRef.current\) void loadSmsAuthorization\(\)/);
  // Execute only the existing SMS static-audit callback, not the general audit.
  const audit = ts.createSourceFile('audit.cjs', fs.readFileSync('scripts/audit-static-checks.cjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const smsCheck = audit.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.arguments[0]?.text === 'Automatic trusted SMS requires account consent and Android SEND_SMS permission');
  assert.ok(smsCheck);
  const read = file => fs.readFileSync(file, 'utf8');
  vm.runInNewContext('(' + smsCheck.expression.arguments[1].getText(audit) + ')()', {
    assert, require, read, appConfig: read('app.json'), contactsScreen: screen,
    sosAutomaticSmsService: read('services/SOSAutomaticSmsService.ts'),
    sosAutomaticSmsStorage: read('storage/SOSAutomaticSmsStorage.ts'),
    smsNativeModule: read('modules/safemelink-sms/android/src/main/java/com/tiziano/safemelink/sms/SafeMeLinkSmsModule.kt'),
    homeScreen: read('app/(tabs)/index.tsx'),
  });
  console.log('PASS real SMS authorization service: grant/deny/non-requestable, possible installer restriction, independent read failures, storage failure, native absence, post-dialog recheck, single request, account switch and restart');
  console.log('PASS real UI handlers: stale read, double tap, account change, timeout, late completion and fresh verification; zero-contact UI contract');
  console.log('No SMS or SOS path invoked. Android dialogs and installer policy NOT tested on a device.');
})().catch(error => { console.error(error); process.exitCode = 1; });
