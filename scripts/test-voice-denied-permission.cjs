const assert = require('node:assert/strict');
const { fixture } = require('./test-voice-lifecycle.cjs');
(async () => {
  const f = fixture({ permissionGranted: false });
  await f.advance(250); f.enable(); await f.advance(500);
  assert.equal(f.starts, 0, 'denied microphone must never invoke the recognizer');
  assert.equal(f.status, 'error');
  assert.equal(f.enabled, false);
  f.unmount(); await f.advance(300);
  assert.equal(f.pendingTimers, 0);
  console.log('PASS real voice lifecycle with denied permission: no recognizer start, visibly non-operational and no pending restart');
})().catch(error => { console.error(error); process.exitCode = 1; });
