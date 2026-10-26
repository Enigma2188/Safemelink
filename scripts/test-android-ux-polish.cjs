const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = path => fs.readFileSync(path, 'utf8');
const voice = read('app/voice-protection.tsx');
const contacts = read('screens/TrustedContactsScreen.tsx');
const home = read('app/(tabs)/index.tsx');
const compile = code => ts.transpileModule(code, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

// Evaluate the actual JSX control expressions, not a duplicated UI model.
const tree = ts.createSourceFile('voice.tsx', voice, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const buttons = [];
const visit = node => {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'Pressable' &&
      node.attributes.getText(tree).includes('voiceCommandIsStop')) buttons.push(node);
  ts.forEachChild(node, visit);
};
visit(tree);
assert.equal(buttons.length, 1);
const attribute = name => buttons[0].attributes.properties.find(p => p.name?.getText(tree) === name).initializer.expression.getText(tree);
const stopExpression = voice.match(/const voiceCommandIsStop = ([^;]+);/)[1];
for (const enabled of [false, true]) for (const pending of [false, true]) for (const saving of [false, true]) {
  let activated = 0, stopped = 0;
  const context = { settings: { enabled, passphrase: 'fixture' }, activationInFlightRef: { current: pending },
    deactivationInFlightRef: { current: false }, isSaving: saving, userId: 'fixture', Platform: { OS: 'android' },
    activateProtection: () => activated++, deactivateProtection: () => stopped++ };
  context.voiceCommandIsStop = vm.runInNewContext(stopExpression, context);
  const disabled = vm.runInNewContext(attribute('disabled'), context);
  assert.equal(disabled, !(enabled || pending) && saving);
  if (!disabled) {
    vm.runInNewContext(`(${attribute('onPress')})()`, context);
    assert.equal(stopped, enabled || pending ? 1 : 0);
    assert.equal(activated, enabled || pending ? 0 : 1);
  }
}
const inputStyle = voice.match(/passphraseInput: \{([\s\S]*?)\n  \}/)[1];
assert.match(inputStyle, /color: '#F7FAFF'/);
assert.match(inputStyle, /fontSize: 16/);
assert.match(voice, /placeholderTextColor=\{Platform.OS === 'android' \? '#A8B5D1'/);
assert.match(voice, /selectionColor=\{Platform.OS === 'android' \? '#45B7FF'/);
assert.doesNotMatch(voice, /allowFontScaling=\{false\}/);

// Existing contacts alone must make the persistent banner eligible, on every mount.
const banner = contacts.match(/\{(Platform\.OS === 'android' && contacts.length > 0 &&[^\n]+) \? \(/)[1];
for (const count of [0, 1, 3]) for (const smsReady of [false, true]) {
  assert.equal(vm.runInNewContext(banner, { Platform: { OS: 'android' }, contacts: Array(count),
    smsReady }), count > 0 && !smsReady);
}
assert.ok(contacts.indexOf('SMS AUTOMATICI NON ATTIVI') < contacts.indexOf('Il mio codice SafeMeLink'));
assert.match(contacts, /state === 'active' && isFocusedRef.current\) void loadSmsAuthorization\(\)/);
assert.match(contacts, /void loadSmsAuthorization\(\)/);

async function authorization(permission, permanentlyDenied) {
  const start = contacts.indexOf('  const setAutomaticSmsEnabled =');
  const end = contacts.indexOf('\n  useEffect(', start);
  let snapshot, calls = 0;
  const context = { userId: 'fixture', activeUserIdRef: { current: 'fixture' }, isFocusedRef: { current: true },
    smsAuthorizationPendingRef: { current: false }, smsAuthorizationRevisionRef: { current: 0 }, smsAuthorizationActionRef: { current: null },
    setSmsAuthorizationPending() {}, setSmsAuthorization: value => { snapshot = value; }, setSmsAuthorizationFeedback() {},
    awaitSmsAuthorization: p => p, SOSAutomaticSmsService: { requestAuthorization: async () => {
      calls++; return { consent: true, permission, supported: true, permanentlyDenied,
        permissionState: permission ? 'granted' : permanentlyDenied ? 'blocked_or_restricted' : 'not_granted' };
    } } };
  vm.runInNewContext(compile(`${contacts.slice(start, end)}; globalThis.activate = setAutomaticSmsEnabled;`), context);
  assert.equal(calls, 0);
  await context.activate(true);
  assert.equal(calls, 1); assert.equal(snapshot.state.consent, true); assert.equal(snapshot.state.permission, permission);
  if (permanentlyDenied) assert.equal(snapshot.state.permissionState, 'blocked_or_restricted');
}

const noticeStart = home.indexOf('const getSOSDeliveryNotice =');
const noticeEnd = home.indexOf('\n};', noticeStart) + 3;
const feedbackExports = {};
vm.runInNewContext(compile(fs.readFileSync('services/SOSAutomaticSmsFeedback.ts', 'utf8')), { exports: feedbackExports });
const context = { Platform: { OS: 'android' }, automaticSmsFeedback: feedbackExports.automaticSmsFeedback };
vm.runInNewContext(compile(`${home.slice(noticeStart, noticeEnd)}; globalThis.notice = getSOSDeliveryNotice;`), context);
for (const reason of ['no_eligible_recipients', 'no_linked_recipients']) {
  for (const status of ['consent_required', 'permission_required']) {
    const message = context.notice({ reason, notificationsSent: 0 }, { status: 'no_channel' },
      { status, sentCount: 0, failedCount: 0, skippedCount: 0 });
    assert.match(message, /notifiche push SafeMeLink/);
    assert.doesNotMatch(message, /Nessun contatto fidato|SMS automatici affidati/);
  }
}
const accepted = context.notice({ notificationsSent: 1 }, {}, { status: 'sent', sentCount: 2 });
assert.match(accepted, /Invio SMS confermato da Android: 2/);
assert.doesNotMatch(accepted, /consegnati/);
assert.match(home, /Nessun contatto fidato configurato/);
assert.match(home, /Hai \$\{contacts.length\} contatti fidati, ma gli SMS automatici non sono attivi/);
assert.match(home, /'Invia manualmente via SMS'/);
assert.match(home, /if \(active && current === generation\)/);
assert.match(home, /active = false; generation\+\+; listener.remove\(\)/);

(async () => {
  await authorization(true, false);
  await authorization(false, false);
  await authorization(false, true);
  console.log('PASS Voice single-command states/pending OFF, input contrast, existing-contact SMS banner, explicit authorization/denial/settings, SOS messaging');
})().catch(error => { console.error(error); process.exitCode = 1; });
