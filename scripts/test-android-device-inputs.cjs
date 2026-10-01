const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText,
    {exports, require: (name) => {assert.ok(dependencies[name], name); return dependencies[name];}});
  return exports;
}
const link = load('services/TrustedContactLink.ts');
assert.equal(link.trustedContactUrl('SML-0123ABCD'), 'safemelink://connect?token=SML-0123ABCD');
for (const bad of [null, [], 'SML-ZZZZZZZZ', 'SML-123', 'https://evil', 'SML-0123ABCD&x=1']) assert.equal(link.parseTrustedContactToken(bad),null);
const screen = fs.readFileSync('screens/TrustedContactsScreen.tsx','utf8');
assert.match(screen,/setLinkCode\(valid \?\? ''\)/); assert.match(screen,/onPress=\{\(\) => void sendLinkRequest\(\)\}/);
assert.doesNotMatch(screen.match(/useEffect\(\(\) => \{\s*const valid = parseTrustedContactToken[\s\S]*?\}, \[token, userId\]\)/)[0],/sendRequest|sendLinkRequest/);
const picker = fs.readFileSync('components/ContactPickerButton.tsx','utf8');
for (const required of ['canAskAgain','requestPermissionsAsync','presentContactPickerAsync','phoneNumbers','active.current','Annulla','onPick']) assert.ok(picker.includes(required));
assert.doesNotMatch(picker,/console\.|getContactsAsync|setItem/);
const native = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafeMeLinkSafetyModule.kt','utf8');
assert.match(native,/ACTION_REQUEST_SCHEDULE_EXACT_ALARM/);
const notification = fs.readFileSync('services/SafetyNotifications.ts','utf8');
assert.match(notification,/if \(!exactAllowed\) \{\s*void nativeSafety.openExactAlarmSettings\(\)/);
assert.match(notification,/throw new SafetyOperationError\('exact_alarm_permission'\)/);
let granted = true, results = [], fail = false;
const address = load('services/DestinationAddressService.ts', {
  'expo-location': {requestForegroundPermissionsAsync: async () => ({granted}), geocodeAsync: async () => {if(fail) throw Error(); return results;}, reverseGeocodeAsync: async () => [{street:'Fixture street',city:'Fixture city'}]},
  '@/services/SafetyOperation': {withSafetyTimeout: async p => p},
});
(async () => {
  await assert.rejects(address.findDestinationAddress('x'));
  granted=false; await assert.rejects(address.findDestinationAddress('fixture address')); granted=true;
  assert.equal((await address.findDestinationAddress('fixture address')).length,0);
  results=[{latitude:1,longitude:2},{latitude:3,longitude:4}];
  assert.equal((await address.findDestinationAddress('fixture address')).length,2);
  results=[{latitude:1,longitude:2},{latitude:1,longitude:2},{latitude:999,longitude:0}];
  assert.equal((await address.findDestinationAddress('fixture address')).length,1);
  fail=true; await assert.rejects(address.findDestinationAddress('fixture address'));
  const destination=fs.readFileSync('app/destination-address.tsx','utf8');
  assert.match(destination,/GoHomeStorage.saveHomeLocation\(owner/);
  assert.doesNotMatch(destination,/getCurrentPosition|console\.|SafetyExpirationService/);
  assert.match(destination,/KeyboardSafeScrollView/);
  console.log('PASS QR validation/explicit confirmation, picker privacy/guards, exact alarm settings, address results/errors/ambiguity');
})().catch(e=>{console.error(e);process.exitCode=1;});
