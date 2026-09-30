const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('services/SOSService.ts', 'utf8');
async function scenario(network, nearby, count, denied) {
  let sms = 0, push = 0, fallback = 0;
  const contacts = Array.from({length: count}, (_, i) => ({id: `fixture-${i}`}));
  const modules = {
    '@/services/ContactsService': {ContactsService: {list: async () => contacts, listCached: async () => contacts}},
    '@/backend/functions/SOSPushService': {SOSRemoteCreationTimeoutError: class extends Error {}, SOSPushService: {send: async () => {
      push++; return {sosCreated: true, sosId: 'fixture-sos', recipientCount: nearby, tokenCount: nearby, notificationsSent: nearby, notificationsFailed: 0, errors: [], reason: nearby ? 'sent' : 'no_recipients'};
    }}},
    '@/services/LocationService': {LocationService: {getCurrentLocation: async () => null}},
    '@/services/SOSAlertService': {sendSosAlert: async () => {fallback++; return {status: count ? 'opened' : 'no_contacts', channel: null};}},
    '@/services/SOSSessionTimeout': {getSOSSessionWithTimeout: async () => ({user: {id: 'fixture-owner'}})},
    '@/services/SOSAutomaticSmsService': {SOSAutomaticSmsService: {sendForSOS: async (_u, _e, loaded) => {
      sms += loaded.length; return {status: denied ? 'permission_required' : loaded.length ? 'sent' : 'unavailable', sentCount: denied ? 0 : loaded.length, failedCount: 0, skippedCount: 0};
    }}},
    '@/storage/SOSStorage': {SOSStorage: {saveEvent: async (_u, e) => [e]}},
    '@/services/SOSLiveLocationService': {SOSLiveLocationService: {start: async () => {}}},
    '@/storage/SafetySOSOperationStorage': {SafetySOSOperationStorage: {}},
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText,
    {exports, require: (n) => {assert.ok(modules[n], `Unexpected dependency ${n}`); return modules[n];}, setTimeout, clearTimeout, console: {info(){},log(){},warn(){},error(){}}});
  const result = await exports.SOSService.completeSOS('fixture-owner');
  assert.equal(sms, count); assert.equal(push, 1); assert.equal(result.event.isActive, true);
  assert.equal(fallback, denied || count === 0 ? 1 : 0);
  // No presence setting is imported or read by the actual orchestration.
  assert.doesNotMatch(source, /SOSNetworkPresence|sos_network_enabled/);
  console.log(`PASS SMS path: network=${network}, nearby=${nearby}, contacts=${count}, denied=${denied}`);
}
(async () => {
  for (const network of ['ON','OFF']) for (const nearby of [0,2]) for (const count of [0,2]) {
    await scenario(network, nearby, count, false);
    await scenario(network, nearby, count, true);
  }
  assert.match(fs.readFileSync('app/(tabs)/index.tsx','utf8'), /AGGIUNGI CONTATTI FIDATI/);
})().catch(e => {console.error(e); process.exitCode=1;});
