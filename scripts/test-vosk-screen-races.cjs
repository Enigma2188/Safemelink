const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const flush = async () => { for (let i=0; i<30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let index = 0, tree, user = 'A';
  const slots = [], effects = [], permissionRequests = [], calls = { starts: 0, stops: 0 };
  const hooks = {
    useState: initial => { const i=index++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], v=>{ slots[i]=v; }]; },
    useRef: initial => { const i=index++; if (!(i in slots)) slots[i]={ current:initial }; return slots[i]; },
    useEffect: (fn,deps) => { const i=index++, old=slots[i]; if (!old || deps.some((v,j)=>v!==old.deps[j])) { slots[i]={deps}; effects.push(()=>{ old?.cleanup?.(); slots[i].cleanup=fn(); }); } },
  };
  const jsx = (type,props)=>({type,props});
  const deps = { react:hooks, 'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Platform:{OS:'android',Version:35},Pressable:'button',ScrollView:'scroll',Text:'text',TextInput:'input',View:'view'},
    'expo-notifications':{getPermissionsAsync:async()=>({granted:true})},
    'expo-speech-recognition':{ExpoSpeechRecognitionModule:{getMicrophonePermissionsAsync:()=>{ const wait=deferred(); permissionRequests.push(wait); return wait.promise; }}},
    'expo-router':{Link:'link'}, '@/backend/auth/AuthProvider':{useAuth:()=>({session:{user:{id:user}}})},
    '@/services/VoiceLabCoordinator':{readVoiceLab:()=>({state:'OFF',busy:false,reason:'',detections:0}),voiceLabEnabled:()=>true,
      resetVoiceLabCounts(){},stopVoiceLab:()=>{calls.stops++;},VoiceLabStartError:class extends Error {},
      startVoiceLab:async(_id,_phrase,current)=>{assert.ok(current()); calls.starts++;}},
  };
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${process.env.SML_REVIEW_BASE || '.'}/app/voice-lab.tsx`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:id=>{assert.ok(id in deps,id); return deps[id];},process:{env:{}},setInterval:()=>1,clearInterval(){}});
  const render=()=>{index=0;tree=exports.default();while(effects.length)effects.shift()();};
  function find(n,test){if(!n)return null;if(Array.isArray(n))return n.map(x=>find(x,test)).find(Boolean);if(test(n))return n;return find(n.props?.children,test);}
  const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
  const button=label=>find(tree,n=>n.type==='button'&&text(n).includes(label));
  render();render();find(tree,n=>n.type==='input').props.onChangeText('frase test');render();
  return {calls,permissionRequests,render,button,setUser:v=>{user=v;render();render();}};
}
(async()=>{
  const double=fixture(), press=double.button('Avvia').props.onPress; press();press();
  assert.equal(double.permissionRequests.length,1,'same-frame double tap must create one permission sequence');
  double.permissionRequests[0].resolve({granted:true});await flush();assert.equal(double.calls.starts,1);
  const f=fixture();f.button('Avvia').props.onPress();f.render();f.button('Ferma').props.onPress();f.render();
  f.button('Avvia').props.onPress();f.render();assert.equal(f.permissionRequests.length,2);
  f.permissionRequests[0].resolve({granted:true});await flush();f.render();
  assert.equal(f.button('Verifica').props.disabled,true,'old finally must not unlock the newer request');
  assert.equal(f.calls.starts,0);f.permissionRequests[1].resolve({granted:true});await flush();assert.equal(f.calls.starts,1);
  const account=fixture();account.button('Avvia').props.onPress();account.setUser('B');account.permissionRequests[0].resolve({granted:true});await flush();assert.equal(account.calls.starts,0);
  console.log('PASS Vosk actual screen handlers: same-frame taps, Stop/start with late permission, account change');
})().catch(e=>{console.error(e);process.exitCode=1;});
