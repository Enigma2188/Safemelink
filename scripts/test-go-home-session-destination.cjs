/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'app/(tabs)/index.tsx'), 'utf8');
const arm = home.slice(home.indexOf('const session: ActiveGoHomeSession = {'), home.indexOf('pendingSession = session;'));
assert.match(arm, /destination:/, 'Active trip must persist its selected destination, not only an ETA');
assert.match(home, /goHomeSession\.destination\?\.label/);
const memory = new Map();
function load() {
  const exported = {};
  const api = {
    getAccountStorageItem: async (user,key) => memory.get(`${user}:${key}`) ?? null,
    setAccountStorageItem: async (user,key,value) => { memory.set(`${user}:${key}`,value); },
    removeAccountStorageItem: async (user,key) => { memory.delete(`${user}:${key}`); },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root,'storage/GoHomeStorage.ts'),'utf8'), {
    compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code,{exports:exported,require:n=>{assert.equal(n,'@/storage/AccountScopedStorage');return api;},Date,Map,JSON});
  return exported.GoHomeStorage;
}
async function main() {
  const session={active:true,id:'synthetic-trip',createdAt:'2026-11-12T10:00:00.000Z',startedAt:'2026-11-12T10:00:00.000Z',expiresAt:'2026-11-12T10:20:00.000Z',distanceKm:2,estimatedMinutes:20,transportMode:'walking',destination:{latitude:1,longitude:2,label:'Synthetic trip destination'}};
  await load().saveActive('A',session);
  const restored=await load().getActive('A');
  assert.equal(restored.destination.label,session.destination.label);
  assert.equal(restored.destination.latitude,1);assert.equal(restored.destination.longitude,2);
  assert.equal(restored.expiresAt,session.expiresAt);assert.equal(restored.startedAt,session.startedAt);
  assert.equal(await load().getActive('B'),null);
  assert.equal(memory.has('A:go-home-homeLocation'),false,'Selecting a temporary trip must not overwrite saved Casa');
  assert.equal(Object.hasOwn(restored,'startLocation'),false,'No new personal GPS snapshot');
  const legacy={...session};delete legacy.destination;
  memory.set('A:go-home-active',JSON.stringify(legacy));
  const old=await load().getActive('A');assert.equal(old.id,session.id);assert.equal(old.destination,undefined);
  memory.set('A:go-home-active',JSON.stringify({...session,destination:{latitude:999,longitude:2,label:'Invalid'}}));
  const degraded=await load().getActive('A');assert.equal(degraded.expiresAt,session.expiresAt);assert.equal(degraded.destination,undefined,'Bad optional metadata must not cancel an armed safety session');
  await load().saveActive('A',session);await load().saveCompleted('A',await load().getActive('A'));
  const history=JSON.parse(memory.get('A:go-home-events'));assert.equal(Object.hasOwn(history[0].session,'destination'),false,'No extra destination copy in completed history');
  await load().clearActive('A');assert.equal(await load().getActive('A'),null);
  console.log('PASS active destination survives restart, is owner-scoped, preserves original timers, tolerates legacy/corrupt optional data and does not overwrite Casa or extend history');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
