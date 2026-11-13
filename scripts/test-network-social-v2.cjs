'use strict';
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}) {
  const out = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {}; new Function('exports','require',out.outputText)(exports, name => {
    assert.ok(Object.hasOwn(deps, name), 'Unexpected runtime dependency: ' + name); return deps[name];
  }); return exports;
}
const registry = load('services/NetworkCategoryRegistryV2.ts');
const contract = load('services/NetworkMapContractV2.ts', { './NetworkCategoryRegistryV2': registry });
const map = load('services/NetworkMapController.ts', { './NetworkMapContractV2': contract, './NetworkCategoryRegistryV2': registry });
const social = load('services/NetworkSocialContractV2.ts');
const base = load('backend/repositories/NetworkV2Repository.ts', { '@/services/NetworkMapContractV2': contract,
  '@/services/NetworkCategoryRegistryV2': registry, '@/services/NetworkMapController': map });
const repo = load('backend/repositories/NetworkSocialV2Repository.ts', { './NetworkV2Repository': base, '@/services/NetworkSocialContractV2': social });
const controller = load('components/network/NetworkSocialController.ts', { '@/backend/repositories/NetworkSocialV2Repository': repo,
  '@/backend/repositories/NetworkV2Repository': base, '@/services/NetworkSocialContractV2': social });
const model = load('components/network/NetworkMapModel.ts', { '@/services/NetworkMapContractV2': contract });
const screen = load('components/network/NetworkV2ScreenController.ts', { '@/services/NetworkMapController': map,
  '@/backend/repositories/NetworkV2Repository': base, './NetworkMapModel': model });
const composition = load('services/NetworkV2Composition.ts', { '@/backend/repositories/NetworkV2Repository': base,
  '@/components/network/NetworkV2ScreenController': screen, '@/components/network/NetworkSocialController': controller,
  './NetworkWriteRecovery': load('services/NetworkWriteRecovery.ts', { '@/backend/repositories/NetworkV2Repository': base, './NetworkSocialContractV2': social }) });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const expiry = new Date(Date.now()+3600000).toISOString();
const future = () => expiry;
const snapshot = (eventId=id(1)) => ({ eventId, validUntil: future(), confirmedCount: 1, noLongerPresentCount: 0,
  myVote: null, following: false, comments: [] });
const detail = () => ({ marker: { publicId:id(1), territoryId:id(2), validUntil:future(), status:'ACTIVE' } });
const receipt = args => ({ eventId:args.target_event,operationId:args.target_operation,action:args.action_kind,
  commentId:args.action_kind==='COMMENT'?id(9):null,replayed:false });
