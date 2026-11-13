'use strict';
/* global __dirname */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');let passed=0;
function test(name,run){run();passed++;console.log('PASS '+name);}
function loader(context,file,deps={}){
  context.exports={};context.require=name=>{assert.ok(Object.hasOwn(deps,name),`Unexpected dependency ${name}`);return deps[name];};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInContext(`(function(exports,require){${code}\n})(exports,require);`,context);return context.exports;
}
test('release switch is explicit default OFF and secure IDs have no weak fallback',()=>{
  const context=vm.createContext({crypto:require('node:crypto').webcrypto});const gate=loader(context,'services/NetworkV2AppGate.ts');
  for(const value of [undefined,null,false,true,'TRUE','1','false',' true'])assert.equal(gate.networkV2Enabled(value),false);
  assert.equal(gate.networkV2Enabled('true'),true);
  const ids=new Set(Array.from({length:100},()=>gate.createNetworkV2OperationId()));assert.equal(ids.size,100);
  for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  context.crypto=undefined;assert.throws(()=>gate.createNetworkV2OperationId());
});
test('native route creates no SDK/composition with gate OFF and retains one owner across navigation',()=>{
  const context=vm.createContext({process:{env:{}}});const gate=loader(context,'services/NetworkV2AppGate.ts');
  let sdkCalls=0,created=0,mode=false,configured=false;const client={};const owner={runtime:{},social:{}};
  const element=(type,props)=>({type,props:props||{}});const flat=x=>!x||typeof x!=='object'?[]:Array.isArray(x)?x.flatMap(flat):[x,...flat(x.props?.children)];
  const module=loader(context,'screens/NetworkAppScreen.native.tsx',{
    react:{useState:init=>typeof init==='function'?[init(),()=>{}]:[mode,()=>{mode=!mode;}]},'react/jsx-runtime':{jsx:element,jsxs:element},
    'react-native':{Platform:{OS:'android'},Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
    'expo-crypto':{getRandomValues:bytes=>require('node:crypto').webcrypto.getRandomValues(bytes)},
    'expo-router':{useRouter:()=>({back(){}})},'expo-constants':{default:{get expoConfig(){return{extra:{androidMapsConfigured:configured}};}}},
    '@react-native-async-storage/async-storage':{default:{}},
    '@/backend/supabaseClient':{getSupabaseClient(){sdkCalls++;return client;}},
    '@/services/NetworkV2Composition':{createNetworkV2AppComposition(options){created++;assert.equal(options.client,client);assert.equal(options.enabled,true);assert.equal(options.initialRegion.latitudeDelta,120);assert.match(options.createOperationId(),/^[0-9a-f-]{36}$/);return owner;}},
    '@/services/NetworkV2AppGate':gate,'./NetworkScreen':{NetworkScreen:'Legacy'},'./NetworkV2Entry.native':{NetworkV2Entry:'RealV2'}
  });
  assert.equal(module.NetworkAppScreen().type,'Legacy');assert.equal(sdkCalls,0);assert.equal(created,0);
  context.process.env.EXPO_PUBLIC_NETWORK_V2_ENABLED='true';let tree=module.NetworkAppScreen();let view=flat(tree).find(x=>x.type==='RealV2');
  assert.equal(view.props.composition,owner);assert.equal(view.props.configuration,'MISSING');
  configured=true;view=flat(module.NetworkAppScreen()).find(x=>x.type==='RealV2');assert.equal(view.props.configuration,'READY');
  assert.equal(created,1);assert.equal(sdkCalls,1);
  flat(tree).find(x=>x.type==='Pressable').props.onPress();assert.ok(flat(module.NetworkAppScreen()).some(x=>x.type==='Legacy'));
  assert.equal(created,1);
});
test('platform route preserves Web legacy and has no demo/emergency dependency or automatic feature activation',()=>{
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  assert.match(read('app/network.tsx'),/NetworkAppScreen/);
  assert.match(read('screens/NetworkAppScreen.tsx'),/NetworkScreen/);assert.doesNotMatch(read('screens/NetworkAppScreen.tsx'),/native'|react-native-maps/);
  for(const p of ['screens/NetworkAppScreen.native.tsx','services/NetworkV2AppGate.ts'])assert.doesNotMatch(read(p),/NetworkPrototype|NETWORK_DEMO|SOSService|Checkpoint|sendSms|expo-location|Math\.random/);
  assert.match(read('services/NetworkCategoryRegistryV2.ts'),/label: 'Servizi pubblici'/);
});
test('history and lifecycle adapters match existing SQL signatures without changing migrations',()=>{
  const repo=fs.readFileSync(path.join(root,'backend/repositories/NetworkV2Repository.ts'),'utf8');
  const history=fs.readFileSync(path.join(root,'supabase/migrations/20261103120000_network_territorial_map_history.sql'),'utf8');
  const events=fs.readFileSync(path.join(root,'supabase/migrations/20261107120000_network_event_markers_v2.sql'),'utf8');
  for(const arg of ['target_territory','target_zone','page_size','cursor_month','cursor_entry']){assert.ok(repo.includes(arg));assert.ok(history.includes(arg));}
  assert.match(events,/where public_id=target_public_id and author_user_id=actor for update/);
  assert.match(repo,/nextCursor/);assert.match(repo,/Geometry, aggregate bands and periods are deliberately not copied/);
});
test('real entry blocks the write UI during recovery and keeps default OFF/fallback safe',()=>{
  const context=vm.createContext({});const element=(type,props)=>({type,props:props||{}});
  const state={phase:'BLOCKED',pending:{},notice:'Synthetic recovery',recoveredEvent:null};let starts=0;
  const api=loader(context,'screens/NetworkV2Entry.native.tsx',{
    react:{useEffect:fn=>{fn();},useSyncExternalStore:(_sub,get)=>get()},'react/jsx-runtime':{jsx:element,jsxs:element},'react-native':{Text:'Text',View:'View'},
    '@/components/network/NetworkSocialPanel.native':{NetworkSocialPanel:'Social'},'./NetworkV2Screen.native':{NetworkV2Screen:'Screen'},
    '@/services/NetworkWriteRecovery':{EMPTY_NETWORK_RECOVERY:{phase:'OFF'}},'@/components/network/NetworkRecoveryPanel.native':{NetworkRecoveryPanel:'Recovery'}
  });
  const composition={start(){starts++;},social:{suspend(){}},recovery:{subscribe(){return()=>{};},getState:()=>state}};
  assert.equal(api.NetworkV2Entry({composition,configuration:'MISSING'}).type,'Recovery');assert.equal(starts,1);
  state.phase='READY';state.notice=null;assert.equal(api.NetworkV2Entry({composition,configuration:'READY'}).type,'View');
});
test('late-attempt fencing requires the explicit confirmation button, never rendering or a first tap',()=>{
  const context=vm.createContext({});const element=(type,props)=>({type,props:props||{}});let dialog=null,resolved=false;
  const api=loader(context,'components/network/NetworkRecoveryPanel.native.tsx',{'react/jsx-runtime':{jsx:element,jsxs:element},
    'react-native':{Alert:{alert:(_t,_b,buttons)=>{dialog=buttons;}},Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:x=>x}}});
  const flat=x=>!x||typeof x!=='object'?[]:Array.isArray(x)?x.flatMap(flat):[x,...flat(x.props?.children)];
  const text=x=>typeof x==='string'?x:Array.isArray(x)?x.map(text).join(''):x?.props?text(x.props.children):'';
  const tree=api.NetworkRecoveryPanel({recovery:{resolve:value=>{resolved=value;},reload(){}},state:{phase:'BLOCKED',pending:{rpc:'create_network_event_v2'},notice:null}});
  assert.equal(resolved,false);flat(tree).find(n=>n.type==='Button'&&text(n)==='Impedisci un invio tardivo').props.onPress();assert.equal(resolved,false);
  dialog.find(b=>b.text==='Conferma').onPress();assert.equal(resolved,true);
});
console.log(`${passed} application wiring checks PASS. No SDK requests, native rendering, SQL or build executed.`);
