const assert = require('node:assert/strict');
const { fixture } = require('./test-voice-lifecycle.cjs');

async function scenario({ off = false, active = false, unknown = false, fail = false } = {}) {
  const f = fixture({ failServiceRestore: fail });
  await f.advance(250); f.enable(); await f.advance(300);
  const attempt = f.runtime.notifySOSExecutionStarted('account-A');
  f.runtime.notifySOSCompleted('account-A', {
    event: { id: 'local', ...(unknown ? {} : { remoteSosId: 'remote' }) },
    pushResult: { reason: unknown ? 'remote_creation_timeout' : 'sent' },
  }, attempt);
  await f.advance(300); f.loseService();
  if (active) f.setRemoteActive([{ id: 'other', status: 'open' }]);
  if (off) f.disable();
  f.runtime.notifySOSClosed('account-A', unknown ? 'other-local' : 'local', unknown ? 'other-remote' : 'remote');
  await f.advance(3000);
  assert.equal(f.starts, !off && !active && !unknown && !fail ? 2 : 1);
  assert.equal(f.status, off ? 'off' : active ? 'sos_active' : unknown ? 'sos_uncertain' : fail ? 'error' : 'listening');
  if (fail) assert.match(f.runtime.getRecognitionFailureMessage('account-A'), /NON IN ASCOLTO/);
  if (unknown) assert.equal(f.recoveryJournal.attemptId, attempt);
  f.unmount(); await f.advance(300);
}
(async () => {
  let failed = 0;
  for (const [name, options] of [
    ['confirmed close restores missing foreground service without OFF/ON', {}],
    ['voluntary OFF forbids service restoration', { off: true }],
    ['another active SOS forbids service restoration', { active: true }],
    ['unknown SOS forbids service restoration', { unknown: true }],
    ['Android service rejection is visibly non-operational, never listening', { fail: true }],
  ]) {
    try { await scenario(options); console.log('PASS ' + name); }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
  }
  if (failed) process.exitCode = 1;
})();
