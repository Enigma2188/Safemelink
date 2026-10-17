const assert = require('node:assert/strict');
const { fixture } = require('./test-voice-lifecycle.cjs');
const cases = [
  ['close invalidates stale persisted SOS recovery read', async () => {
    const f = fixture({deferSOSRead:true}); await f.advance(250); f.enable(); await f.advance(250);
    f.runtime.notifySOSClosed('account-A','old');
    f.resolveSOSRead([{id:'old',isActive:true,remoteStatus:'open'}]);
    await f.advance(2000); assert.equal(f.starts,1); assert.equal(f.status,'listening');
    f.unmount(); await f.advance(300);
  }],
  ['late close cannot resume a different active emergency', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
    f.runtime.notifySOSExecutionStarted('account-A');
    f.runtime.notifySOSCompleted('account-A',{event:{id:'new-emergency',remoteSosId:'remote-new'}},f.runtime.getSOSAttempt('account-A').attemptId);
    f.runtime.notifySOSClosed('account-A','old-emergency');
    await f.advance(2000); assert.equal(f.starts,1);
    f.runtime.notifySOSClosed('account-A','new-emergency');
    f.runtime.notifySOSClosed('account-A','new-emergency');
    await f.advance(2000); assert.equal(f.starts,2);
    f.unmount(); await f.advance(300);
  }],
  ['uncertain SOS failure remains suspended', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
    f.runtime.notifySOSExecutionStarted('account-A');
    f.runtime.notifySOSFailed('account-A', new Error('synthetic uncertain result'),f.runtime.getSOSAttempt('account-A').attemptId);
    await f.advance(40000); assert.equal(f.starts,1); assert.equal(f.status,'sos_uncertain');
    f.disable(); f.runtime.notifySOSClosed('account-A'); await f.advance(2000);
    assert.equal(f.starts,1); f.unmount(); await f.advance(300);
  }],
  ['OFF during slow-error retry cancels replacement', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
    await f.advance(4000); f.events.error({error:'network'}); f.disable();
    await f.advance(40000); assert.equal(f.starts,1); assert.equal(f.status,'off');
    f.unmount(); await f.advance(300);
  }],
  ['account change during permission wait', async () => {
    const f = fixture({ deferPermission: true });
    await f.advance(250); f.enable(); await f.advance(250);
    f.changeAccountBeforeEffects(); f.grantPermission(); await f.advance(300);
    assert.equal(f.starts, 0); assert.equal(f.runtime.getRecognitionState('account-B'), 'off');
    f.unmount(); await f.advance(300);
  }],
  ['account change during native start confirmation', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(205);
    f.changeAccountBeforeEffects(); await f.advance(30);
    assert.equal(f.runtime.getRecognitionState('account-B'), 'off');
    f.events.result({isFinal:true, results:[{transcript:'test phrase'}]}); assert.equal(f.requests, 0);
    f.commitAccountLayoutCleanup(); await f.advance(300);
    f.unmount(); await f.advance(300);
  }],
  ['slow real errors exhaust bounded retry', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
    for (const delay of [3000,6000,12000,24000]) {
      await f.advance(4000); f.events.error({error:'network'}); await f.advance(delay + 20);
    }
    await f.advance(4000); f.events.error({error:'network'}); await f.advance(40000);
    assert.equal(f.enabled, false); assert.equal(f.starts, 5);
    f.unmount(); await f.advance(300);
  }],
  ['normal prolonged silence is not a technical failure', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
    for (let i=0;i<7;i++) { await f.advance(10000); f.events.error({error:'no-speech'}); await f.advance(1700); }
    assert.equal(f.enabled, true); assert.equal(f.status, 'listening');
    f.disable(); await f.advance(40000); assert.equal(f.status,'off');
    f.unmount(); await f.advance(300);
  }],
  ['SOS suspension survives remount and resumes only after close', async () => {
    const f = fixture(); await f.advance(250); f.enable(); await f.advance(300);
    f.runtime.notifySOSExecutionStarted('account-A'); await f.advance(300);
    f.remount(); await f.advance(2000); assert.equal(f.starts,1);
    assert.equal(f.runtime.requestSOS('account-A'),false,'active SOS cannot accept another launch');
    f.runtime.notifySOSCompleted('account-A',{event:{id:'test-sos',remoteSosId:'remote-test'}},f.runtime.getSOSAttempt('account-A').attemptId);
    f.runtime.notifySOSClosed('account-A','test-sos'); await f.advance(2000); assert.equal(f.starts,2);
    f.unmount(); await f.advance(300);
  }],
  ['persisted active SOS blocks cold recovery', async () => {
    const f = fixture(); f.setSOSEvents([{id:'existing',isActive:true,remoteStatus:'open'}]);
    await f.advance(250); f.enable(); await f.advance(2000); assert.equal(f.starts,0);
    f.setSOSEvents([]); f.runtime.notifySOSClosed('account-A','existing'); await f.advance(2000);
    assert.equal(f.starts,1); f.unmount(); await f.advance(300);
  }],
];
(async()=>{ let failed=0; for(const [name,test] of cases) {
  try { await test(); console.log('PASS '+name); } catch(error) {failed++; console.log('FAIL '+name+': '+error.message.split('\n')[0]);}
} if(failed)process.exitCode=1; })().catch(()=>{process.exitCode=1;});
