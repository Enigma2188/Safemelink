const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve('services/SafetyExpirationRuntime.ts'), 'utf8');
const homeSource = fs.readFileSync(path.resolve('app/(tabs)/index.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
function fixture(initial = null, os = 'ios') {
  let now = 1_000_000;
  let stored = initial;
  let deliveries = 0;
  let notices = 0;
  let cancelledNotices = 0;
  let failWrite = false;
  let holdClaim = null;
  let nativeRecord = null;
  let generation = 0;
  let interrupted = false;
  const operationIds = [];
  const native = {
    prepareDeadlines(user, kind, session, t1, t2) {
      assert.equal(t2 - t1, 30_000);
      nativeRecord = { user, kind, session, t1, t2, generation: String(++generation), claimed: false, armed: false };
      return nativeRecord.generation;
    },
    async armDeadlines(token) { if (nativeRecord?.generation !== token) return false; nativeRecord.armed = true; return true; },
    isCurrentDeadline(user, session, token) { return nativeRecord?.user === user && nativeRecord.session === session && nativeRecord.generation === token; },
    claimEscalation(user, session, token) {
      if (!this.isCurrentDeadline(user, session, token) || !nativeRecord.armed || (nativeRecord.claimed && now < nativeRecord.leaseUntil) || now < nativeRecord.t2) return false;
      nativeRecord.claimed = true; nativeRecord.leaseUntil = now + 300_000; return true;
    },
    escalationState() { return nativeRecord ? 'in_progress' : 'missing'; },
    operationId(user, session) { return `${user}:${session}`; },
    cancelDeadlines(user, kind, session) {
      if (nativeRecord?.user === user && (!kind || nativeRecord.kind === kind) && (!session || nativeRecord.session === session)) nativeRecord = null;
    },
    finishDeadlines(user, session, token) { if (this.isCurrentDeadline(user, session, token)) nativeRecord = null; },
    releaseEscalation(user, session, token) { if (this.isCurrentDeadline(user, session, token)) nativeRecord.claimed = false; },
  };
  const storage = {
    get: async () => stored,
    save: async (_user, value) => {
      if (failWrite) { failWrite = false; throw new Error('storage unavailable'); }
      if (value.phase === 'executing' && holdClaim) await holdClaim;
      stored = { ...value };
    },
    clear: async () => { stored = null; },
  };
  const exports = {};
  const modules = {
    'react-native': { Platform: { OS: os } },
    '@/modules/safemelink-safety': { SafeMeLinkSafety: native },
    '@/storage/SafetyExpirationStorage': { SafetyExpirationStorage: storage },
    '@/storage/CheckpointStorage': { CheckpointStorage: { getActive: async () => ({ startedAt: 'session' }), clearActive: async () => {} } },
    '@/storage/GoHomeStorage': { GoHomeStorage: { getActive: async () => ({ id: 'session' }), clearActive: async () => {} } },
    '@/services/SafetyOperation': { withSafetyTimeout: async (p) => p, reportSafetyError: () => {} },
    '@/services/SafetyNotifications': { SafetyNotifications: {
      checkExactAlarmPermission() {},
      show: () => { notices += 1; return new Promise(() => {}); },
      cancelConfirmation: async () => { cancelledNotices += 1; },
    } },
    '@/services/SOSService': { SOSService: { completeSOS: async (_user, options) => {
      deliveries += 1; operationIds.push(options.escalationOperationId);
      if (interrupted) return new Promise(() => {});
      return {};
    } } },
    '@/services/VoiceProtectionRuntime': { VoiceProtectionRuntime: {
      notifySOSExecutionStarted() {}, notifySOSCompleted() {}, notifySOSFailed() {}, wakeBackgroundTask() {},
    } },
  };
  class Clock extends Date { constructor(value) { super(value === undefined ? now : value); } static now() { return now; } }
  const load = () => {
    vm.runInNewContext(compiled, { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; }, Date: Clock, console });
  };
  load();
  return {
    get runtime() { return exports.SafetyExpirationRuntime; },
    restart() { load(); },
    interrupt(value) { interrupted = value; },
    operationIds,
    native,
    get nativeRecord() { return nativeRecord; },
    advance(ms) { now += ms; }, deadline: () => new Date(now + 1000).toISOString(),
    fail() { failWrite = true; }, hold(p) { holdClaim = p; },
    get deliveries() { return deliveries; }, get notices() { return notices; }, get stored() { return stored; },
    get cancelledNotices() { return cancelledNotices; }, get now() { return now; },
  };
}

async function main() {
  const nativeRoot = 'modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/';
  const nativeStore = fs.readFileSync(`${nativeRoot}SafetyDeadlineStore.kt`, 'utf8');
  const nativeService = fs.readFileSync(`${nativeRoot}SafetyEscalationService.kt`, 'utf8');
  assert.match(nativeStore, /setAlarmClock\(AlarmManager\.AlarmClockInfo/);
  assert.match(nativeStore, /t2 == t1 \+ 30_000/);
  assert.match(nativeStore, /@Synchronized fun claim/);
  assert.match(nativeStore, /for \(stage in 1\.\.2\)/);
  assert.match(nativeStore, /alarms\(context\)\.cancel\(operation\)/);
  assert.match(nativeService, /acquire\(240_000\)/);
  assert.match(nativeService, /wakeLock\?\.release\(\)/);
  assert.match(nativeService, /removeTaskEventListener/);
  assert.match(nativeService, /START_NOT_STICKY/);
  {
    const exports = {};
    let sessionUser = 'A';
    let current = true;
    let processed = 0;
    let release;
    const delivery = new Promise((resolve) => { release = resolve; });
    const code = ts.transpileModule(fs.readFileSync('services/SafetyHeadlessTask.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const modules = {
      'react-native': { AppRegistry: { registerHeadlessTask(name) { assert.equal(name, 'SafeMeLinkSafetyEscalation'); } } },
      '@/modules/safemelink-safety': { SafeMeLinkSafety: { isCurrentDeadline: () => current,
        cancelDeadlines() { current = false; } } },
      '@/services/SOSSessionTimeout': { getSOSSessionWithTimeout: async () => ({ user: { id: sessionUser } }) },
      '@/services/SafetyExpirationRuntime': { SafetyExpirationRuntime: { processDue: async () => { processed += 1; }, waitForExecution: () => delivery } },
      '@/services/SafetyOperation': { reportSafetyError() {} },
    };
    vm.runInNewContext(code, { exports, require: (name) => modules[name], Date, console });
    let finished = false;
    const run = exports.runSafetyEscalation({ userId: 'A', sessionId: 'session', generation: 'generation' }).then(() => { finished = true; });
    await flush();
    assert.equal(processed, 1);
    assert.equal(finished, false, 'headless service stays alive for the existing SOS completion');
    release(); await run;
    sessionUser = 'B';
    await exports.runSafetyEscalation({ userId: 'A', sessionId: 'session', generation: 'generation' });
    assert.equal(processed, 1, 'no SOS for previous account');
    assert.equal(current, false);
    current = true; sessionUser = 'A';
    const stale = exports.runSafetyEscalation({ userId: 'A', sessionId: 'session', generation: 'generation' });
    current = false; // Cancel while session retrieval is awaiting its result.
    await stale;
    assert.equal(processed, 1, 'late authenticated result cannot resurrect cancellation');
  }
  assert.match(source, /deadlineLatenessMs:/);
  assert.match(source, /escalationLatenessMs:/);
  for (const kind of ['checkpoint', 'go_home']) {
    const f = fixture(null, 'android');
    await f.runtime.schedule('account', kind, 'session', f.deadline(), 30);
    const id = f.stored.operationId;
    await f.native.armDeadlines(f.stored.nativeDeadlineGeneration);
    f.restart(); // Crash before claim: durable state and native alarm survive.
    f.advance(31_000);
    f.interrupt(true);
    await f.runtime.processDue('account');
    assert.equal(f.stored.phase, 'executing');
    assert.equal(f.stored.operationId, id);
    f.restart(); // JS died inside completeSOS; no old runtime executing set survives.
    f.interrupt(false);
    await f.runtime.processDue('account');
    assert.equal(f.deliveries, 1, 'unexpired native lease prevents competing task');
    f.advance(300_000);
    await Promise.all([f.runtime.processDue('account'), f.runtime.processDue('account')]);
    await f.runtime.waitForExecution('account');
    assert.equal(f.deliveries, 2, 'one bounded recovery call after crash');
    assert.deepEqual(f.operationIds, [id, id], 'recovery reuses the same operation, never a new logical SOS');
    assert.equal(f.stored, null);
    assert.equal(f.nativeRecord, null);
  }
  for (const kind of ['checkpoint', 'go_home']) {
    const f = fixture(null, 'android');
    await f.runtime.schedule('account', kind, 'session', f.deadline(), 30);
    const token = f.stored.nativeDeadlineGeneration;
    await f.native.armDeadlines(token);
    f.advance(1_000);
    await f.runtime.processDue('account');
    assert.equal(f.notices, 0, 'Android T1 owned by native receiver, not duplicated by JS');
    f.advance(30_000);
    await Promise.all([f.runtime.processDue('account'), f.runtime.processDue('account')]);
    await f.runtime.waitForExecution('account');
    assert.equal(f.deliveries, 1);
    assert.equal(f.nativeRecord, null, 'completion cancels both alarms and notice');
  }
  {
    const f = fixture(null, 'android');
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    await f.native.armDeadlines(f.stored.nativeDeadlineGeneration);
    f.advance(1_000);
    await f.runtime.processDue('account');
    await f.runtime.cancel('account', 'checkpoint', 'session');
    f.advance(30_000);
    await f.runtime.processDue('account');
    assert.equal(f.deliveries, 0, 'confirmation during grace cancels T2');
    assert.equal(f.nativeRecord, null);
  }
  {
    const f = fixture(null, 'android');
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    await f.native.armDeadlines(f.stored.nativeDeadlineGeneration);
    f.advance(10 * 60_000);
    await Promise.all([f.runtime.processDue('account'), f.runtime.processDue('account')]);
    await f.runtime.waitForExecution('account');
    assert.equal(f.deliveries, 1, 'late Android recovery uses expired grace, single fire');
  }
  {
    const f = fixture(null, 'android');
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    const token = f.stored.nativeDeadlineGeneration;
    await f.native.armDeadlines(token);
    f.advance(31_000);
    assert.equal(f.native.claimEscalation('account', 'session', token), true);
    await f.runtime.processDue('account'); // Simulate process death between native claim and JS persistence.
    assert.equal(f.deliveries, 0, 'uncertain durable native claim is never replayed');
    assert.notEqual(f.stored.phase, 'failed');
    f.advance(300_000);
    await f.runtime.processDue('account');
    await f.runtime.waitForExecution('account');
    assert.equal(f.deliveries, 1, 'expired lease recovers with the stable operation ID');
  }
  {
    const f = fixture(null, 'android');
    await f.runtime.schedule('A', 'checkpoint', 'session', f.deadline(), 30);
    const token = f.stored.nativeDeadlineGeneration;
    assert.equal(f.native.claimEscalation('B', 'session', token), false, 'account isolation');
    await f.runtime.cancel('A', 'checkpoint', 'session');
    assert.equal(await f.native.armDeadlines(token), false, 'late arm after cancellation cannot resurrect alarms');
    f.advance(31_000);
    await f.runtime.processDue('A');
    assert.equal(f.deliveries, 0);
  }
  {
    const f = fixture(null, 'android');
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    await f.native.armDeadlines(f.stored.nativeDeadlineGeneration);
    f.advance(31_000);
    f.fail();
    await assert.rejects(f.runtime.processDue('account'));
    assert.equal(f.nativeRecord.claimed, false, 'release native claim only before SOS invocation');
    await f.runtime.processDue('account');
    await f.runtime.waitForExecution('account');
    assert.equal(f.deliveries, 1);
  }
  {
    const f = fixture();
    const deadline = new Date(f.now + 60_000).toISOString();
    await f.runtime.schedule('account', 'checkpoint', 'session', deadline, 30);
    assert.equal(f.stored.expiresAt, deadline, 'one-minute deadline persisted unchanged');
    f.advance(59_000);
    await f.runtime.processDue('account');
    assert.equal(f.stored.phase, 'waiting');
    f.advance(1_000);
    await f.runtime.processDue('account');
    assert.equal(f.stored.phase, 'confirming');
    f.advance(29_000);
    await f.runtime.processDue('account');
    assert.equal(f.deliveries, 0, 'full 30-second grace anchored to deadline');
    f.advance(1_000);
    await f.runtime.processDue('account');
    await flush();
    assert.equal(f.deliveries, 1);
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    // Simulate no JS execution during background, then foreground recovery.
    f.advance(10 * 60_000);
    await Promise.all([f.runtime.processDue('account'), f.runtime.processDue('account')]);
    await flush();
    assert.equal(f.deliveries, 1, 'late recovery must not restart grace or double-fire');
  }
  {
    const exports = {};
    let allowed = false;
    let scheduled = 0;
    let armed = 0;
    const code = ts.transpileModule(fs.readFileSync('services/SafetyNotifications.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const modules = {
      'expo-notifications': { AndroidImportance: { HIGH: 4 }, SchedulableTriggerInputTypes: { DATE: 'date' },
        getPermissionsAsync: async () => ({ granted: true }),
        scheduleNotificationAsync: async (request) => { scheduled += 1; assert.equal(request.trigger.date, 1_060_000); } },
      'react-native': { Platform: { OS: 'android' }, Alert: { alert() {} }, Linking: { openSettings: async () => {} } },
      '@/modules/safemelink-safety': { SafeMeLinkSafety: { canScheduleExactAlarms: () => allowed,
        armDeadlines: async () => { armed += 1; return true; } } },
      '@/services/SafetyOperation': { SafetyOperationError: class extends Error {}, reportSafetyError() {}, withSafetyTimeout: async (p) => p },
      '@/services/OperationalNotificationChannels': { ensureOperationalChannel: async () => {}, SAFETY_NOTIFICATION_CHANNEL_ID: 'safety-checks', warnSilentOperationalChannel() {} },
    };
    vm.runInNewContext(code, { exports, require: (name) => modules[name], Date, console });
    await assert.rejects(exports.SafetyNotifications.scheduleConfirmation('session', 'checkpoint', new Date(1_060_000).toISOString()));
    assert.equal(scheduled, 0, 'no silently inexact notification without special permission');
    allowed = true;
    assert.equal(await exports.SafetyNotifications.scheduleConfirmation('session', 'checkpoint', new Date(1_060_000).toISOString(), 'generation'), true);
    assert.equal(armed, 1);
    assert.equal(scheduled, 0, 'Android uses only the native T1/T2 engine');
  }
  assert.match(homeSource, /const preventiveStartInFlightRef = useRef\(false\)/);
  assert.match(homeSource, /if \(preventiveStartInFlightRef\.current\)[\s\S]{0,180}Attendi il completamento/);
  assert.match(homeSource, /statusRef\.current !== 'idle'[\s\S]{0,180}checkpointStatusRef\.current !== 'idle'/);
  assert.match(homeSource, /VoiceProtectionRuntime\.onSOSRequested[\s\S]{0,900}startSOSCountdown\('voice'/);
  {
    const exports = {};
    let fire;
    let cleared = 0;
    const code = ts.transpileModule(fs.readFileSync('services/SafetyOperation.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, { exports, console: { warn() {} },
      setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => { cleared += 1; },
    });
    const pending = exports.withSafetyTimeout(new Promise(() => {}), 'local_notification');
    fire();
    await assert.rejects(pending, { name: 'SafetyOperationError' });
    await assert.rejects(exports.withSafetyTimeout(Promise.reject(new Error('native failed')), 'local_notification'));
    assert.equal(await exports.withSafetyTimeout(Promise.resolve(true), 'storage_read'), true);
    assert.equal(cleared, 3, 'all timer paths clean up');
  }
  for (const kind of ['checkpoint', 'go_home']) {
    const f = fixture();
    await f.runtime.schedule('account', kind, 'session', f.deadline(), 30);
    const target = Date.parse(f.stored.expiresAt);
    f.advance(1002);
    await f.runtime.processDue('account');
    assert.ok(f.now - target <= 3000, `${kind}: transition timing exceeded tolerance`);
    assert.ok(f.stored && Date.parse(f.stored.expiresAt) >= 0);
    assert.equal(f.stored.phase, 'confirming');
    assert.equal(f.notices, 1);
    await f.runtime.processDue('account');
    assert.equal(f.notices, 1);
    f.advance(30000);
    await Promise.all([f.runtime.processDue('account'), f.runtime.processDue('account')]);
    await flush();
    assert.equal(f.deliveries, 1, `${kind}: pending notification must not block SOS`);
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    await f.runtime.markConfirmationScheduled('account', 'checkpoint', 'session');
    f.advance(1000);
    await f.runtime.processDue('account');
    assert.equal(f.stored.phase, 'confirming');
    assert.equal(f.notices, 0, 'pre-scheduled native notification is not duplicated by JS');
  }
  {
    const f = fixture({ kind: 'manual_sos', sessionId: 'session', phase: 'waiting',
      expiresAt: new Date(999999).toISOString(), confirmationExpiresAt: new Date(999999).toISOString() });
    await f.runtime.processDue('account');
    await flush();
    assert.equal(f.deliveries, 1, 'expired manual countdown restored without React');
  }
  {
    const f = fixture({ kind: 'manual_sos', sessionId: 'session', phase: 'executing',
      expiresAt: new Date(999999).toISOString(), confirmationExpiresAt: new Date(999999).toISOString() });
    await f.runtime.processDue('account');
    assert.equal(f.deliveries, 0, 'uncertain persisted execution is never replayed');
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'manual_sos', 'session', f.deadline(), 0);
    await Promise.all([f.runtime.expedite('account'), f.runtime.expedite('account')]);
    await flush();
    assert.equal(f.deliveries, 1, 'expedite single fire');
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'checkpoint', 'session', f.deadline(), 30);
    await f.runtime.markConfirmationScheduled('account', 'checkpoint', 'session');
    f.advance(31000);
    let release;
    f.hold(new Promise((resolve) => { release = resolve; }));
    const due = f.runtime.processDue('account');
    await flush();
    const cancel = f.runtime.cancel('account', 'checkpoint', 'session');
    release();
    await Promise.all([due, cancel]);
    assert.equal(f.deliveries, 0, 'cancel while claim is pending');
    assert.equal(f.cancelledNotices, 1, 'cancel removes the scheduled notification');
  }
  {
    const f = fixture();
    await f.runtime.schedule('account', 'manual_sos', 'session', f.deadline(), 0);
    f.advance(1000);
    f.fail();
    await assert.rejects(f.runtime.processDue('account'));
    assert.equal(f.deliveries, 0);
    assert.equal(f.stored.phase, 'waiting');
    await f.runtime.processDue('account');
    await flush();
    assert.equal(f.deliveries, 1, 'storage failure is recoverable before execution');
  }
  console.log('PASS safety deadlines: pending notification, stages, duplicate callback, cancel, expedite, storage recovery');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
