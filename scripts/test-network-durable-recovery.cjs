'use strict';
/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,deps={}){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];});return exports;}
const registry=load('services/NetworkCategoryRegistryV2.ts');
const contract=load('services/NetworkMapContractV2.ts',{'./NetworkCategoryRegistryV2':registry});
const map=load('services/NetworkMapController.ts',{'./NetworkMapContractV2':contract,'./NetworkCategoryRegistryV2':registry});
const base=load('backend/repositories/NetworkV2Repository.ts',{'@/services/NetworkMapContractV2':contract,'@/services/NetworkCategoryRegistryV2':registry,'@/services/NetworkMapController':map});
const social=load('services/NetworkSocialContractV2.ts');
const recovery=load('services/NetworkWriteRecovery.ts',{'@/backend/repositories/NetworkV2Repository':base,'./NetworkSocialContractV2':social});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const reply=data=>({data,error:null,status:200}),tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const args=()=>({target_operation:id(4),target_territory:id(5),event_latitude:0.2,event_longitude:0.3,location_selection:'EXPLICIT_EVENT_POINT',target_category:'LIGHTING',target_description:'Synthetic private pending body'});
function harness(store=new Map(),timeout=100){let owner=id(1),hook=null,storageHook=null,settled=0;const listeners=new Set(),calls=[];
 const storage={async getItem(k){if(storageHook){const v=storageHook('get',k);if(v!==undefined)return v;}return store.get(k)??null;},
  async setItem(k,v){if(storageHook){const r=storageHook('set',k,v);if(r!==undefined)return r;}store.set(k,v);},async removeItem(k){store.delete(k);}};
 const transport=async(name,a,signal)=>{calls.push({name,args:a,signal});if(hook)return hook(name,a,signal);
  return name==='resolve_my_network_operation_v2'?reply({state:'UNKNOWN',publicId:null}):reply({publicId:id(8),status:'ACTIVE',publicationState:'PENDING',replayed:false});};
 const instance=new recovery.NetworkWriteRecovery(transport,storage,{getOwner:()=>owner,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},()=>settled++,timeout);
 return{instance,store,calls,storage,hook:f=>{hook=f;},storageHook:f=>{storageHook=f;},get settled(){return settled;},change:o=>{owner=o;for(const fn of listeners)fn();}};}
