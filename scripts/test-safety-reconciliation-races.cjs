const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; }, Date, console: { info() {} } });
  return exports;
}
function fixture() {
  const expiry = new Date(Date.now() + 60_000).toISOString();
  let stored = { kind: 'checkpoint', sessionId: 'old', expiresAt: expiry,
    confirmationExpiresAt: new Date(Date.parse(expiry) + 30_000).toISOString(), phase: 'waiting', nativeDeadlineGeneration: 'g0', operationId: 'op-old' };
  let record = { user: 'A', kind: 'checkpoint', session: 'old', generation: 'g0', armed: true };
  let source = 'old'; let barrier; let nextRead = false; let generations = 0; let deliveryRelease; let deliveries = 0; let nextArm = false; let armRelease;
  const native = {
    prepareDeadlines(user, kind, session) { record = { user, kind, session, generation: `g${++generations}`, armed: false }; return record.generation; },
    recoverDeadlines(user, kind, session, t1, t2, generation) {
      if (record) return this.isCurrentDeadline(user, session, generation) ? generation : null;
      if (generation) return null;
      return this.prepareDeadlines(user, kind, session, t1, t2);
    },
    isCurrentDeadline(user, session, generation) { return record?.user === user && record.session === session && record.generation === generation; },
    operationId(user, session) { return `op-${session}`; },
    async armDeadlines(generation) {
      if (nextArm) { nextArm = false; await new Promise((r) => { armRelease = r; }); }
      if (record?.generation !== generation) return false;
      record.armed = true; return true;
    },
    cancelDeadlines(user, kind, session) { if (record?.user === user && (!kind || record.kind === kind) && (!session || record.session === session)) record = null; },
    finishDeadlines(user, session, generation) { if (this.isCurrentDeadline(user, session, generation)) record = null; },
    rollbackDeadlines(user, session, generation) { if (!this.isCurrentDeadline(user, session, generation) || record.claimed) return false; record = null; return true; },
    claimEscalation(user, session, generation) { if (!this.isCurrentDeadline(user, session, generation) || record.claimed) return false; record.claimed = true; return true; },
    escalationState() { return record ? 'in_progress' : 'missing'; },
  };
  const modules = {
    'react-native': { Platform: { OS: 'android' } },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: native },
    '@/storage/SafetyExpirationStorage': { SafetyExpirationStorage: {
      get: async () => { const snapshot = stored && { ...stored }; if (nextRead) { nextRead = false; await new Promise((r) => { barrier = r; }); } return snapshot; },
      save: async (_, value) => { stored = { ...value }; }, clear: async () => { stored = null; },
    } },
    '@/storage/CheckpointStorage': { CheckpointStorage: { getActive: async () => source ? { startedAt: source } : null, clearActive: async () => { source = null; } } },
    '@/storage/GoHomeStorage': { GoHomeStorage: { getActive: async () => null, clearActive: async () => {} } },
    '@/services/SafetyOperation': { reportSafetyError() {}, withSafetyTimeout: async (p) => p },
    '@/services/SOSService': { SOSService: { completeSOS: async () => { deliveries++; await new Promise((r) => { deliveryRelease = r; }); return {}; } } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: { wakeBackgroundTask() {}, notifySOSExecutionStarted() {}, notifySOSCompleted() {}, notifySOSFailed() {} } },
    '@/services/VoiceProtectionService': { VoiceProtectionService: { ensureSafetyMonitoring: async () => {}, releaseSafetyMonitoring: async () => {} } },
    '@/services/SafetyNotifications': { SafetyNotifications: { checkExactAlarmPermission() {}, cancelConfirmation: async () => {},
      scheduleConfirmation: async (_, __, ___, generation) => native.armDeadlines(generation) } },
  };
  const runtime = load('services/SafetyExpirationRuntime.ts', modules).SafetyExpirationRuntime;
  modules['@/services/SafetyExpirationRuntime'] = { SafetyExpirationRuntime: runtime };
  const service = load('services/SafetyExpirationService.ts', modules).SafetyExpirationService;
  return { runtime, service, native, expiry, pause() { nextRead = true; }, resume() { assert.ok(barrier); barrier(); },
    pauseArm() { nextArm = true; }, resumeArm() { assert.ok(armRelease); armRelease(); },
    releaseDelivery() { assert.ok(deliveryRelease); deliveryRelease(); }, get deliveries() { return deliveries; },
    set stored(value) { stored = value; }, set source(value) { source = value; }, get record() { return record; }, get stored() { return stored; } };
}
async function cancelRace() {
  const f = fixture(); f.pause();
  const pending = f.service.ensure('A', 'checkpoint', 'old', f.expiry, 30).catch(() => null);
  await flush(); const cancel = f.runtime.cancel('A', 'checkpoint', 'old');
  await flush(); f.resume(); await Promise.all([pending, cancel]);
  return f.record?.session === 'old' && f.record.armed;
}
async function replacementRace(repeat = false) {
  const f = fixture(); f.pause();
  const pending = f.service.reconcile('A').catch(() => null);
  await flush(); f.source = repeat ? 'repeat' : 'new';
  const start = f.runtime.schedule('A', 'checkpoint', repeat ? 'repeat' : 'new', f.expiry, 30);
  await flush(); f.resume(); const schedule = await start; await pending;
  await f.native.armDeadlines(schedule.nativeDeadlineGeneration);
  return f.record?.session !== (repeat ? 'repeat' : 'new');
}
async function casaRace(accountChange = false) {
  let value = null; let resolve; let hold = true;
  const storage = load('storage/GoHomeStorage.ts', { '@/storage/AccountScopedStorage': {
    getAccountStorageItem: async () => { const snapshot = value; if (hold) { hold = false; await new Promise((r) => { resolve = r; }); } return snapshot; },
    setAccountStorageItem: async (_, __, v) => { value = v; }, removeAccountStorageItem: async () => {},
  } }).GoHomeStorage;
  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  const block = home.match(/(?:const homeLocationRevision[^;]*;\s*)?void GoHomeStorage\.getHomeLocation\(loadUserId\)[\s\S]*?\.catch\(\(\) => reportSafetyError\('home_location_load'\)\);/)[0];
  const run = new Function('GoHomeStorage', 'loadUserId', 'loadGeneration', 'activeUserIdRef', 'loadGenerationRef', 'setHomeLocation', 'reportSafetyError', block.replace('void GoHomeStorage', 'return GoHomeStorage'));
  let visible;
  const owner = { current: 'A' };
  const pending = run(storage, 'A', 1, owner, { current: 1 }, (v) => { visible = v; }, () => {});
  await flush(); const saved = await storage.saveHomeLocation('A', { latitude: 45, longitude: 9 }); visible = saved;
  if (accountChange) owner.current = 'B';
  resolve(); await pending; assert.equal(JSON.parse(value).latitude, 45);
  return visible !== saved;
}
async function extraRaces() {
  {
    const f = fixture();
    await f.runtime.schedule('A', 'manual_sos', 'manual', f.expiry, 0);
    await f.runtime.cancel('A', 'checkpoint', 'old');
    assert.equal(f.record, null, 'manual SOS supersedes old preventive native alarms');
    assert.equal(f.stored.kind, 'manual_sos', 'old cleanup preserves manual countdown');
  }
  {
    const f = fixture(); const schedule = { ...f.stored };
    f.record.claimed = true;
    await f.runtime.rollbackPrepared('A', schedule);
    assert.equal(f.record.claimed, true, 'late rollback preserves an existing native lease');
    assert.equal(f.stored.nativeDeadlineGeneration, schedule.nativeDeadlineGeneration);
  }
  {
    const f = fixture(); f.pauseArm();
    const oldArm = f.service.ensure('A', 'checkpoint', 'old', f.expiry, 30).catch(() => null);
    await flush(); f.source = 'new';
    await f.runtime.schedule('A', 'checkpoint', 'new', f.expiry, 30);
    const generation = f.record.generation;
    f.resumeArm(); await oldArm;
    assert.equal(f.record.generation, generation, 'generation checked at native mutation, not only before async bridge call');
    assert.equal(f.record.session, 'new'); assert.equal(f.stored.sessionId, 'new');
  }
  {
    const f = fixture(); f.source = 'new';
    const start = f.runtime.schedule('A', 'checkpoint', 'new', f.expiry, 30);
    const staleCancel = f.runtime.cancel('A', 'checkpoint', 'old');
    await start; assert.equal(await staleCancel, false);
    assert.equal(f.record.session, 'new', 'late old cancellation does not invalidate a pending new start');
  }
  {
    const f = fixture(); f.pause(); const cancel = f.runtime.cancel('A', 'checkpoint', 'old');
    await flush(); f.source = 'new'; const start = f.runtime.schedule('A', 'checkpoint', 'new', f.expiry, 30);
    f.resume(); await Promise.all([cancel, start]);
    assert.equal(f.stored.sessionId, 'new'); assert.equal(f.record.session, 'new');
  }
  {
    const f = fixture(); const old = { ...f.stored };
    await f.runtime.schedule('A', 'checkpoint', 'old', f.expiry, 30);
    const generation = f.record.generation;
    await f.runtime.rollbackPrepared('A', old);
    assert.equal(f.record.generation, generation, 'late rollback cannot cancel successor with same session ID');
    assert.equal(f.stored.nativeDeadlineGeneration, generation);
    assert.equal(f.native.recoverDeadlines('A', 'checkpoint', 'old', 0, 0, old.nativeDeadlineGeneration), null, 'native CAS rejects old generation');
  }
  {
    const f = fixture(); f.stored = { ...f.stored, expiresAt: new Date(Date.now() - 60_000).toISOString(),
      confirmationExpiresAt: new Date(Date.now() - 30_000).toISOString() };
    await f.runtime.processDue('A'); assert.equal(f.deliveries, 1);
    const recovery = f.service.reconcile('A'); await flush(); f.releaseDelivery();
    await Promise.all([recovery, f.runtime.waitForExecution('A')]);
    assert.equal(f.stored, null); assert.equal(f.record, null); assert.equal(f.deliveries, 1);
  }
  {
    const f = fixture(); f.record.firstFired = true;
    const generation = f.record.generation;
    await f.service.reconcile('A'); await f.service.reconcile('A');
    assert.equal(f.record.firstFired, true); assert.equal(f.record.generation, generation);
    assert.equal(f.stored.expiresAt, f.expiry);
  }
  assert.equal(await casaRace(true), false, 'account change rejects old Casa hydration');
  const native = fs.readFileSync('modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/SafetyDeadlineStore.kt', 'utf8');
  assert.match(native, /@Synchronized fun recover/); assert.match(native, /@Synchronized fun finish/);
  assert.match(native, /@Synchronized fun rollback/);
  assert.match(native, /current.optBoolean\("claimed"\) \|\| \(current.optBoolean\("armed"\) && System.currentTimeMillis\(\) >= current.getLong\("t2"\)\)/);
  assert.match(native, /record.put\("armed", false\).put\("claimed", false\).put\("state", "cancelled"\)/);
  assert.match(native, /if \(generation != null\) return null/);
  assert.match(native, /remainingMs <= 0 \|\| record.optBoolean\("claimed"\) \|\| record.optBoolean\("escalationFired"\)/);
  assert.match(native, /Tempo di conferma scaduto/);
  assert.match(native, /try \{\s*show\(context, current\)\s*\} catch/);
  assert.match(native, /throw error[\s\S]*?current.put\("firstFired", true\)\s*write\(context, current\)/);
  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  assert.match(home, /checkpointConfirmSeconds > 0 && <Pressable/);
  assert.match(home, /goHomeConfirmSeconds > 0 && <Pressable/);
  assert.match(home, /Date.now\(\) >= Date.parse\(checkpointExpiresAt\) \+ CHECKPOINT_CONFIRM_SECONDS \* 1_000/);
  assert.match(home, /Date.now\(\) >= Date.parse\(goHomeExpiresAt\) \+ GO_HOME_CONFIRM_SECONDS \* 1_000/);
}
if (require.main === module) (async () => {
  const results = { CANCEL_RACE_OLD_REARMED: Boolean(await cancelRace()), STALE_RECONCILE_REPLACED_NEW_ALARM: await replacementRace(), OLDER_CASA_HYDRATION_OVERWROTE_NEW_UI_SAVE: await casaRace() };
  for (const [name, value] of Object.entries(results)) console.log(`${name}=${value}`);
  for (const value of Object.values(results)) assert.equal(value, process.argv.includes('--expect-bugs'));
  if (!process.argv.includes('--expect-bugs')) { assert.equal(await replacementRace(true), false, 'Repeat generation remains current'); await extraRaces(); }
  console.log(process.argv.includes('--expect-bugs') ? 'REPRODUCTION CONFIRMED: 3 bugs on unchanged runtime' : 'PASS real runtime reconciliation races');
})().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
