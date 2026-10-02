const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const memory = {exports:{}};
vm.runInNewContext(compile(fs.readFileSync('services/GoHomeDestination.ts','utf8')), memory);
const destination=memory.exports.GoHomeDestination;
const point={latitude:1,longitude:2,label:'Test destination'};
destination.set('A',point);assert.equal(destination.get('B'),null);assert.equal(destination.get('A').label,point.label);
destination.clear();assert.equal(destination.get('A'),null);
async function scenario(saveHome) {
  let cursor=0,refCursor=0,mounted=false,homeWrites=0,backs=0;
  const states=[],refs=[];
  const jsx=(type,props)=>({type,props});
  const modules={
    react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},
      useRef:initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});},useCallback:f=>f,useEffect:f=>{if(!mounted)f();}},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Platform:{OS:'android'},KeyboardAvoidingView:'view',Pressable:'button',Text:'text'},
    'react-native-safe-area-context':{SafeAreaView:'view'},'expo-router':{useRouter:()=>({back(){backs++;}})},
    '@/backend/auth/AuthProvider':{useAuth:()=>({session:{user:{id:'A'}}})},
    '@/components/KeyboardSafeForm':{KeyboardSafeScrollView:'scroll',KeyboardSafeTextInput:'input'},
    '@/services/DestinationAddressService':{findDestinationAddress:async()=>[point]},
    '@/services/GoHomeDestination':{GoHomeDestination:destination},
    '@/storage/GoHomeStorage':{GoHomeStorage:{saveHomeLocation:async()=>{homeWrites++;}}},
  };
  const exports={};vm.runInNewContext(compile(fs.readFileSync('app/destination-address.tsx','utf8')),{exports,require:n=>{assert.ok(modules[n],n);return modules[n];}});
  const render=()=>{cursor=0;refCursor=0;const tree=exports.default();mounted=true;return tree;};
  const flatten=tree=>!tree?[]:Array.isArray(tree)?tree.flatMap(flatten):[tree,...flatten(tree.props?.children)];
  let tree=render();const input=flatten(tree).find(n=>n.type==='input');input.props.onChangeText('Test address');
  tree=render();flatten(tree).find(n=>n.type==='button').props.onPress();
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(backs,0);assert.equal(homeWrites,0);
  tree=render();const buttons=flatten(tree).filter(n=>n.type==='button');
  buttons[saveHome?2:1].props.onPress();for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(backs,1);assert.equal(homeWrites,saveHome?1:0);assert.equal(destination.get('A').label,point.label);
  destination.clear();
}
(async()=>{
  await scenario(false);await scenario(true);
  const home=fs.readFileSync('app/(tabs)/index.tsx','utf8');
  const panel=home.slice(home.indexOf("{activePanel === 'goHome' && ("));
  assert.ok(panel.indexOf('INSERISCI INDIRIZZO')<panel.indexOf('Come ti stai spostando?'));
  assert.match(home,/GoHomeDestination.get\(actionUserId\) \?\? await runGoHomeStepWithTimeout/);
  assert.match(home,/LocationService.getCurrentLocation/);
  const voice=fs.readFileSync('app/voice-protection.tsx','utf8');
  assert.match(voice,/voiceCommandIsStop \? deactivateProtection\(\) : activateProtection\(\)/);
  assert.match(voice,/!voiceCommandIsStop && \(isSaving \|\| !settings.passphrase\)/);
  const neighborhood=fs.readFileSync('screens/NeighborhoodNetworkScreen.tsx','utf8');
  assert.match(neighborhood,/isAdmin \? <PrimaryButton[^\n]*INVITA UN VICINO[^\n]*setActiveTab\('invites'\)/);
  console.log('PASS actual address handlers: search, temporary confirmation/back, optional Casa; owner isolation, visible CTA, separate GPS, OFF accessible, admin invite');
})().catch(error=>{console.error(error);process.exitCode=1;});
