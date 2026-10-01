const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
async function scenario({granted=true, canAskAgain=true, contact=null, revoke=false}={}) {
  const alerts=[], picked=[], states=[], refs=[]; let cursor=0, refCursor=0, requests=0, opens=0;
  const cleanups=[];
  const exports={};
  const jsx=(type,props)=>({type,props});
  const dependencies={
    'react/jsx-runtime': {jsx,jsxs:jsx},
    react: {useState: initial=>{const i=cursor++; if(!(i in states)) states[i]=initial; return [states[i],v=>{states[i]=v;}];},
      useRef: initial=>{const i=refCursor++; return refs[i]??(refs[i]={current:initial});}, useEffect: fn=>{cleanups.push(fn());}},
    'react-native': {AppState:{addEventListener:()=>({remove(){}})},Alert:{alert:(...args)=>alerts.push(args)},Linking:{openSettings:async()=>{}},Pressable:'button',Text:'text',View:'view'},
    'expo-contacts': {getPermissionsAsync:async()=>({granted,canAskAgain}),requestPermissionsAsync:async()=>{requests++;return {granted:false,canAskAgain:false};},
      presentContactPickerAsync:async()=>{opens++;if(revoke) cleanups.forEach(fn=>fn?.());return contact;}},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/ContactPickerButton.tsx','utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports, require:n=>{assert.ok(dependencies[n],n);return dependencies[n];}});
  const tree=exports.ContactPickerButton({disabled:false,onPick:(...args)=>picked.push(args)});
  assert.equal(requests,0,'no permission request on mount');
  tree.props.children[0].props.onPress();
  for(let i=0;i<20;i++) await Promise.resolve();
  return {alerts,picked,states,requests,opens};
}
(async()=>{
  let f=await scenario({granted:false});assert.equal(f.requests,1);assert.equal(f.opens,0);
  f=await scenario({granted:false,canAskAgain:false});assert.equal(f.requests,0);assert.equal(f.opens,0);
  f=await scenario();assert.equal(f.picked.length,0,'cancel keeps existing fields');
  f=await scenario({contact:{name:'fixture',phoneNumbers:[]}});assert.equal(f.alerts[0][0],'Nessun telefono');
  f=await scenario({contact:{name:'fixture',phoneNumbers:[{number:'+11111111'}]}});
  assert.equal(f.picked.length,0,'selection alone never overwrites fields');
  f.alerts[0][2][1].onPress();assert.deepEqual(f.picked,[['fixture','+11111111']]);
  f=await scenario({contact:{name:'fixture',phoneNumbers:[{number:'+11111111'},{number:'+22222222'}]}});
  assert.equal(f.states[2].numbers.length,2);assert.equal(f.picked.length,0,'multiple numbers require explicit choice');
  f=await scenario({revoke:true,contact:{name:'fixture',phoneNumbers:[{number:'+11111111'}]}});assert.equal(f.picked.length,0);assert.equal(f.alerts.length,0);
  console.log('PASS picker: tap-only permission, denied/permanent denial, cancel, no phone, single/multiple phones, confirmation, account unmount');
})().catch(e=>{console.error(e);process.exitCode=1;});
