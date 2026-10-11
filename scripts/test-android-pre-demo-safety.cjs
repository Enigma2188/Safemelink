const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name];
  }, console: { info() {}, warn() {} }, Date, setTimeout, clearTimeout });
  return exports;
}

async function headless() {
  let session = null;
  let current = true;
  let cancels = 0;
  let processes = 0;
  const errors = [];
  const task = load('services/SafetyHeadlessTask.ts', {
    'react-native': { AppRegistry: { registerHeadlessTask() {} } },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: {
      isCurrentDeadline: () => current,
      finishDeadlines: () => { cancels++; },
    } },
    '@/services/SOSSessionTimeout': { getSOSSessionWithTimeout: async () => session },
    '@/services/SafetyExpirationRuntime': { SafetyExpirationRuntime: {
      processDue: async () => { processes++; }, waitForExecution: async () => {},
    } },
    '@/services/SafetyOperation': { reportSafetyError: (e) => errors.push(e) },
  });
  const data = { userId: 'owner', sessionId: 'session', generation: 'stable' };
  await task.runSafetyEscalation(data);
  assert.equal(cancels, 0);
  assert.equal(processes, 0);
  assert.ok(errors.includes('native_escalation_auth_unavailable'));
  session = { user: { id: 'other' } };
  await task.runSafetyEscalation(data);
  assert.equal(cancels, 1);
  session = { user: { id: 'owner' } };
  await task.runSafetyEscalation(data);
  assert.equal(processes, 1);
  current = false;
  await task.runSafetyEscalation(data);
  assert.equal(processes, 1);
}

async function reconcile() {
  let arms = 0;
  let phase = 'waiting';
  let os = 'android';
  const schedule = () => ({ kind: 'checkpoint', phase, sessionId: 'session',
    nativeDeadlineGeneration: 'same-generation', operationId: 'same-operation',
    expiresAt: new Date(1000).toISOString(), confirmationExpiresAt: new Date(31000).toISOString(),
    confirmationNotificationScheduled: true });
  const service = load('services/SafetyExpirationService.ts', {
    'react-native': { Platform: { get OS() { return os; } } },
    '@/services/SafetyExpirationRuntime': { SafetyExpirationRuntime: {
      ensure: async () => schedule(), get: async () => schedule(),
      getRevision: () => 0,
      markConfirmationScheduled: async () => true, processDue: async () => {},
    } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: { wakeBackgroundTask() {} } },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: {} },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { ensureSafetyMonitoring: async () => {} } },
    '@/services/SafetyOperation': { reportSafetyError() {}, withSafetyTimeout: async (p) => p },
    '@/services/SafetyNotifications': { SafetyNotifications: { scheduleConfirmation: async (...args) => {
      arms++; assert.equal(args[3], 'same-generation'); assert.equal(args[2], schedule().expiresAt); return true;
    } } },
  }).SafetyExpirationService;
  await service.reconcile('owner');
  await service.reconcile('owner');
  assert.equal(arms, 2); // Same native PendingIntent is replaced, not duplicated.
  phase = 'confirming'; await service.reconcile('owner'); assert.equal(arms, 3);
  phase = 'executing'; await service.reconcile('owner'); assert.equal(arms, 3);
  phase = 'failed'; await service.reconcile('owner'); assert.equal(arms, 3);
  os = 'ios'; phase = 'waiting'; await service.ensure('owner', 'checkpoint', 'session', schedule().expiresAt, 30);
  assert.equal(arms, 3); // Existing iOS flag semantics preserved.
}

async function casa() {
  const values = new Map();
  const storage = load('storage/GoHomeStorage.ts', {
    '@/storage/AccountScopedStorage': {
      getAccountStorageItem: async (user, key) => values.get(`${user}:${key}`) ?? null,
      setAccountStorageItem: async (user, key, value) => values.set(`${user}:${key}`, value),
      removeAccountStorageItem: async (user, key) => values.delete(`${user}:${key}`),
    },
  }).GoHomeStorage;
  const saved = await storage.saveHomeLocation('owner', { latitude: 45, longitude: 9 });
  assert.equal((await storage.getHomeLocation('owner')).savedAt, saved.savedAt);
  assert.equal(await storage.getHomeLocation('other'), null);
  await storage.clearActive('owner');
  assert.equal((await storage.getHomeLocation('owner')).latitude, 45);
  for (const value of ['{bad', 'null', '[]', '{"latitude":91,"longitude":9,"savedAt":"2026-10-11"}',
    '{"latitude":"45","longitude":9,"savedAt":"2026-10-11"}', '{"latitude":45,"longitude":9,"savedAt":"invalid"}']) {
    values.set('owner:go-home-location', value);
    assert.equal(await storage.getHomeLocation('owner'), null);
    assert.equal(values.get('owner:go-home-location'), value); // No destructive repair.
  }
  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  const block = home.match(/const homeLocationRevision[^;]*;\s*void GoHomeStorage\.getHomeLocation\(loadUserId\)[\s\S]*?\.catch\(\(\) => reportSafetyError\('home_location_load'\)\);/)[0];
  const hydration = /const \[\s*storedContacts/.exec(home);
  assert.ok(hydration && home.indexOf(block) < hydration.index);
  let resolve;
  let visible = 'previous';
  const owner = { current: 'owner' };
  const generation = { current: 1 };
  const run = new Function('GoHomeStorage', 'loadUserId', 'loadGeneration', 'activeUserIdRef', 'loadGenerationRef', 'setHomeLocation', 'reportSafetyError', block.replace('void GoHomeStorage', 'return GoHomeStorage'));
  const recover = () => run({ getHomeLocationRevision: () => 0, getHomeLocation: () => new Promise((r) => { resolve = r; }) }, 'owner', 1, owner, generation, (v) => { visible = v; }, () => {});
  let pending = recover(); resolve(saved); await pending; assert.equal(visible, saved);
  pending = recover(); owner.current = 'other'; resolve(null); await pending; assert.equal(visible, saved);
  owner.current = 'owner'; pending = recover(); generation.current = 2; resolve(null); await pending; assert.equal(visible, saved);
}

function nativeContracts() {
  const base = 'modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/';
  const store = fs.readFileSync(base + 'SafetyDeadlineStore.kt', 'utf8');
  const receiver = fs.readFileSync(base + 'SafetyDeadlineReceiver.kt', 'utf8');
  assert.match(store, /t2 == t1 \+ 30_000/);
  assert.match(store, /setAlarmClock/);
  assert.match(store, /if \(record.optBoolean\("claimed"\)\) \{\s*recoveryAlarm\(context, record\)\s*return true/);
  assert.match(store, /@Synchronized fun publishConfirmation/);
  assert.match(store, /show\(context, current\)\s*current.put\("firstFired", true\)/);
  assert.match(store, /stage == 1 && record.optBoolean\("firstFired"\)/);
  assert.match(store, /manager.notify\(NOTICE_ID, notice\)/);
  assert.match(store, /FIRST_NOTICE_ATTEMPT/); assert.match(store, /FIRST_NOTICE_POSTED/);
  assert.match(receiver, /SafetyDeadlineStore.publishConfirmation/);
}

(async () => {
  await headless(); await reconcile(); await casa(); nativeContracts();
  console.log('PASS Android pre-demo: Auth absence/account mismatch, stale generation, same-deadline re-arm, phase gates, account-scoped Casa validation/hydration, native publication contracts');
})().catch((error) => { console.error(error); process.exitCode = 1; });
