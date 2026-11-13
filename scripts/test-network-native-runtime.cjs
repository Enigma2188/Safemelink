/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'services/NetworkV2AppGate.ts'),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:exported});
assert.throws(()=>exported.createNetworkV2OperationId(),/Secure operation/);
let calls=0;
const make=()=>exported.createNetworkV2OperationId(bytes=>{calls++;crypto.webcrypto.getRandomValues(bytes);});
const ids=new Set(Array.from({length:100},make));assert.equal(ids.size,100);assert.equal(calls,100);
for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.throws(()=>exported.createNetworkV2OperationId(()=>{throw new Error('native unavailable');}),/native unavailable/);
const screen=fs.readFileSync(path.join(root,'screens/NetworkAppScreen.native.tsx'),'utf8');
assert.match(screen,/import \{ getRandomValues \} from 'expo-crypto'/);
assert.match(screen,/createOperationId: \(\) => createNetworkV2OperationId\(bytes => \{ getRandomValues\(bytes\); \}\)/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).dependencies['expo-crypto'],'~15.0.8');
const moduleRoot=path.dirname(require.resolve('expo-crypto/package.json'));
assert.match(fs.readFileSync(path.join(moduleRoot,'android/src/main/java/expo/modules/crypto/CryptoModule.kt'),'utf8'),/SecureRandom/);
const configFactory=require('../app.config.js');
const envBefore=process.env.SAFEMELINK_ANDROID_MAPS_API_KEY;
try {
 for(const value of ['', '${MISSING}', 'process.env.KEY']) {
  process.env.SAFEMELINK_ANDROID_MAPS_API_KEY=value;
  assert.equal(configFactory({config:{}}).extra.androidMapsConfigured,false);
 }
 process.env.SAFEMELINK_ANDROID_MAPS_API_KEY='synthetic-maps-configuration';
 const generated=configFactory({config:{extra:{keep:true}}});
 assert.equal(generated.extra.androidMapsConfigured,true);assert.equal(generated.extra.keep,true);
 assert.equal(generated.android.config.googleMaps.apiKey,'synthetic-maps-configuration');
} finally {if(envBefore===undefined)delete process.env.SAFEMELINK_ANDROID_MAPS_API_KEY;else process.env.SAFEMELINK_ANDROID_MAPS_API_KEY=envBefore;}
const workflow=fs.readFileSync(path.join(root,'.github/workflows/android-test-apk.yml'),'utf8');
assert.match(workflow,/network_v2:[\s\S]*?default: false/);
for(const step of ['Generate the ephemeral Android project','Build standalone test APK']){
 const block=workflow.split('      - name: '+step)[1].split('\n      - name:')[0];
 assert.match(block,/SAFEMELINK_ANDROID_MAPS_API_KEY: \$\{\{ secrets\.SAFEMELINK_ANDROID_MAPS_API_KEY \}\}/);
}
assert.match(workflow,/NETWORK V2 requires SAFEMELINK_ANDROID_MAPS_API_KEY/);
console.log('PASS native entropy injection without global crypto, fail-closed errors, installed native source, map config and manual default-OFF workflow (not native execution)');