const reply = data => ({data,error:null,status:200});
const tick = () => new Promise(resolve=>setImmediate(resolve));
function harness() {
  let key='A', hook=null, nextId=100; const listeners=new Set(), calls=[];
  const access={getKey:()=>key,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);}};
  const transport=async(name,args,signal)=>{calls.push({name,args,signal}); if(hook){const r=await hook(name,args,signal);if(r!==undefined)return r;}
    if(name==='get_network_social_v2')return reply(snapshot(args.target_event));
    if(name==='list_network_social_activity_v2')return reply([]);
    if(name==='mutate_network_social_v2')return reply(receipt(args));
    if(name==='publish_network_author_update_v2')return reply(receipt({...args,action_kind:'COMMENT'}));
    if(name==='get_my_network_social_operation_v2')return reply(null);
    throw Error('Unexpected endpoint');};
  const runtime=new controller.NetworkSocialController(transport,access,()=>id(++nextId));
  return { runtime,calls,access,transport,hook:f=>{hook=f;},change:keyValue=>{key=keyValue;for(const f of listeners)f();} };
}
let passed=0;
async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
(async()=>{
  await test('strict public DTO allowlists, pending/PII fields rejected and copies immutable',()=>{
    const value=social.decodeNetworkSocialSnapshot(snapshot());assert.ok(Object.isFrozen(value));
    assert.throws(()=>social.decodeNetworkSocialSnapshot({...snapshot(),author_id:id(2)}));
    assert.throws(()=>social.decodeNetworkSocialSnapshot({...snapshot(),confirmedCount:null}));
    assert.throws(()=>social.decodeNetworkSocialSnapshot({...snapshot(),comments:[{publicId:id(9),nickname:'Synthetic',body:'Text',createdAt:new Date().toISOString(),canWithdraw:true,moderation_state:'PENDING'}]}));
    assert.throws(()=>social.decodeNetworkSocialReceipt({...receipt({target_event:id(1),target_operation:id(3),action_kind:'COMMENT'}),commentId:null}));
    assert.throws(()=>social.decodeNetworkSocialActivity([{publicId:id(9),eventId:id(1),kind:'COMMENT_APPROVED',createdAt:'invalid'}]));
  });
  await test('gate OFF creates no runtime, Auth request or RPC',()=>{
    let touched=0;const options={client:{rpc(){touched++;throw Error();},auth:{getSession(){touched++;throw Error();},onAuthStateChange(){touched++;throw Error();}}},createOperationId:()=>id(3),initialRegion:{latitude:0,longitude:0,latitudeDelta:1,longitudeDelta:1}};
    assert.equal(composition.createNetworkV2AppComposition(options),null);assert.equal(touched,0);
  });
  await test('late getSession cannot restore a logged-out session',async()=>{
    let done,callback;const access=composition.createNetworkV2AuthAccess({auth:{getSession:()=>new Promise(r=>{done=r;}),onAuthStateChange:f=>{callback=f;return{data:{subscription:{unsubscribe(){}}}};}}});
    const start=access.start();callback('SIGNED_OUT',null);done({data:{session:{user:{id:id(3)}}},error:null});await start;assert.equal(access.getKey(),null);
    callback('SIGNED_IN',{user:{id:id(3)}});assert.ok(access.getKey());access.stop();assert.equal(access.getKey(),null);
    const callbacks=[];const safe=composition.createNetworkV2AuthAccess({auth:{getSession:async()=>({data:{session:{user:{id:id(4)}}},error:null}),
      onAuthStateChange:f=>{callbacks.push(f);return{data:{subscription:{unsubscribe(){}}}};}}});
    await safe.start();safe.stop();await safe.start();const current=safe.getKey();callbacks[0]('SIGNED_OUT',null);assert.equal(safe.getKey(),current);safe.stop();
  });
  await test('token renewal preserves the same owner epoch; logout or a different owner invalidates it',async()=>{
    let callback;
    const access=composition.createNetworkV2AuthAccess({auth:{getSession:async()=>({data:{session:{user:{id:id(3)}}},error:null}),
      onAuthStateChange:f=>{callback=f;return{data:{subscription:{unsubscribe(){}}}};}}});
    await access.start();const original=access.getKey();let changes=0;access.subscribe(()=>changes++);
    for(const event of ['TOKEN_REFRESHED','SIGNED_IN','INITIAL_SESSION'])callback(event,{user:{id:id(3)}});
    assert.equal(access.getKey(),original);assert.equal(changes,0);
    callback('TOKEN_REFRESHED',{user:{id:id(4)}});assert.notEqual(access.getKey(),original);assert.equal(changes,1);
    callback('SIGNED_OUT',null);assert.equal(access.getKey(),null);access.stop();
  });
  await test('double tap sends one operation; no optimistic success; follow/comment receipts differ',async()=>{
    const h=harness();h.runtime.start();h.runtime.select(detail());await tick();let done;
    h.hook((name,args)=>name==='mutate_network_social_v2'?new Promise(r=>{done=()=>r(reply(receipt(args)));}):undefined);
    const first=h.runtime.act('FOLLOW','ON');const second=h.runtime.act('FOLLOW','ON');await tick();
    assert.equal(h.calls.filter(c=>c.name==='mutate_network_social_v2').length,1);assert.equal(h.runtime.getState().write,'SENDING');assert.equal(h.runtime.getState().snapshot.following,false);
    done();await Promise.all([first,second]);assert.equal(h.runtime.getState().write,'IDLE');
    h.hook(null);await h.runtime.act('COMMENT','Synthetic comment');assert.match(h.runtime.getState().notice,/moderazione/);h.runtime.dispose();
  });
  await test('UNKNOWN stays uncertain after empty receipt or later rejection, same operation replay only',async()=>{
    const h=harness();h.runtime.start();h.runtime.select(detail());await tick();
    h.hook(name=>{if(name==='mutate_network_social_v2')throw Error('offline');});await h.runtime.act('COMMENT','Synthetic unknown');
    assert.equal(h.runtime.getState().write,'UNKNOWN');await h.runtime.verify();assert.equal(h.runtime.getState().write,'UNKNOWN');
    h.hook(name=>name==='mutate_network_social_v2'?{data:null,error:{code:'42501'},status:403}:undefined);
    await h.runtime.retry();assert.equal(h.runtime.getState().write,'UNKNOWN');
    const attempts=h.calls.filter(c=>c.name==='mutate_network_social_v2');assert.equal(attempts[0].args.target_operation,attempts[1].args.target_operation);
    await h.runtime.act('VOTE','CONFIRMED');assert.equal(h.calls.filter(c=>c.name==='mutate_network_social_v2').length,2);
    const old=attempts[0].args;h.hook(name=>name==='get_my_network_social_operation_v2'?reply({...receipt(old),replayed:true}):undefined);
    await h.runtime.verify();assert.equal(h.runtime.getState().write,'IDLE');h.runtime.dispose();
  });
  await test('account changes clear text-bearing state; late old responses and old writes ignored',async()=>{
    const h=harness();h.runtime.start();let done;
    h.hook(name=>name==='get_network_social_v2'?new Promise(r=>{done=r;}):undefined);
    h.runtime.select(detail());await tick();h.change('B');done(reply(snapshot()));await tick();assert.equal(h.runtime.getState().snapshot,null);assert.equal(h.runtime.getState().eventId,null);
    h.hook(null);h.runtime.select(detail());await tick();h.hook(name=>{if(name==='mutate_network_social_v2')throw Error('offline');});await h.runtime.act('COMMENT','Synthetic');
    h.change(null);assert.equal(h.runtime.getState().write,'IDLE');assert.equal(h.runtime.getState().snapshot,null);h.runtime.dispose();
  });
  await test('obsolete event responses, expired payloads, absent RPC and denied authorization fail closed',async()=>{
    const h=harness();h.runtime.start();let done;
    h.hook((name,args)=>name==='get_network_social_v2'&&args.target_event===id(1)?new Promise(r=>{done=r;}):undefined);
    h.runtime.select(detail());await tick();h.runtime.select({...detail(),marker:{...detail().marker,publicId:id(4)}});await tick();done(reply(snapshot()));await tick();assert.equal(h.runtime.getState().snapshot.eventId,id(4));
    h.hook(name=>name==='get_network_social_v2'?reply({...snapshot(id(4)),validUntil:'2000-01-01T00:00:00.000Z'}):undefined);await h.runtime.refresh();assert.equal(h.runtime.getState().snapshot,null);
    for(const code of ['PGRST202','42501']){h.hook(()=>({data:null,error:{code},status:403}));await h.runtime.refresh();assert.equal(h.runtime.getState().phase,'ERROR');assert.equal(h.runtime.getState().snapshot,null);}
    h.runtime.dispose();
  });
  await test('bounded timeout, UNKNOWN invalid write response and missing receipts',async()=>{
    const r=new repo.NetworkSocialV2Repository(()=>new Promise(()=>{}),()=> 'A',2);
    await assert.rejects(r.mutate(id(1),id(3),'FOLLOW','ON',new AbortController().signal),e=>e.reason==='TIMEOUT'&&e.outcome==='UNKNOWN');r.dispose();
    const invalid=new repo.NetworkSocialV2Repository(async()=>reply({}),()=> 'A');await assert.rejects(invalid.mutate(id(1),id(3),'FOLLOW','ON',new AbortController().signal),e=>e.reason==='INVALID_DATA'&&e.outcome==='UNKNOWN');invalid.dispose();
  });
  await test('background clears content and does not poll; refresh restores verified state',async()=>{
    const h=harness();h.runtime.start();h.runtime.select(detail());await tick();h.runtime.suspend();const count=h.calls.length;await h.runtime.refresh();assert.equal(h.calls.length,count);assert.equal(h.runtime.getState().snapshot,null);
    h.runtime.resume();await tick();assert.equal(h.runtime.getState().phase,'READY');h.runtime.dispose();
  });
  await test('visible social content expires independently of parent event; resolved cleanup stays available',async()=>{
    const h=harness();h.runtime.start();
    h.hook(name=>name==='get_network_social_v2'?reply({...snapshot(),validUntil:new Date(Date.now()+40).toISOString()}):undefined);
    h.runtime.select(detail());await tick();assert.equal(h.runtime.getState().phase,'READY');
    await new Promise(r=>setTimeout(r,65));assert.equal(h.runtime.getState().snapshot,null);
    h.hook(null);h.runtime.select({...detail(),marker:{...detail().marker,status:'RESOLVED'}});await tick();
    const before=h.calls.filter(c=>c.name==='mutate_network_social_v2').length;
    await h.runtime.act('COMMENT','Synthetic resolved comment');assert.equal(h.calls.filter(c=>c.name==='mutate_network_social_v2').length,before);
    await h.runtime.act('VOTE','NONE');assert.equal(h.calls.filter(c=>c.name==='mutate_network_social_v2').length,before+1);h.runtime.dispose();
  });
  await test('native social presenter uses real snapshot and disables creation on UNKNOWN',async()=>{
    const h=harness();h.runtime.start();h.runtime.select(detail());await tick();
    const element=(type,props)=>({type,props:props||{}});
    const panel=load('components/network/NetworkSocialPanel.native.tsx',{react:{useEffect(){},useState:()=>['Synthetic',()=>{}],useSyncExternalStore:(_subscribe,get)=>get()},
      'react/jsx-runtime':{jsx:element,jsxs:element},'react-native':{AppState:{currentState:'active'},Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:x=>x}}});
    const flatten=x=>!x||typeof x!=='object'?[]:Array.isArray(x)?x.flatMap(flatten):[x,...flatten(x.props?.children)];
    let tree=panel.NetworkSocialPanel({controller:h.runtime,detail:detail()});let nodes=flatten(tree);
    assert.ok(nodes.some(n=>n.props.accessibilityLabel==='Confermo'&&n.props.disabled===false));
    h.hook(name=>{if(name==='mutate_network_social_v2')throw Error('offline');});await h.runtime.act('COMMENT','Synthetic uncertain');
    tree=panel.NetworkSocialPanel({controller:h.runtime,detail:detail()});nodes=flatten(tree);
    assert.ok(nodes.some(n=>n.props.accessibilityLabel==='Verifica ricevuta'));assert.ok(!nodes.some(n=>n.props.accessibilityLabel==='Invia alla moderazione'&&n.props.disabled===false));
    h.runtime.dispose();
  });
  await test('additive SQL boundaries, RLS, ACL, gate OFF, parent checks and no external transports',()=>{
    const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261108120000_network_social_v2.sql'),'utf8');
    const {topLevel}=require('./prepare-network-v2-local-validation.cjs');const statements=topLevel(sql);
    assert.deepEqual(statements.filter(s=>/^(begin|commit|rollback)\b/.test(s.token)).map(s=>s.token),['begin','commit']);
    assert.equal((sql.match(/enable row level security/g)||[]).length,5);assert.match(sql,/enabled boolean not null default false/);
    assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/Operation conflict/);assert.match(sql,/e:=public.network_social_require_v2\(target_event\);/);
    assert.doesNotMatch(sql,/\b(?:http_post|http_get|pg_notify|dblink|net\.http|cron\.schedule|send-sos|prepare_sos_delivery)\b/i);
    assert.doesNotMatch(sql,/\b(?:insert into|update|delete from) public\.(?:sos|network_reports|profiles)\b/i);
    assert.doesNotMatch(sql,/grant execute[^;]*to anon/is);
  });
  await test('author update uses its real RPC and a non-author rejection is not shown as success',async()=>{
    const h=harness();h.runtime.start();h.runtime.select(detail());await tick();
    await h.runtime.act('COMMENT','Synthetic author update.',true);assert.ok(h.calls.some(c=>c.name==='publish_network_author_update_v2'));
    h.hook(name=>name==='publish_network_author_update_v2'?{data:null,error:{code:'42501'},status:403}:undefined);
    await h.runtime.act('COMMENT','Synthetic unauthorized update.',true);assert.equal(h.runtime.getState().write,'IDLE');assert.ok(!h.runtime.getState().notice.includes('ricevuto'));h.runtime.dispose();
  });
  await test('strict TypeScript of social, native entry, composition and existing integration',()=>{
    const modules=path.resolve(path.dirname(require.resolve('typescript')),'..','..');
    const files=['screens/NetworkV2Entry.native.tsx','services/NetworkV2Composition.ts'];
    const program=ts.createProgram(files.map(f=>path.join(root,f)),{strict:true,noEmit:true,skipLibCheck:true,esModuleInterop:true,
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,baseUrl:root,types:['react','node'],typeRoots:[path.join(modules,'@types')],
      paths:{'@/*':['./*'],react:[path.join(modules,'@types/react/index.d.ts')],'react/*':[path.join(modules,'@types/react/*')],'*':[path.join(modules,'*'),path.join(modules,'@types/*')]}});
    const errors=ts.getPreEmitDiagnostics(program);assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>root,getCanonicalFileName:n=>n,getNewLine:()=> '\n'}));
  });
  console.log(`${passed} local social checks PASS. PostgreSQL/JWT/concurrency/native rendering NOT executed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
