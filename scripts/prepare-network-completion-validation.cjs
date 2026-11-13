'use strict';
/* global __dirname */
// Pure local preparation: no executor, credentials, network, installs or file writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {topLevel,unwrap}=require('./prepare-network-v2-local-validation.cjs');
const {inspect,buildDdlValidation}=require('./prepare-network-ddl-validation.cjs');
const {buildScopedValidation,aclRevisionPrefix,proveCommandScope}=require('./prepare-network-ddl-scoped-validation.cjs');
const root=path.resolve(__dirname,'..'),name='20261110120000_network_recovery_author_updates_v2.sql';
const lf=x=>x.replace(/\r\n/g,'\n'),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),q=x=>"'"+x.replaceAll("'","''")+"'";
function buildCompletionValidation(){
 const m=JSON.parse(fs.readFileSync(path.join(root,'scripts/block0-network-completion-manifest.json'),'utf8'));
 let base=lf(aclRevisionPrefix+buildScopedValidation().sql);
 const source=lf(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
 assert.equal(sha(base),m.base17eSha256);assert.equal(sha(source),m.additiveMigrationSha256);assert.equal(m.execution,'UNCONFIRMED');
 const model=inspect(source);assert.equal(model.tables.length,2);assert.equal(model.functions.length,5);assert.equal(model.triggers.length,2);
 // Both fingerprints must exclude every new completion object, whose definition
 // and privileges are checked separately below. Preserve all legacy comparisons.
 const originalBase=base;
 for(const [pattern,names] of [[/p\.proname not in \(([^)]*)\)/g,model.functions.map(f=>f.name)],
  [/c\.relname not in \(([^)]*)\)/g,model.tables.map(t=>t.name)]]){
  let count=0; base=base.replace(pattern,(_match,list)=>{count++;return `${pattern.source.startsWith('p')?'p.proname':'c.relname'} not in (${list},${names.map(q).join(',')})`;});
  assert.equal(count,2,'Expected baseline and final business fingerprints');
 }
 const statements=topLevel(unwrap(source));proveCommandScope(unwrap(source));
 const funcs=statements.filter(s=>s.token.startsWith('create function')).map(s=>{
  const raw=unwrap(source).slice(s.start,s.end),f=model.functions.find(f=>s.token.startsWith('create function public.'+f.name+'('));
  assert.ok(f);const body=raw.match(/\$\$([\s\S]*?)\$\$/);assert.ok(body);
  return{...f,hash:sha(body[1]),timeout:/set lock_timeout/.test(raw),client:f.name!=='network_operation_fence_guard_v2'};
 });
 const guard=`do $block0_guard$ begin
 if current_setting('safemelink.block0_review',true) is distinct from 'AUTHORIZED_COMPLETE_DDL_ONLY_QUIET_WINDOW' then raise exception 'STOP: completion DDL review missing'; end if;
 ${model.tables.map(t=>`if to_regclass('public.${t.name}') is not null then raise exception 'STOP: completion object collision'; end if;`).join('\n')}
 ${funcs.map(f=>`if to_regprocedure(${q(f.signature)}) is not null then raise exception 'STOP: completion function collision'; end if;`).join('\n')}
end $block0_guard$;`;
 const checks=`do $block0_assert$ declare r record; oid_now oid; role_name text; privilege_name text; begin
 for r in select * from (values ${model.tables.map(t=>`(${q(t.name)},${t.columns.length})`).join(',')}) v(name,column_count) loop
  oid_now:=to_regclass('public.'||r.name);
  if not exists(select 1 from pg_class c where c.oid=oid_now and c.relrowsecurity and not c.relforcerowsecurity and pg_get_userbyid(c.relowner)='postgres')
   or exists(select 1 from pg_policy where polrelid=oid_now)
   or (select count(*) from pg_attribute where attrelid=oid_now and attnum>0 and not attisdropped)<>r.column_count
   or exists(select 1 from pg_attribute where attrelid=oid_now and attnum>0 and attacl is not null) then raise exception 'Completion table/RLS/column mismatch'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege(role_name::name,oid_now,privilege_name) is distinct from false then raise exception 'Completion table ACL mismatch'; end if;
   end loop;
  end loop;
  if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=oid_now and a.grantee<>c.relowner) then raise exception 'Unexpected completion table grantee'; end if;
 end loop;
 for r in select * from (values ${funcs.map(f=>`(${q(f.signature)},${q(f.hash)},${f.definer},${f.client},${f.timeout})`).join(',')}) v(signature,body_hash,definer,client,timeout) loop
  oid_now:=to_regprocedure(r.signature);
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=oid_now and pg_get_userbyid(p.proowner)='postgres'
   and p.prosecdef=r.definer and l.lanname='plpgsql' and p.provolatile='v' and not p.proleakproof and not p.proisstrict and not p.proretset
   and p.prorettype=case when r.client then 'jsonb'::regtype else 'trigger'::regtype end
   and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=r.body_hash
   and (select array_agg(regexp_replace(c,'\\s','','g') order by regexp_replace(c,'\\s','','g')) from unnest(p.proconfig) c)=
     case when r.timeout then array['lock_timeout=3s','search_path=pg_catalog,pg_temp'] else array['search_path=pg_catalog,pg_temp'] end) then raise exception 'Completion function definition/metadata mismatch'; end if;
  if has_function_privilege('anon',oid_now,'EXECUTE') or has_function_privilege('service_role',oid_now,'EXECUTE')
   or has_function_privilege('authenticated',oid_now,'EXECUTE') is distinct from r.client then raise exception 'Completion function ACL mismatch'; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles g on g.oid=a.grantee
   where p.oid=oid_now and a.grantee<>p.proowner and (a.is_grantable or (g.rolname='authenticated' and r.client and a.privilege_type='EXECUTE') is not true)) then raise exception 'Unexpected completion function grant'; end if;
 end loop;
 ${model.triggers.map(t=>`if not exists(select 1 from pg_trigger where tgname=${q(t.name)} and tgrelid='public.${t.table}'::regclass and tgfoid='public.network_operation_fence_guard_v2()'::regprocedure and tgenabled='O' and not tgisinternal) then raise exception 'Completion trigger mismatch'; end if;`).join('\n')}
 ${model.indexes.map(i=>`if not exists(select 1 from pg_index where indexrelid=to_regclass('public.${i.name}') and indrelid='public.${i.table}'::regclass and indisvalid and indisready) then raise exception 'Completion index mismatch'; end if;`).join('\n')}
end $block0_assert$;`;
 assert.equal(base.split('do $phase17d_recheck$').length,2);
 let sql=base.replace('begin;\n',"begin;\nset local safemelink.block0_review='UNCONFIRMED';\n"+guard+'\n');
 sql=sql.replace('do $phase17d_recheck$',()=>`-- EXACT ADDITIVE COMPLETION BODY SHA256 ${sha(source)}\n${unwrap(source)}\n${checks}\ndo $phase17d_recheck$`);
 proveCommandScope(sql);assert.deepEqual(topLevel(sql).filter(s=>/^(begin|commit|rollback)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
 return{sql,base17eSha256:sha(originalBase),migrationSha256:sha(source),sha256:sha(sql),status:'PREPARED_NOT_EXECUTED'};
}
function buildCompletionFunctional(){
 const file=lf(fs.readFileSync(path.join(root,'scripts/test-network-social-development.sql'),'utf8'));
 const anchor="  perform public.finish_my_network_event_v2(e,'RESOLVED');";assert.equal(file.split(anchor).length,2);
 const extra=`  -- Added completion assertions; all IDs belong to the enclosing synthetic fixture.
  declare update_op uuid:=gen_random_uuid(); late_event uuid:=gen_random_uuid(); late_social uuid:=gen_random_uuid(); update_id uuid; x jsonb; denied boolean;
  begin
    x:=public.publish_network_author_update_v2(e,update_op,'Synthetic author progress update.');update_id:=(x->>'commentId')::uuid;
    if public.get_network_author_updates_v2(e)->'updates' is distinct from '[]'::jsonb then raise exception 'Pending author update leaked'; end if;
    if public.publish_network_author_update_v2(e,update_op,'Synthetic author progress update.')->>'replayed' is distinct from 'true' then raise exception 'Author replay failed'; end if;
    perform public.review_network_comment_v2(update_id,1,'APPROVED','synthetic author review');
    x:=public.get_network_author_updates_v2(e);
    if jsonb_array_length(x->'updates')<>1 or x->'updates'->0->>'authorRole'<>'AUTHOR' or (x->'updates'->0 ? 'author_id') then raise exception 'Author DTO mismatch'; end if;
    perform set_config('request.jwt.claim.sub',b::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
    denied:=false;begin perform public.publish_network_author_update_v2(e,gen_random_uuid(),'Not the author.');exception when insufficient_privilege then denied:=true;end;
    if not denied then raise exception 'Non-author wrote update'; end if;
    if public.resolve_my_network_operation_v2('EVENT',operation,false)->>'state'<>'UNKNOWN' then raise exception 'Other account receipt leaked'; end if;
    if exists(select 1 from jsonb_array_elements(public.list_my_network_events_v2()) as owner_entry(value) where owner_entry.value->>'publicId'=e::text) then raise exception 'Other account publication leaked'; end if;
    perform set_config('request.jwt.claim.sub',a::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    if public.resolve_my_network_operation_v2('EVENT',operation,false)->>'publicId'<>e::text then raise exception 'Own event receipt absent'; end if;
    if not exists(select 1 from jsonb_array_elements(public.list_my_network_events_v2()) as owner_entry(value) where owner_entry.value->>'publicId'=e::text) then raise exception 'Own publication metadata absent'; end if;
    if public.resolve_my_network_operation_v2('EVENT',late_event,false)->>'state'<>'UNKNOWN' then raise exception 'Empty lookup not uncertain'; end if;
    if public.resolve_my_network_operation_v2('EVENT',late_event,true)->>'state'<>'FENCED' then raise exception 'Missing event fence'; end if;
    denied:=false;begin perform public.create_network_event_v2(late_event,territory,0.45,0.45,'EXPLICIT_EVENT_POINT','LIGHTING','Synthetic fenced late event.');exception when insufficient_privilege then denied:=true;end;
    if not denied or exists(select 1 from public.network_events_v2 where author_user_id=a and operation_id=late_event) then raise exception 'Late event passed fence'; end if;
    perform public.resolve_my_network_operation_v2('SOCIAL',late_social,true);
    denied:=false;begin perform public.mutate_network_social_v2(e,late_social,'VOTE','NO_LONGER_PRESENT');exception when insufficient_privilege then denied:=true;end;
    if not denied or (select kind from public.network_social_votes_v2 where event_id=e and user_id=a) is distinct from 'CONFIRMED' then raise exception 'Fenced social side effect was committed'; end if;
    perform public.remove_my_network_social_v2(e,update_id);
    if public.get_network_author_updates_v2(e)->'updates' is distinct from '[]'::jsonb then raise exception 'Withdrawn author update leaked'; end if;
  end;
`;
 let sql=file.replace('begin;\n',()=>`begin;\nset local safemelink.block0_functional_review='UNCONFIRMED';\ndo $block0_fixture_guard$ begin
 if current_setting('safemelink.block0_functional_review',true) is distinct from 'AUTHORIZED_SYNTHETIC_FUNCTIONAL_TEST' then raise exception 'STOP: functional test authorization missing'; end if;
 if to_regprocedure('public.resolve_my_network_operation_v2(text,uuid,boolean)') is null then raise exception 'Completion migration not installed'; end if;
end $block0_fixture_guard$;\n`).replace(anchor,()=>extra+anchor);
 sql=sql.replace('rollback;',()=>`set local role authenticated;
do $block0_role$ declare t text; begin
 foreach t in array array['network_operation_fences_v2','network_author_update_links_v2'] loop
  if has_table_privilege(current_user,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then raise exception 'Direct completion table access'; end if;
 end loop;
 if has_function_privilege(current_user,'public.network_operation_fence_guard_v2()','EXECUTE') then raise exception 'Internal helper exposed'; end if;
end $block0_role$;
reset role;set local role anon;
do $block0_anon$ begin
 if has_function_privilege(current_user,'public.resolve_my_network_operation_v2(text,uuid,boolean)','EXECUTE') or
 has_function_privilege(current_user,'public.publish_network_author_update_v2(uuid,uuid,text)','EXECUTE') then raise exception 'Anonymous completion access'; end if;
end $block0_anon$;reset role;
rollback;`);
 assert.deepEqual(topLevel(sql).filter(s=>/^(begin|commit|rollback)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
 return{sql,sha256:sha(sql),status:'SYNTHETIC_TEST_PREPARED_NOT_EXECUTED'};
}
function buildPostRollback(){
 const base=buildDdlValidation(),extra=inspect(lf(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8')));
 const tables=[...base.tables,...extra.tables].map(t=>t.name),functions=[...base.functions,...extra.functions].map(f=>f.name);
 const relation=`exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${tables.map(q).join(',')}]))`;
 const fn=`exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${functions.map(q).join(',')}]))`;
 const sql=`-- READ ONLY metadata only. Identity must be checked in Dashboard: lwkxufnbjrpsehdkfmgy.
begin read only;
set local statement_timeout='5s';
select pg_catalog.jsonb_build_object('transactionReadOnly',current_setting('transaction_read_only'),
 'allV2ObjectsAbsent',not ${relation} and not ${fn},
 'remainingTables',coalesce((select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${tables.map(q).join(',')}])), '[]'::jsonb),
 'remainingFunctions',coalesce((select jsonb_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${functions.map(q).join(',')}])), '[]'::jsonb));
rollback;
`;
 return{sql,sha256:sha(sql),status:'READ_ONLY_PREPARED_NOT_EXECUTED'};
}
module.exports={buildCompletionValidation,buildCompletionFunctional,buildPostRollback};
if(require.main===module){const b=process.argv.includes('--post-rollback')?buildPostRollback():process.argv.includes('--functional')?buildCompletionFunctional():buildCompletionValidation();if(process.argv.includes('--emit-sql'))process.stdout.write(b.sql);else console.log(JSON.stringify({...b,sql:undefined}));}
