const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {execFileSync}=require('node:child_process');
const {fixture}=require('./test-voice-lifecycle.cjs');
function runtime(baseline=false) {
  const source=baseline?execFileSync('git',['show','fa4644a861732b30d2c7096b2582095374cc8f98:services/VoiceProtectionRuntime.ts'],{encoding:'utf8'}):fs.readFileSync('services/VoiceProtectionRuntime.ts','utf8');
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:()=>({VoiceSOSRecoveryStorage:{save:async()=>{}}}),console:{info(){},warn(){}},Date,Math,setTimeout,clearTimeout,queueMicrotask});
  return exports.VoiceProtectionRuntime;
}
const baseline=process.argv.includes('--baseline');
const cases=[
 ['old closure cannot release a new pending attempt',async()=>{
   const r=runtime(baseline); let closed=0;r.onSOSClosed(()=>closed++);
   r.notifySOSExecutionStarted('A');r.notifySOSClosed('A','old');assert.equal(closed,0);
 }],
 ['stale completion is rejected',async()=>{
   const r=runtime(baseline);const old=r.notifySOSExecutionStarted('A');r.notifySOSExecutionStarted('A');
   let completions=0;r.onSOSCompleted(()=>completions++);
   r.notifySOSCompleted('A',{event:{id:'old'}},old);assert.equal(completions,0);
 }],
];
if(!baseline)cases.push(
 ['out-of-order server response cannot replace newer verification',async()=>{
   const f=fixture({deferRemote:true});await f.advance(250);f.enable();await f.advance(300);
   f.runtime.notifySettingsChanged('account-A');await f.advance(300);
   f.resolveRemoteAt(1,[]);await f.advance(300);assert.equal(f.status,'listening');
   f.resolveRemoteAt(0,[{id:'stale',user_id:'account-A',status:'open'}]);await f.advance(300);
   assert.equal(f.status,'listening');assert.equal(f.starts,1);f.unmount();await f.advance(300);
 }],
 ['repository rejects partial and cross-owner read results',async()=>{
   for(const data of [null,[{id:'bad',user_id:'B',status:'open'}],[{id:'bad',user_id:'A',status:'closed'}]]) {
     const query={select(){return this;},eq(){return this;},in(){return this;},limit(){return this;},abortSignal(){return this;},then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject);}};
     const exports={};const source=fs.readFileSync('backend/repositories/SOSRepository.ts','utf8');
     vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
       {exports,require:name=>name.includes('BackendError')?{BackendError:class extends Error {},classifyBackendError:()=> 'unknown'}:{requireSupabaseClient:()=>({from:()=>query})},AbortController,setTimeout,clearTimeout});
     await assert.rejects(exports.SOSRepository.findOwnActiveForVoiceRecovery('A'));
   }
 }],
 ['ordinary engine retries do not become server polling',async()=>{
   const f=fixture();await f.advance(250);f.enable();await f.advance(300);
   const queries=f.remoteQueries;f.events.error({error:'network'});await f.advance(3300);
   assert.equal(f.status,'listening');assert.equal(f.remoteQueries,queries);f.unmount();await f.advance(300);
 }],
 ['cold uncertain journal survives an unrelated closure',async()=>{
   const f=fixture();f.setRecoveryJournal({attemptId:'persisted',eventId:null,remoteId:null,phase:'unknown'});
   f.runtime.notifySOSClosed('account-A','old');await f.advance(250);f.enable();await f.advance(1000);
   assert.equal(f.starts,0);assert.equal(f.status,'sos_uncertain');f.unmount();await f.advance(300);
 }],
 ['known ID with wrong server owner cannot authorize restart',async()=>{
   const f=fixture();f.setRecoveryJournal({attemptId:'persisted',eventId:'event',remoteId:'remote',phase:'active'});
   f.setRemoteStatus({is_owner:false});await f.advance(250);f.enable();await f.advance(1000);
   assert.equal(f.starts,0);assert.equal(f.status,'sos_uncertain');f.unmount();await f.advance(300);
 }],
 ['remote SOS blocks empty local storage',async()=>{
   const f=fixture();f.setRemoteActive([{id:'remote',user_id:'account-A',status:'open'}]);
   await f.advance(250);f.enable();await f.advance(1000);assert.equal(f.starts,0);assert.equal(f.status,'sos_active');f.unmount();await f.advance(300);
 }],
 ['unknown response and pending insert cannot be cleared by empty SELECT',async()=>{
   const f=fixture();await f.advance(250);f.enable();await f.advance(300);
   const attempt=f.runtime.notifySOSExecutionStarted('account-A');
   f.runtime.notifySOSFailed('account-A',new Error('synthetic'),attempt);
   f.runtime.notifySettingsChanged('account-A');await f.advance(1000);
   assert.equal(f.starts,1);assert.equal(f.status,'sos_uncertain');
   f.runtime.notifySOSClosed('account-A','old');assert.equal(f.runtime.isSOSSuspended('account-A'),true);f.unmount();await f.advance(300);
 }],
 ['fresh offline session remains usable without claiming server absence',async()=>{
   const f=fixture();f.setRemoteFailure(new TypeError('synthetic offline'));await f.advance(250);f.enable();await f.advance(300);
   assert.equal(f.status,'listening');f.unmount();await f.advance(300);
 }],
 ['offline known SOS stays suspended and terminal server recovery resumes',async()=>{
   const f=fixture();await f.advance(250);f.enable();await f.advance(300);
   const attempt=f.runtime.notifySOSExecutionStarted('account-A');
   f.runtime.notifySOSCompleted('account-A',{event:{id:'event',remoteSosId:'remote'}},attempt);
   f.setRemoteFailure(new TypeError('synthetic offline'));f.runtime.notifySettingsChanged('account-A');await f.advance(1000);
   assert.equal(f.status,'sos_uncertain');assert.equal(f.starts,1);
   f.setRemoteFailure(null);f.runtime.notifySettingsChanged('account-A');await f.advance(1000);
   assert.equal(f.status,'listening');assert.equal(f.starts,2);f.unmount();await f.advance(300);
 }],
 ['account change and OFF discard late server reads',async()=>{
   for(const changeAccount of [true,false]) {
     const f=fixture({deferRemote:true});await f.advance(250);f.enable();await f.advance(300);
     if(changeAccount)f.changeAccountBeforeEffects();else f.disable();
     f.resolveRemote([]);await f.advance(1000);assert.equal(f.starts,0);assert.equal(f.runtime.getRecognitionState('account-B'),'off');
     f.unmount();await f.advance(300);
   }
 }],
 ['runtime veto survives failed persistence or failed service stop',async()=>{
   for(const options of [{failSave:true},{failServiceStop:true}]) {
     const f=fixture(options);await f.advance(250);f.enable();await f.advance(300);
     for(const delay of [3000,6000,12000,24000]){await f.advance(4000);f.events.error({error:'network'});await f.advance(delay+20);}
     await f.advance(4000);f.events.error({error:'network'});await f.advance(300);
     f.appState('active');f.runtime.notifySettingsChanged('account-A');await f.advance(40000);
     assert.equal(f.starts,5);assert.equal(f.runtime.isRecognitionStopped('account-A'),true);f.unmount();await f.advance(300);
   }
 }],
 ['UI states and indicator reflect native listening, writer unchanged',async()=>{
   const ui=fs.readFileSync('app/voice-protection.tsx','utf8');
   for(const label of ['DISATTIVATA','IN ASCOLTO','VERIFICA SOS','SOS ATTIVO','ESITO SOS INCERTO','ASCOLTO NON OPERATIVO','RIPRISTINO IN CORSO'])assert.ok(ui.includes(label));
   assert.ok(ui.includes("recognitionState === 'listening' && settings.enabled && styles.microphoneReady"));
   const home=fs.readFileSync('app/(tabs)/index.tsx','utf8');
   assert.ok(home.includes('notifySOSClosed(trackedUserId, trackedEvent.id, trackedEvent.remoteSosId)'));
   assert.ok(home.includes('notifySOSClosed(loadUserId, verifiedTerminalEvent.id, verifiedTerminalEvent.remoteSosId)'));
   const repo=fs.readFileSync('backend/repositories/SOSRepository.ts','utf8');
   const old=execFileSync('git',['show','fa4644a861732b30d2c7096b2582095374cc8f98:backend/repositories/SOSRepository.ts'],{encoding:'utf8'});
   assert.equal(repo.slice(repo.indexOf('  async create(')).replace(/\r\n/g,'\n'),old.slice(old.indexOf('  async create(')).replace(/\r\n/g,'\n'));
 }]);
(async()=>{let failed=0;for(const [name,test]of cases){try{await test();console.log('PASS '+name);}catch(error){failed++;console.log('FAIL '+name+': '+error.message.split('\n')[0]);}}if(failed)process.exitCode=1;})().catch(()=>{process.exitCode=1;});
