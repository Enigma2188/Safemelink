const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = path => fs.readFileSync(path, 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function authorization(result, alreadyGranted = false) {
  let consent = false, requests = 0;
  const exports = {};
  const modules = {
    'react-native': { Platform: { OS: 'android' }, PermissionsAndroid: {
      PERMISSIONS: { SEND_SMS: 'sms' }, RESULTS: { GRANTED: 'granted', NEVER_ASK_AGAIN: 'never' },
      check: async () => alreadyGranted, request: async () => { requests++; return result; },
    } },
    'safemelink-sms': { SafeMeLinkSms: {} },
    '@/storage/SOSAutomaticSmsStorage': { SOSAutomaticSmsStorage: { setConsent: async (_u, value) => { consent = value; } } },
    '@/services/PhoneIdentity': {}, '@/services/SOSSessionTimeout': {},
  };
  vm.runInNewContext(compile(read('services/SOSAutomaticSmsService.ts')), { exports, require: n => { assert.ok(modules[n], n); return modules[n]; } });
  const state = await exports.SOSAutomaticSmsService.requestAuthorization('fixture');
  assert.equal(consent, true);
  assert.equal(state.permission, alreadyGranted || result === 'granted');
  assert.equal(state.permanentlyDenied, !alreadyGranted && result === 'never');
  assert.equal(requests, alreadyGranted ? 0 : 1);
}
async function offFirstTap() {
  const source = read('app/voice-protection.tsx');
  const body = source.slice(source.indexOf('  const deactivateProtection ='), source.indexOf('  const requestItalianModelDownload ='));
  let stopped = false, enabled = true;
  const pending = [];
  const slow = () => new Promise(resolve => pending.push(resolve));
  const context = {
    userId: 'fixture', activationCancellationRef: {current:0}, activationInFlightRef:{current:false},
    deactivationInFlightRef:{current:false}, refreshGenerationRef:{current:0}, settingsRefreshPendingRef:{current:false},
    settingsRef:{current:{enabled:true}}, setIsSaving(){}, setActivationFeedback(){}, setMessage(){}, setMicrophoneState(){},
    setSettings: s => {enabled=s.enabled;},
    VoiceProtectionRuntime:{requestRecognitionStop(){stopped=true;},notifySettingsChanged(){}},
    VoiceProtectionService:{stop:slow},VoiceProtectionStorage:{save:slow},
    runWithTimeout:p=>p,VOICE_SETTINGS_SAVE_TIMEOUT_MS:5000, refreshState(){},
  };
  vm.createContext(context);
  vm.runInContext(compile(body + '\nglobalThis.off = deactivateProtection;'),context);
  const first=context.off();
  assert.equal(stopped,true); assert.equal(enabled,false,'OFF UI must precede persistence/native completion');
  await context.off(); await context.off();
  assert.equal(pending.length,2,'repeated OFF must not duplicate teardown or persistence');
  pending.forEach(resolve=>resolve()); await first;
  assert.equal(enabled,false); assert.equal(context.activationInFlightRef.current,false);
}
(async()=>{
  for(const result of ['granted','denied','never']) await authorization(result);
  await authorization('granted',true);
  for(let i=0;i<20;i++) await offFirstTap();
  const contacts=read('screens/TrustedContactsScreen.tsx');
  assert.match(contacts,/contacts.length === 0 && nextContacts.length > 0 && !smsConsent && smsSupported/);
  assert.match(contacts,/text: 'NON ORA', style: 'cancel'/);
  assert.match(contacts,/AppState.addEventListener[\s\S]*loadSmsAuthorization/);
  assert.match(contacts,/<QRCode value=\{trustedContactUrl\(publicCode\)\}/);
  assert.doesNotMatch(contacts,/trustedContactUrl\(publicCode\) \|\| publicCode/);
  assert.ok(contacts.indexOf('const valid = parseTrustedContactToken(token)') > contacts.indexOf("setLinkCode('')"), 'deep-link fill follows account reset');
  assert.match(read('screens/NeighborhoodNetworkScreen.tsx'),/isAdmin \? <PrimaryButton[^\n]*INVITA UN VICINO[^\n]*setActiveTab\('invites'\)/);
  assert.match(read('app/(tabs)/index.tsx'),/router.push\('\/destination-address' as Href\)\}>\s*<Text[^>]*>INSERISCI INDIRIZZO/);
  console.log('PASS SMS authorization granted/denied/permanent, existing consent CTA contract, 20 OFF teardown cycles, invite role gate, visible address CTA, QR payload');
})().catch(error=>{console.error(error);process.exitCode=1;});
