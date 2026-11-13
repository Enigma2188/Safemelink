const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(source = fs.readFileSync('storage/ContactsStorage.ts', 'utf8')) {
  const disk = new Map(); let pauseRead = false; let release; let writes = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => {
      if (name.endsWith('/PhoneIdentity')) return { getPhoneIdentityKey: phone => phone || null };
      assert.equal(name, '@/storage/AccountScopedStorage');
      return { getAccountStorageItem: async user => { const snapshot = disk.get(user) ?? null; if (pauseRead) { pauseRead=false; await new Promise(resolve => { release=resolve; }); } return snapshot; },
        setAccountStorageItem: async (user, _key, value) => { writes++; disk.set(user, value); } };
    },
  });
  return { api: exports.ContactsStorage, disk, get writes(){return writes;}, pause(){pauseRead=true;}, release(){release();} };
}
const contact = name => ({ id:name,name,phone:'+39123456789',phoneE164:'+39123456789',priority:1,hasApp:false,preferredChannel:'sms',isLegacyLocal:false });
async function run(){
 const f=fixture();await f.api.saveContacts('A',[contact('old')]);f.pause();const read=f.api.getContacts('A');await tick();
 await f.api.saveContacts('A',[contact('new')]);f.release();await read;
 assert.equal(JSON.parse(f.disk.get('A'))[0].name,'new','late read cannot overwrite explicit save');assert.equal(f.writes,2);
 await f.api.saveContacts('B',[contact('other')]);assert.equal((await f.api.getContacts('B'))[0].name,'other');
 for(const value of [null,{},[null],[{name:3}],[{name:'bad',phone:3}]]){
  f.disk.set('A',JSON.stringify(value));await assert.rejects(f.api.getContacts('A'));assert.equal(f.disk.get('A'),JSON.stringify(value));
 }
 console.log('PASS contacts cache: stale read preserves newer save, no implicit write, account isolation and malformed data retained');
}
if(require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture,contact};
