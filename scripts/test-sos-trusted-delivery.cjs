const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const automaticSource = fs.readFileSync(path.resolve('services/SOSAutomaticSmsService.ts'), 'utf8');
const fallbackSource = fs.readFileSync(path.resolve('services/SOSAlertService.ts'), 'utf8');
const homeSource = fs.readFileSync(path.resolve('app/(tabs)/index.tsx'), 'utf8');
const compiled = ts.transpileModule(automaticSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const attempted = new Set();
const nativeCalls = [];
const diagnostics = [];
const fixture = { exports: {} };
const canonicalize = (phone) => (/^\+[1-9]\d{6,14}$/.test(phone ?? '') ? phone : null);

vm.runInNewContext(compiled, {
  module: fixture,
  exports: fixture.exports,
  require(specifier) {
    if (specifier === 'react-native') return {
      Platform: { OS: 'android' },
      PermissionsAndroid: {
        PERMISSIONS: { SEND_SMS: 'SEND_SMS' }, RESULTS: { GRANTED: 'granted' },
        check: async () => true, request: async () => 'granted',
      },
    };
    if (specifier === 'safemelink-sms') return { SafeMeLinkSms: {
      async sendSms(phone) {
        nativeCalls.push(phone);
        if (phone === '+22222222') throw new Error('native_failure');
      },
    } };
    if (specifier.endsWith('/PhoneIdentity')) return {
      getPhoneIdentityKey: (phone, phoneE164) => canonicalize(phoneE164) ?? canonicalize(phone),
    };
    if (specifier.endsWith('/SOSAutomaticSmsStorage')) return { SOSAutomaticSmsStorage: {
      hasConsent: async () => true,
      getAttemptedRecipients: async () => new Set(attempted),
      markAttempted: async (_userId, _eventId, phone) => attempted.add(phone),
      setConsent: async () => undefined,
    } };
    throw new Error(`Unexpected import: ${specifier}`);
  },
  console: {
    info: (...args) => diagnostics.push(args),
    warn: (...args) => diagnostics.push(args),
    log: (...args) => diagnostics.push(args),
  },
  Set,
});

async function main() {
  const contacts = [
    { priority: 5, phone: '+44444444', phoneE164: '+44444444', preferredChannel: 'sms' },
    { priority: 2, phone: '+22222222', phoneE164: '+22222222', preferredChannel: 'whatsapp' },
    { priority: 3, phone: '+11111111', phoneE164: '+11111111', preferredChannel: 'sms' },
    { priority: 1, phone: '+11111111', phoneE164: '+11111111', preferredChannel: 'whatsapp' },
    { priority: 4, phone: '+33333333', phoneE164: '+33333333', preferredChannel: 'sms' },
    { priority: 0, phone: 'invalid', phoneE164: null, preferredChannel: 'sms' },
  ];
  const event = { id: 'event', location: { latitude: 1, longitude: 2 } };
  const result = await fixture.exports.SOSAutomaticSmsService.sendForSOS('user', event, contacts);
  assert.deepEqual(nativeCalls, ['+11111111', '+22222222', '+33333333']);
  assert.equal(result.status, 'sent');
  assert.equal(result.sentCount, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.skippedCount, 3);
  await fixture.exports.SOSAutomaticSmsService.sendForSOS('user', event, contacts);
  assert.equal(nativeCalls.length, 3, 'A repeated completion must not resend attempted SMS.');
  assert.match(fallbackSource, /Linking\.canOpenURL\(url\)/);
  assert.match(fallbackSource, /if \(!canOpen\)[\s\S]*return \{ opened: false/);
  assert.match(fallbackSource, /Linking\.openURL\(url\)/);
  assert.doesNotMatch(fallbackSource, /whatsapp:\/\/|wa\.me|Share\.share/i);
  assert.match(homeSource, /SMS automatici affidati al sistema/);
  assert.match(homeSource, /Composer SMS aperto: controlla il destinatario e premi Invia/);
  const serializedDiagnostics = JSON.stringify(diagnostics);
  for (const value of ['+11111111', '+22222222', '+33333333', 'latitude', 'longitude']) {
    assert.equal(serializedDiagnostics.includes(value), false);
  }
  console.log('PASS trusted SOS SMS: priority, cap, dedup, partial failure, retry guard, privacy and feedback');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
