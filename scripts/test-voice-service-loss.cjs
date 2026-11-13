const assert = require('node:assert/strict');
const { fixture } = require('./test-voice-lifecycle.cjs');
(async () => {
  const starting = fixture({ deferPermission: true });
  await starting.advance(250); starting.enable(); await starting.advance(300);
  starting.loseService(); starting.grantPermission(); await starting.advance(300);
  assert.equal(starting.status, 'error', 'service loss during permission check cannot leave starting stuck');
  assert.equal(starting.starts, 0);
  starting.unmount(); await starting.advance(300);
  for (const trigger of ['end', 'result', 'start', 'background']) {
    const f = fixture();
    await f.advance(250); f.enable(); await f.advance(300);
    assert.equal(f.status, 'listening');
    f.loseService();
    if (trigger === 'result') f.events.result({ isFinal: true, results: [{ transcript: 'test phrase' }] });
    else if (trigger === 'background') f.appState('background');
    else f.events[trigger]();
    assert.equal(f.status, 'error', `${trigger}: service loss cannot leave listening visible`);
    assert.equal(f.requests, 0, 'queued result cannot trigger SOS without the foreground service');
    await f.advance(10000);
    assert.equal(f.starts, 1, 'no background restart of a missing microphone service');
    f.appState('active'); await f.advance(400);
    assert.equal(f.status, 'listening', 'foreground recovery restores the enabled session');
    assert.equal(f.starts, 2);
    f.disable(); f.events.end(); await f.advance(4000);
    assert.equal(f.status, 'off', 'manual OFF wins over service-loss recovery');
    f.unmount(); await f.advance(300);
    assert.equal(f.pendingTimers, 0);
  }
  console.log('PASS service loss: end/result/start/background report error, suppress stale SOS, recover in foreground, preserve OFF');
})().catch(error => { console.error(error); process.exitCode = 1; });
