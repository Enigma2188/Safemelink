const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  let user = 'A';
  let location = null;
  let failRemote = false;
  let crashAfterRemote = false;
  let saves = 0;
  let gpsReads = 0;
  const journal = new Map();
  const remote = new Map();
  const sms = new Set();
  const identities = [];
  const modules = {
    '@/services/ContactsService': { ContactsService: { list: async () => [], listCached: async () => [] } },
    '@/services/LocationService': { LocationService: { getCurrentLocation: async () => {
      gpsReads += 1; if (!location) throw new Error('GPS unavailable'); return location;
    } } },
    '@/services/SOSSessionTimeout': { getSOSSessionWithTimeout: async () => ({ user: { id: user } }) },
    '@/storage/SafetySOSOperationStorage': { SafetySOSOperationStorage: {
      get: async (account, id) => journal.get(`${account}:${id}`) ?? null,
      save: async (account, id, operation) => journal.set(`${account}:${id}`, structuredClone(operation)),
    } },
    '@/services/SOSAutomaticSmsService': { SOSAutomaticSmsService: { sendForSOS: async (account, event) => {
      sms.add(`${account}:${event.id}`);
      return { status: 'sent', sentCount: 1, failedCount: 0, skippedCount: 0, reason: 'sent' };
    } } },
    '@/backend/functions/SOSPushService': { SOSRemoteCreationTimeoutError: class extends Error {}, SOSPushService: {
      send: async (event, account) => {
        identities.push(event.id);
        if (failRemote) throw new Error('Before insert');
        remote.set(`${account}:${event.id}`, { id: event.id, location: event.location });
        if (crashAfterRemote) { crashAfterRemote = false; throw new Error('Response lost after commit'); }
        return { sosCreated: true, sosId: event.id, notificationsSent: 1, notificationsFailed: 0,
          recipientCount: 1, tokenCount: 1, errors: [] };
      },
    } },
    '@/services/SOSAlertService': { sendSosAlert: async () => { throw new Error('Unexpected interactive fallback'); } },
    '@/storage/SOSStorage': { SOSStorage: { saveEvent: async (_account, event) => { saves += 1; return [event]; } } },
    '@/services/SOSLiveLocationService': { SOSLiveLocationService: { start: async () => undefined } },
  };
  const load = () => {
    const exports = {};
    vm.runInNewContext(compile('services/SOSService.ts'), {
      exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; },
      Date, Map, Promise, setTimeout, clearTimeout, console: { info() {}, warn() {}, log() {}, error() {} },
    });
    return exports.SOSService;
  };
  return { load, remote, journal, sms, identities,
    setUser(value) { user = value; }, setLocation(value) { location = value; },
    fail(value) { failRemote = value; }, crash() { crashAfterRemote = true; },
    get saves() { return saves; }, get gpsReads() { return gpsReads; } };
}
async function main() {
  const operationId = 'operation-from-persisted-native-generation';
  const options = { escalationOperationId: operationId, allowRecentNetworkLocation: true, allowInteractiveFallback: false };
  for (const crash of ['before_remote', 'after_remote']) {
    const f = fixture();
    if (crash === 'before_remote') f.fail(true); else f.crash();
    await assert.rejects(f.load().completeSOS('A', options));
    assert.equal(f.journal.get(`A:${operationId}`).event.location, null);
    f.fail(false);
    // New VM = process restart. Only durable journal and backend survive.
    const result = await f.load().completeSOS('A', options);
    assert.equal(result.event.id, operationId);
    assert.equal(result.event.location, null);
    assert.match(result.event.message, /Posizione non disponibile/);
    assert.equal(f.remote.size, 1, 'same operation -> same remote SOS after uncertain insert');
    assert.equal(f.sms.size, 1, 'same SMS identity across recovery');
    assert.ok(f.identities.every((id) => id === operationId));
    const saves = f.saves;
    await f.load().completeSOS('A', options);
    assert.equal(f.saves, saves, 'completed journal bypasses all delivery side effects');
    f.setUser('B');
    await assert.rejects(f.load().completeSOS('A', options), /Sessione cambiata/);
  }
  {
    const f = fixture();
    f.setLocation({ latitude: 1, longitude: 2, accuracy: 10, observedAt: new Date().toISOString() });
    const result = await f.load().completeSOS('A', options);
    assert.equal(result.event.location.latitude, 1);
    assert.match(result.event.message, /Google Maps/);
  }
  // Exercise the real LocationService fallback, not only an SOS-level stub.
  {
    let osFix = null;
    const exports = {};
    const modules = {
      'expo-location': { Accuracy: { High: 4, Balanced: 3 },
        getForegroundPermissionsAsync: async () => ({ status: 'denied' }),
        requestForegroundPermissionsAsync: async () => ({ status: 'denied' }),
        getLastKnownPositionAsync: async () => osFix },
      '@/storage/SOSNetworkLocationStorage': { SOSNetworkLocationStorage: { get: async () => null } },
    };
    vm.runInNewContext(compile('services/LocationService.ts'), { exports, require: (name) => modules[name],
      Date, Promise, setTimeout, clearTimeout, console: { warn() {}, info() {} } });
    await assert.rejects(exports.LocationService.getCurrentLocation({ allowRecentNetworkLocationForUserId: 'A' }));
    osFix = { timestamp: Date.now() - 60_000, coords: { latitude: 1, longitude: 2, accuracy: 30 } };
    await assert.rejects(exports.LocationService.getCurrentLocation({ allowRecentNetworkLocationForUserId: 'A' }), 'non-SOS callers do not gain fallback');
    const cached = await exports.LocationService.getCurrentLocation({ allowRecentNetworkLocationForUserId: 'A', allowLastKnownLocation: true });
    assert.equal(cached.source, 'recent');
    assert.ok(cached.observedAt);
    osFix.timestamp = Date.now() - 11 * 60_000;
    await assert.rejects(exports.LocationService.getCurrentLocation({ allowRecentNetworkLocationForUserId: 'A', allowLastKnownLocation: true }));
  }
  // Durable SMS recipient state survives a NEW module instance and unrelated sends.
  {
    const values = new Map();
    const load = () => {
      const exports = {};
      vm.runInNewContext(compile('storage/SOSAutomaticSmsStorage.ts'), { exports, require: () => ({
        getAccountStorageItem: async (account, key) => values.get(`${account}:${key}`) ?? null,
        setAccountStorageItem: async (account, key, value) => values.set(`${account}:${key}`, value),
      }), Promise, Set, Object, JSON });
      return exports.SOSAutomaticSmsStorage;
    };
    const id = '00000000-0000-4000-8000-000000000001';
    const storage = load();
    assert.equal(await storage.markAttempted('A', id, 'recipient'), true);
    await storage.markResult('A', id, 'recipient', 'handed_to_system');
    for (let i = 0; i < 50; i += 1) await storage.markAttempted('A', String(i), 'recipient');
    assert.equal(await load().markAttempted('A', id, 'recipient'), false);
    assert.equal(await load().markAttempted('B', id, 'recipient'), true, 'account-isolated markers');
    const states = JSON.parse(values.get('A:sos-sms-dispatch')).states;
    assert.equal(states[id].recipient, 'handed_to_system');
  }
  const sql = fs.readFileSync('supabase/migrations/20260918120000_safety_escalation_idempotency.sql', 'utf8');
  assert.match(sql, /operation_id uuid primary key/);
  assert.match(sql, /sos_id uuid not null unique/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(operation_id::text, 0\)\)/);
  assert.match(sql, /existing_operation\.user_id <> current_user_id/);
  assert.match(sql, /Safety SOS was removed/);
  assert.match(sql, /revoke all on table public\.safety_sos_operations from public, anon, authenticated/);
  assert.match(sql, /safety_sos_operations enable row level security/);
  assert.ok(sql.indexOf('if found then') < sql.indexOf('if (position_latitude is null)'), 'lookup before new payload validation');
  assert.doesNotMatch(sql, /references public\.sos|on delete cascade|drop policy.*sos_delete_own/i);
  assert.match(sql, /target\.id = operation_id and target\.user_id = current_user_id/);
  assert.match(sql, /current_user_id <> expected_user_id/);
  assert.match(sql, /where target_sos\.latitude is not null\s+and target_sos\.longitude is not null/);
  assert.match(sql, /alter column latitude drop not null/);
  assert.match(sql, /alter column longitude drop not null/);
  assert.match(sql, /from public, anon/);
  assert.match(sql, /to authenticated/);
  assert.doesNotMatch(sql, /delete from|disable row level security/i);
  const corrective = fs.readFileSync('supabase/migrations/20260918123000_fix_safety_sos_location_timestamp.sql', 'utf8');
  assert.match(corrective, /add column if not exists location_updated_at timestamptz/);
  assert.match(corrective, /location_updated_at drop default/);
  assert.match(corrective, /location_updated_at = position_observed_at/);
  assert.match(corrective, /target\.location_updated_at/);
  assert.doesNotMatch(corrective, /coalesce\(target\.location_updated_at|create_my_safety_sos|safety_sos_operations|delete from|cascade/i);
  assert.match(corrective, /target\.user_id = current_user_id/);
  assert.match(corrective, /from public, anon/);
  assert.match(corrective, /to authenticated/);
  const native = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineStore.kt', 'utf8');
  assert.match(native, /now \+ 300_000/);
  assert.match(native, /optInt\("attempts"\) >= 3/);
  assert.match(native, /recoveryAlarm\(context, record\)/);
  assert.match(native, /UUID\.nameUUIDFromBytes/);
  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  assert.doesNotMatch(home, /if \(latestStoredEvent\?\.location &&/);
  console.log('PASS safety SOS recovery: crash, stable identity, null GPS, completed journal, auth isolation and migration contracts');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
