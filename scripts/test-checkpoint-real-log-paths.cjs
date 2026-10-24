const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { fixture } = require('./test-safety-expirations.cjs');
const root = 'modules/safemelink-safety/android/src/main/java/com/tiziano/safemelink/safety/';
const store = fs.readFileSync(root + 'SafetyDeadlineStore.kt', 'utf8');
const service = fs.readFileSync(root + 'SafetyEscalationService.kt', 'utf8');
const receiver = fs.readFileSync(root + 'SafetyDeadlineReceiver.kt', 'utf8');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// Reproduce the old failure-notice selection as a small source-backed model.
// This is NOT execution of Kotlin or Android NotificationManager.
const baseline = execFileSync('git', ['show', 'c363e9cc3c4bacfd7ecf235cf4f2755ec4a8473e:' + root + 'SafetyEscalationService.kt'], { encoding: 'utf8' });
const baselineStore = execFileSync('git', ['show', 'c363e9cc3c4bacfd7ecf235cf4f2755ec4a8473e:' + root + 'SafetyDeadlineStore.kt'], { encoding: 'utf8' });
for (const [start, end] of [
  ['@Synchronized fun arm', '@Synchronized fun recover'],
  ['@Synchronized fun claim', 'private fun recoveryAlarm'],
  ['@Synchronized fun fired', '@Synchronized fun publishConfirmation'],
  ['@Synchronized fun cancel', '@Synchronized fun release'],
  ['  fun show(context', '  private fun requestNotification'],
]) {
  const section = source => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))).replace(/\r\n/g, '\n');
  assert.equal(section(store), section(baselineStore), start + ' must remain unchanged');
}
assert.match(baseline, /SafetyDeadlineStore.read\(this\)\?\.let \{ runCatching \{ SafetyDeadlineStore.show\(this, it, true\) \} \}/);
const cancelled = { generation: 'old', armed: false, state: 'cancelled', kind: 'checkpoint' };
const successor = { generation: 'new', armed: true, state: 'pending', kind: 'checkpoint' };
const legacyWouldPost = current => current != null;
assert.equal(legacyWouldPost(cancelled), true);
assert.equal(legacyWouldPost(successor), true);
console.log('REPRO BEFORE (source-backed model): late failure publishes for cancelled record or successor');

const helper = store.slice(store.indexOf('@Synchronized fun showFailureIfCurrent'), store.indexOf('  fun show(context'));
assert.match(helper, /if \(generation == null\) return/);
assert.match(helper, /val record = read\(context\) \?: return/);
assert.match(helper, /show\(context, record, true\)/);
assert.doesNotMatch(helper, /put\(|write\(|claim\(|cancel\(|setAlarmClock|completeSOS/);
// Execute the exact boolean guards from the Kotlin source with JSONObject stubs.
const guard = helper.match(/if \((record.optString\("generation"\)[^\n]+)\) return/)[1];
const suppression = helper.match(/if \((suppressRejectedCheckpointT1[^\n]+)\) return/)[1];
const rejects = new Function('record', 'generation', `return (${guard});`);
const suppresses = new Function('record', 'suppressRejectedCheckpointT1', `return (${suppression});`);
const json = record => ({ optString: key => record[key] ?? '', optBoolean: key => record[key] ?? false });
assert.equal(rejects(json(cancelled), 'old'), true);
assert.equal(rejects(json(successor), 'old'), true);
assert.equal(rejects(json(successor), 'new'), false);
assert.equal(rejects(json({ ...successor, state: 'failed' }), 'new'), false);
assert.equal(suppresses(json({ ...successor, firstNoticeFailed: true }), true), true);
assert.equal(suppresses(json({ ...successor, firstNoticeFailed: true }), false), false);
assert.equal(suppresses(json({ ...successor, kind: 'go_home', firstNoticeFailed: true }), true), false);
assert.match(service, /if \(failureGeneration == null\) failureGeneration = requestedGeneration/);
assert.match(service, /failed\("HEADLESS_START_FAILED", requestedGeneration\)/);
assert.match(service, /for \(generation in failureGenerations\) failed\("HEADLESS_DISPATCH_FAILED", generation\)/);
assert.match(service, /runCatching \{ SafetyDeadlineStore.showFailureIfCurrent\(this, generation\) \}/);
assert.match(receiver, /showFailureIfCurrent\(context, generation, stage == 1\)/);
console.log('PASS AFTER: source guards reject cancelled/successor, preserve current failure notices and checkpoint T1 rejection rule; atomic validation/publication');

async function armed() {
  const f = fixture(null, 'android', { info() {} });
  f.interrupt(true); // Mock SOS dependency stays pending; no real SOS/network.
  const t1 = f.now + 60_000;
  await f.runtime.schedule('A', 'checkpoint', 'session', new Date(t1).toISOString(), 30);
  await f.native.armDeadlines(f.stored.nativeDeadlineGeneration);
  return { f, t1, t2: t1 + 30_000 };
}

(async () => {
  {
    const { f, t1, t2 } = await armed();
    f.advance(t1 - f.now);
    await f.runtime.processDue('A');
    assert.equal(f.deliveries, 0);
    assert.equal(f.stored.phase, 'confirming');
    assert.equal(f.nativeRecord.firstFired, undefined);
    f.advance(t2 - f.now - 1);
    await f.runtime.processDue('A');
    assert.equal(f.deliveries, 0);
    f.advance(1);
    await f.runtime.processDue('A'); await flush();
    assert.equal(f.deliveries, 1);
    assert.equal(f.nativeRecord.claimed, true);
    assert.equal(f.nativeRecord.firstFired, undefined);
    await f.runtime.processDue('A'); await flush();
    assert.equal(f.deliveries, 1);
  }
  console.log('PASS actual TS runtime: UI confirming without native T1, no claim before original T2, claim without T1 after T2, no duplicate SOS invocation (mocked boundary)');
  {
    const { f, t1, t2 } = await armed();
    f.advance(t1 + 5845 - f.now);
    await f.runtime.processDue('A');
    assert.equal(f.deliveries, 0);
    assert.equal(Date.parse(f.stored.confirmationExpiresAt), t2);
    f.advance(t2 + 400 - f.now);
    await f.runtime.processDue('A'); await flush();
    assert.equal(f.deliveries, 1);
  }
  console.log('PASS actual TS runtime: delayed T1 does not extend or shorten original T2');
  console.log('NOT EXECUTED: Kotlin compilation, AlarmManager dispatch, notification visibility, device restrictions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
