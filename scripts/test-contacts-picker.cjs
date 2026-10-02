const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const fixtureRows = [{id:'a',name:'Anna',phoneNumbers:[{number:'+11111111'}]},
  {id:'b',name:'Bruno',phoneNumbers:[{number:'+22222222'},{number:'+33333333'}]}, {id:'c',name:'No phone'}];
async function scenario(granted=true, canAskAgain=true) {
  const states=[],refs=[],alerts=[],picked=[],cleanups=[]; let cursor=0,rc=0,mounted=false,requests=0,reads=0;
  const jsx=(type,props)=>({type,props}); const exports={};
  const modules={ 'react/jsx-runtime':{jsx,jsxs:jsx},
    react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},
      useRef:initial=>{const i=rc++;return refs[i]??(refs[i]={current:initial});},useEffect:fn=>{if(!mounted)cleanups.push(fn());}},
    'react-native':{Platform:{OS:'android'},AppState:{addEventListener:()=>({remove(){}})},Alert:{alert:(...a)=>alerts.push(a)},Linking:{openSettings:async()=>{}},
      FlatList:'list',KeyboardAvoidingView:'view',Modal:'modal',Pressable:'button',Text:'text',View:'view'},
    'react-native-safe-area-context':{SafeAreaView:'view'},'@/components/KeyboardSafeForm':{KeyboardSafeTextInput:'input'},
    'expo-contacts':{Fields:{PhoneNumbers:'phoneNumbers'},getPermissionsAsync:async()=>({granted,canAskAgain}),
      requestPermissionsAsync:async()=>{requests++;return{granted:false};},getContactsAsync:async options=>{
        reads++;assert.deepEqual(Array.from(options.fields),['phoneNumbers']);return{data:fixtureRows,hasNextPage:false};}},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/ContactPickerButton.tsx','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:n=>{assert.ok(modules[n],n);return modules[n];}});
  const render=()=>{cursor=0;rc=0;const tree=exports.ContactPickerButton({disabled:false,onPick:(...a)=>picked.push(a)});mounted=true;return tree;};
  const find=(tree,type)=>{if(!tree)return null;if(Array.isArray(tree)){for(const node of tree){const found=find(node,type);if(found)return found;}return null;}return tree.type===type?tree:find(tree.props?.children,type);};
  let tree=render();assert.equal(reads,0);assert.equal(requests,0);
  tree.props.children[0].props.onPress();for(let i=0;i<20;i++)await Promise.resolve();tree=render();
  return{render,find,tree,states,alerts,picked,reads,requests,cleanups};
}
(async()=>{
  let f=await scenario(false);assert.equal(f.requests,1);assert.equal(f.reads,0);
  f=await scenario(false,false);assert.equal(f.requests,0);assert.equal(f.reads,0);
  f=await scenario();assert.equal(f.find(f.tree,'modal').props.visible,true);
  let list=f.find(f.tree,'list');assert.equal(list.props.data.length,3);
  f.find(f.tree,'input').props.onChangeText('bruno');assert.equal(f.find(f.render(),'list').props.data.length,1);
  f.find(f.render(),'input').props.onChangeText('');
  list.props.renderItem({item:list.props.data[0]}).props.onPress();assert.equal(f.picked.length,0);
  f.alerts[0][2][1].onPress();assert.deepEqual(f.picked,[['Anna','+11111111']]);
  assert.equal(f.find(f.render(),'modal').props.visible,false);assert.equal(f.states[2].length,0);
  f=await scenario();list=f.find(f.tree,'list');list.props.renderItem({item:list.props.data[1]}).props.onPress();
  list=f.find(f.render(),'list');assert.equal(list.props.data.length,2);
  f.find(f.render(),'modal').props.onRequestClose();assert.equal(f.states[2].length,0);
  f=await scenario();list=f.find(f.tree,'list');list.props.renderItem({item:list.props.data[2]}).props.onPress();assert.equal(f.alerts[0][0],'Nessun telefono');
  console.log('PASS contacts actual UI handlers: permission, in-app modal/list/search, one/multiple numbers, explicit confirmation, cancel clears memory');
})().catch(error=>{console.error(error);process.exitCode=1;});
