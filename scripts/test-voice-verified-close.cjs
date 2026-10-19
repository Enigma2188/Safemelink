const assert = require('node:assert/strict');
const { fixture } = require('./test-voice-lifecycle.cjs');

async function scenario({ off = false, otherActive = false, unknown = false, duplicate = false, changedAccount = false } = {}) {
  const f = fixture();
  await f.advance(250); f.enable(); await f.advance(300);
  const attempt = f.runtime.notifySOSExecutionStarted('account-A');
  f.runtime.notifySOSCompleted('account-A', {
    event: { id: 'old-local', ...(unknown ? {} : { remoteSosId: 'old-remote' }) },
    pushResult: { reason: unknown ? 'remote_creation_timeout' : 'sent' },
  }, attempt);
  await f.advance(300);
  // Home has a verified terminal event, but the runtime still holds an older
  // binding. Exercise real runtime/lifecycle/recovery, not a mocked close handler.
  if (otherActive) f.setRemoteActive([{ id: 'other', status: 'open' }]);
  if (off) f.disable();
  if (changedAccount) f.changeAccountBeforeEffects();
  f.runtime.notifySOSClosed('account-A', 'current-local', 'current-remote');
  if (duplicate) f.runtime.notifySOSClosed('account-A', 'current-local', 'current-remote');
  await f.advance(2500);
  assert.equal(f.starts, off || otherActive || unknown || changedAccount ? 1 : 2);
  if (!off && !changedAccount) assert.equal(f.status, otherActive ? 'sos_active' : unknown ? 'sos_uncertain' : 'listening');
  if (unknown) assert.equal(f.recoveryJournal.attemptId, attempt);
  f.unmount(); await f.advance(300);
}

async function rebound() {
  const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
  const attempt = f.runtime.notifySOSExecutionStarted('account-A');
  f.runtime.notifySOSCompleted('account-A', { event: { id: 'same-local' },
    pushResult: { reason: 'remote_creation_timeout' } }, attempt);
  await f.advance(300);
  // Local history may be unavailable even though Home received terminal proof.
  f.setSOSEvents([]);
  f.runtime.notifySOSClosed('account-A', 'same-local', 'verified-remote');
  await f.advance(2500);
  assert.equal(f.starts, 2); assert.equal(f.status, 'listening'); assert.equal(f.recoveryJournal, null);
  f.unmount(); await f.advance(300);
}

(async () => {
  let failed = 0;
  for (const [name, options] of [
    ['stale terminal journal is reverified after confirmed close without OFF/ON', {}],
    ['duplicate close signals create one replacement listener', { duplicate: true }],
    ['voluntary OFF vetoes automatic recovery', { off: true }],
    ['another active SOS prevents recovery', { otherActive: true }],
    ['uncorrelated unknown INSERT stays uncertain', { unknown: true }],
    ['account change vetoes pending recovery', { changedAccount: true }],
  ]) {
    try { await scenario(options); console.log('PASS ' + name); }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
  }
  try { await rebound(); console.log('PASS verified close rebinds the same local uncertain attempt through recovery'); }
  catch (error) { failed++; console.log('FAIL verified close rebinds the same local uncertain attempt: ' + error.message); }
  if (failed) process.exitCode = 1;
})();
