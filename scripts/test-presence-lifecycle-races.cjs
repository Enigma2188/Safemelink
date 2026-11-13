const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const flush = async () => { for(let i=0;i<70;i++) await Promise.resolve(); };
function load(file, modules, globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:name=>{assert.ok(modules[name],name);return modules[name];},Date,setTimeout,clearTimeout,console:{info(){},warn(){}},...globals});return exports;
}
async function nearby() {
 let releaseGPS, releaseTask, holdGPS=true, holdTask=true, running=false, publishes=0, cacheWrites=0;
 const point={timestamp:Date.now(),coords:{latitude:44,longitude:10,accuracy:5}};
 const api=load('services/SOSNetworkPresenceService.ts',{
  'react-native':{Platform:{OS:'android'}},'expo-notifications':{},
  'expo-task-manager':{isAvailableAsync:async()=>{if(holdTask){holdTask=false;await new Promise(r=>{releaseTask=r;});}return true;}},
  'expo-location':{Accuracy:{High:6,Balanced:3},ActivityType:{Other:0},
   getForegroundPermissionsAsync:async()=>({status:'granted'}),getBackgroundPermissionsAsync:async()=>({status:'granted'}),hasServicesEnabledAsync:async()=>true,
   getCurrentPositionAsync:async()=>{if(holdGPS){holdGPS=false;await new Promise(r=>{releaseGPS=r;});}return point;},
   hasStartedLocationUpdatesAsync:async()=>running,startLocationUpdatesAsync:async()=>{running=true;},stopLocationUpdatesAsync:async()=>{running=false;}},
  '@/services/SOSSessionTimeout':{getSOSSessionWithTimeout:async()=>({user:{id:'A'}})},
  '@/backend/repositories/SOSNetworkPresenceRepository':{SOSNetworkPresenceRepository:{updatePresence:async()=>{publishes++;}}},
  '@/storage/SOSNetworkLocationStorage':{SOSNetworkLocationStorage:{save:async()=>{cacheWrites++;}}},
 }).SOSNetworkPresenceService;
 const start=api.startBackgroundUpdates();await flush();const stop=api.stopBackgroundUpdates();releaseTask();await Promise.all([start,stop]);assert.equal(running,false);
 await api.startBackgroundUpdates();assert.equal(running,true);
 const publish=api.publishForegroundPresence('A');await flush();await api.stopBackgroundUpdates();releaseGPS();assert.equal(await publish,false);assert.equal(publishes,0);assert.equal(cacheWrites,0);
 assert.equal(await api.publishBackgroundLocation(point,'A'),false);
 await api.startBackgroundUpdates();assert.equal(await api.publishBackgroundLocation({...point,coords:{...point.coords,latitude:NaN}},'A'),false);
 assert.equal(await api.publishBackgroundLocation(point,'A'),true);assert.equal(publishes,1);assert.equal(cacheWrites,1);
}
async function neighborhood(holdLocation) {
 let gpsRelease,rpcRelease,holdGPS=holdLocation,holdRPC=!holdLocation,pref=false,published=0;const calls=[];
 const api=load('services/NeighborhoodNetworkService.ts',{
  '@/backend/auth/AuthService':{AuthService:{getSession:async()=>({user:{id:'A'}})}},
  '@/services/LocationService':{LocationService:{getCurrentLocation:async()=>{if(holdGPS){holdGPS=false;await new Promise(r=>{gpsRelease=r;});}return{latitude:44,longitude:10,accuracy:5,observedAt:new Date().toISOString(),source:'fresh'};}}},
  '@/backend/repositories/NeighborhoodNetworkRepository':{NeighborhoodNetworkRepository:{
   setDiscoveryPreference:async(_user,value)=>{calls.push(value);if(value&&holdRPC){holdRPC=false;await new Promise(r=>{rpcRelease=r;});}pref=value;},
   publishDiscoveryPresence:async()=>{published++;},
  }},
 }).NeighborhoodNetworkService;
 const on=api.setDiscoveryPreference('A',true);await flush();const off=api.setDiscoveryPreference('A',false);await flush();
 if(holdLocation){assert.equal(pref,false);gpsRelease();}else rpcRelease();
 await Promise.all([on,off]);assert.equal(pref,false);assert.equal(published,0);assert.equal(calls.at(-1),false);
}
async function timeout() {
 let fire,aborted=false;class TimeoutBackendError extends Error{}
 const api=load('backend/repositories/SOSNetworkPresenceRepository.ts',{
  '@/backend/errors/BackendError':{createBackendError:()=>new TimeoutBackendError()},
  '@/backend/supabaseClient':{requireSupabaseClient:()=>({rpc:()=>({abortSignal:signal=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}})})},
 },{AbortController,setTimeout:fn=>{fire=fn;return 1;},clearTimeout(){}});
 const request=api.SOSNetworkPresenceRepository.getPreference();const rejection=assert.rejects(request,error=>error instanceof api.SOSNetworkPresenceTimeoutError);fire();await rejection;assert.equal(aborted,true);
}
(async()=>{await nearby();await neighborhood(true);await neighborhood(false);await timeout();console.log('PASS real presence services: late start/stop, GPS after OFF, malformed fixes, neighborhood OFF wins pending GPS/RPC, abort-ignoring request timeout');})().catch(error=>{console.error(error);process.exitCode=1;});