async function ready(h){h.instance.start();await tick();assert.equal(h.instance.getState().phase,'READY');}
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
(async()=>{
 await test('durable barrier stores only IDs before request; validated acknowledgement clears it',async()=>{
  const h=harness();await ready(h);h.hook(()=>{const raw=[...h.store.values()][0];assert.ok(raw);for(const text of ['Synthetic','latitude','longitude','description','nickname','token'])assert.ok(!raw.includes(text));
   return reply({publicId:id(8),status:'ACTIVE',publicationState:'PENDING',replayed:false});});
  await h.instance.transport('create_network_event_v2',args(),new AbortController().signal);assert.equal(h.store.size,0);assert.equal(h.instance.getState().phase,'READY');h.instance.stop();
 });
 await test('restart after lost acknowledgement finds receipt without a duplicate create',async()=>{
  const h=harness();await ready(h);h.hook(()=>{throw Error('synthetic offline after server commit');});
  await assert.rejects(h.instance.transport('create_network_event_v2',args(),new AbortController().signal));h.instance.stop();
  const second=harness(h.store);second.hook(()=>reply({state:'FOUND',publicId:id(8)}));second.instance.start();await tick();assert.equal(second.instance.getState().phase,'BLOCKED');
  await second.instance.resolve();assert.equal(second.calls.length,1);assert.equal(second.calls[0].name,'resolve_my_network_operation_v2');assert.equal(second.store.size,0);assert.equal(second.settled,1);second.instance.stop();
 });
 await test('empty receipt stays unknown; explicit fencing is required before a new operation',async()=>{
  const h=harness();await ready(h);h.hook(()=>{throw Error('offline');});await assert.rejects(h.instance.transport('create_network_event_v2',args(),new AbortController().signal));
  await h.instance.reload();h.hook((_n,a)=>reply({state:a.prevent_late?'FENCED':'UNKNOWN',publicId:null}));
  await h.instance.resolve();assert.equal(h.store.size,1);assert.equal(h.instance.getState().phase,'BLOCKED');
  await assert.rejects(h.instance.transport('create_network_event_v2',{...args(),target_operation:id(9)},new AbortController().signal));
  await h.instance.resolve(true);assert.equal(h.store.size,0);assert.equal(h.instance.getState().phase,'READY');h.instance.stop();
 });
 await test('account change during storage wait cannot start native/HTTP work or expose old operation',async()=>{
  const h=harness(),wait=deferred();await ready(h);h.storageHook((kind,k,v)=>kind==='set'?wait.promise.then(()=>h.store.set(k,v)):undefined);
  const write=h.instance.transport('create_network_event_v2',args(),new AbortController().signal);await tick();h.change(id(2));await tick();assert.equal(h.instance.getState().pending,null);
  wait.resolve();await assert.rejects(write);assert.equal(h.calls.length,0);h.storageHook(null);await h.instance.reload();assert.equal(h.instance.getState().phase,'READY');h.instance.stop();
 });
 await test('storage timeout and corruption fail closed; no request while a late storage write is pending',async()=>{
  const h=harness(new Map(),10),wait=deferred();await ready(h);h.storageHook((kind,k,v)=>kind==='set'?wait.promise.then(()=>h.store.set(k,v)):undefined);
  await assert.rejects(h.instance.transport('create_network_event_v2',args(),new AbortController().signal));await h.instance.reload();assert.equal(h.instance.getState().phase,'ERROR');assert.equal(h.calls.length,0);
  wait.resolve();await tick();h.storageHook(null);await h.instance.reload();assert.equal(h.instance.getState().phase,'BLOCKED');h.instance.stop();
  const bad=harness(new Map([[`@safemelink/network-write/v1/${id(1)}`,'{"privateText":"not accepted"}']]));bad.instance.start();await tick();assert.equal(bad.instance.getState().phase,'ERROR');assert.equal(bad.calls.length,0);bad.instance.stop();
 });
 await test('single-flight, malformed success and cleanup retry never claim unconfirmed success',async()=>{
  const h=harness(),wait=deferred();await ready(h);h.hook(()=>wait.promise);const one=h.instance.transport('create_network_event_v2',args(),new AbortController().signal);await tick();
  await assert.rejects(h.instance.transport('create_network_event_v2',args(),new AbortController().signal));wait.resolve(reply({publicId:id(8),unexpected:true}));await one;assert.equal(h.store.size,1);h.instance.stop();
  const clean=harness();await ready(clean);clean.hook(()=>{throw Error('offline');});await assert.rejects(clean.instance.transport('finish_my_network_event_v2',{target_public_id:id(8),finish_kind:'RESOLVED'},new AbortController().signal));
  await clean.instance.reload();clean.hook(()=>reply(null));await clean.instance.resolve();assert.equal(clean.store.size,0);assert.equal(clean.calls.at(-1).args.target_public_id,id(8));clean.instance.stop();
 });
 await test('account-bound RPC rejects a switch during session wait and pins the initiating JWT header',async()=>{
  class Runtime {constructor(transport){this.transport=transport;}start(){}stop(){}dispose(){}recoverySettled(){}}
  const composition=load('services/NetworkV2Composition.ts',{'@/backend/repositories/NetworkV2Repository':base,
   '@/components/network/NetworkV2ScreenController':{NetworkV2ScreenController:Runtime},'@/components/network/NetworkSocialController':{NetworkSocialController:Runtime},'./NetworkWriteRecovery':recovery});
  let callback,wait=null,session={user:{id:id(1)},access_token:'synthetic-token-A'},calls=0,header=null,changeAtHeader=false;
  const client={auth:{getSession:()=>wait?wait.promise:Promise.resolve({data:{session},error:null}),onAuthStateChange:fn=>{callback=fn;return{data:{subscription:{unsubscribe(){}}}};}},
   rpc(){calls++;const builder={setHeader(name,value){assert.equal(name,'Authorization');header=value;if(changeAtHeader){session={user:{id:id(2)},access_token:'synthetic-token-B'};callback('SIGNED_IN',session);}return builder;},abortSignal:async()=>reply(null)};return builder;}};
  const app=composition.createNetworkV2AppComposition({enabled:true,client,createOperationId:()=>id(4),initialRegion:{latitude:0,longitude:0,latitudeDelta:1,longitudeDelta:1}});
  app.start();await tick();wait=deferred();const request=app.runtime.transport('create_network_event_v2',args(),new AbortController().signal);await tick();
  callback('SIGNED_IN',{user:{id:id(2)},access_token:'synthetic-token-B'});wait.resolve({data:{session},error:null});await assert.rejects(request);assert.equal(calls,0);
  wait=null;callback('SIGNED_IN',session);changeAtHeader=true;await app.runtime.transport('create_network_event_v2',args(),new AbortController().signal);
  assert.equal(header,'Bearer synthetic-token-A');app.dispose();
 });
 console.log(`${count} durable recovery checks PASS. Storage and network simulated; no SQL executed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
