'use strict';
// Local preparation only. No DB client, subprocess, network, credentials or file writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {topLevel,unwrap}=require('./prepare-network-v2-local-validation.cjs');
const root=path.resolve(__dirname,'..');
const names=['20261103120000_network_territorial_map_history.sql','20261107120000_network_event_markers_v2.sql','20261108120000_network_social_v2.sql'];
const q=s=>"'"+s.replaceAll("'","''")+"'";
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function splitFields(text){
  let depth=0,quote=false,start=0;const out=[];
  for(let i=0;i<text.length;i++){
    if(text[i]==="'"){if(quote&&text[i+1]==="'"){i++;continue;}quote=!quote;}
    if(!quote){if(text[i]==='(')depth++;if(text[i]===')')depth--;if(text[i]===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}}
  }out.push(text.slice(start).trim());return out;
}
const typePattern='(?:extensions\\.geometry\\([^)]*\\)|public\\.[a-z_0-9]+|double precision|timestamptz|integer|boolean|uuid|jsonb|text|date|interval|bigint)';
const normalizeType=t=>t.toLowerCase().replace(/^timestamptz$/,'timestamp with time zone').replace(/\s/g,'');
function inspect(source){
  const body=unwrap(source);const statements=topLevel(body);const tables=[],functions=[],indexes=[],triggers=[],tableGrants=[],executeGrants=[];
  for(const s of statements){
    const raw=body.slice(s.start,s.end),token=s.token;
    assert.doesNotMatch(token,/^(?:insert|update|delete|select|call|copy|create or replace|drop|truncate|alter function|alter system|create extension|create role)\b/i);
    if(token.startsWith('do ')){
      // The two source guards contain only identity/dependency/ACL checks, not application work.
      assert.doesNotMatch(raw,/\b(?:perform|execute|insert|update|delete|call|http_post|http_get|pg_notify|nextval|setval)\b/i);
      const clean=raw.replace(/'(?:''|[^'])*'/g,"''");
      for(const call of clean.matchAll(/\b([a-z_][a-z_0-9]*)\s*\(/gi))assert.ok(['to_regclass','to_regprocedure','has_schema_privilege','exists'].includes(call[1].toLowerCase()),'Unapproved source guard call');
      continue;
    }
    let m=token.match(/^create table public\.(\w+)\s*\(([\s\S]*)\)\s*;?$/);
    if(m){
      const fields=splitFields(m[2]);const pkFields=fields.filter(f=>/^primary key\b/.test(f)).flatMap(f=>f.match(/\(([^)]+)\)/)[1].split(',').map(x=>x.trim()));
      const columns=fields.filter(f=>! /^(?:primary key|foreign key|unique|check|constraint)\b/.test(f)).map(f=>{
        const c=f.match(new RegExp('^(\\w+)\\s+('+typePattern+')','i'));assert.ok(c,'Unparsed column '+f);
        return {name:c[1],type:normalizeType(c[2]),notNull:/\bnot null\b|\bprimary key\b/.test(f)||pkFields.includes(c[1])};
      });
      tables.push({name:m[1],columns,constraints:{p:(token.match(/\bprimary key\b/g)||[]).length,u:(token.match(/\bunique\b/g)||[]).length,
        f:(token.match(/\breferences\b/g)||[]).length,c:(token.match(/\bcheck\s*\(/g)||[]).length}});continue;
    }
    m=token.match(/^create function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\b/);
    if(m){const args=m[2].trim()?splitFields(m[2]).map(f=>{
      const a=f.match(new RegExp('^\\w+\\s+('+typePattern+')','i'));assert.ok(a,'Unparsed argument '+f);return a[1];}):[];
      const result=token.match(/\breturns\s+([\s\S]*?)\s+language\b/);assert.ok(result,'Unparsed function result');
      functions.push({name:m[1],signature:`public.${m[1]}(${args.join(',')})`,result:normalizeType(result[1]),definer:/\bsecurity definer\b/.test(token),language:token.match(/\blanguage (\w+)/)[1],
        volatility:/\bstable\b/.test(token)?'s':/\bimmutable\b/.test(token)?'i':'v'});continue;
    }
    m=token.match(/^create (?:unique )?index (\w+) on public\.(\w+)/);if(m){indexes.push({name:m[1],table:m[2]});continue;}
    m=token.match(/^create trigger (\w+) .*? on public\.(\w+)/s);if(m){triggers.push({name:m[1],table:m[2]});continue;}
    if(/^alter table public\.\w+ enable row level security\s*;?$/.test(token))continue;
    if(/^revoke all on (?:table |function )?public\./.test(token))continue;
    m=token.match(/^grant execute on function ([\s\S]+) to (authenticated|service_role)\s*;?$/);
    if(m){for(const n of m[1].matchAll(/public\.(\w+)\(/g))executeGrants.push({name:n[1],role:m[2]});continue;}
    m=token.match(/^grant ([a-z, ]+) on (?:table )?([\s\S]+) to service_role\s*;?$/);
    if(m){for(const n of m[2].matchAll(/public\.(\w+)/g))tableGrants.push({name:n[1],privileges:m[1].split(',').map(x=>x.trim().toUpperCase())});continue;}
    throw Error('Unapproved top-level statement: '+token.slice(0,100));
  }
  return {body,tables,functions,indexes,triggers,tableGrants,executeGrants};
}
function buildDdlValidation(){
  const sources=names.map(n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8'));
  const parts=sources.map(inspect);const all=key=>parts.flatMap(p=>p[key]);
  const tables=all('tables'),functions=all('functions'),indexes=all('indexes'),triggers=all('triggers');
  assert.equal(tables.length,17);assert.equal(functions.length,30);assert.equal(indexes.length,21);assert.equal(triggers.length,2);
  const tableNames=tables.map(t=>t.name),functionNames=functions.map(f=>f.name),relationNames=[...tableNames,...indexes.map(i=>i.name)];
  assert.equal(new Set(functionNames).size,30);
  for(const i of indexes)assert.ok(tableNames.includes(i.table));
  for(const t of triggers)assert.ok(tableNames.includes(t.table));
  const sqlList=items=>items.map(q).join(',');
  const fingerprint=`select md5(jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,p.proconfig::text,md5(pg_get_functiondef(p.oid))) order by p.oid),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname in ('public','auth') and p.proname not in (${sqlList(functionNames)})),
    'tables',(select coalesce(jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
      (select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      (select jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid))) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
      (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by i.indexrelid) from pg_index i where i.indrelid=c.oid)) order by c.oid),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth') and c.relname not in (${sqlList(tableNames)}))
  )::text)`;
  const columnValues=tables.flatMap(t=>t.columns.map(c=>`(${q(t.name)},${q(c.name)},${q(c.type)},${c.notNull})`)).join(',\n');
  const functionValues=functions.map(f=>`(${q(f.name)},${q(f.signature)},${q(f.result)},${f.definer},${q(f.language)},${q(f.volatility)},${all('executeGrants').some(g=>g.name===f.name&&g.role==='authenticated')},${all('executeGrants').some(g=>g.name===f.name&&g.role==='service_role')})`).join(',\n');
  const serviceGrants=new Map(all('tableGrants').map(g=>[g.name,g.privileges]));
  const aclValues=tables.flatMap(t=>['anon','authenticated','service_role'].flatMap(role=>['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].map(priv=>
    `(${q(t.name)},${q(role)},${q(priv)},${role==='service_role'&&(serviceGrants.get(t.name)||[]).includes(priv)})`))).join(',\n');
  const serviceGrantCases=tables.filter(t=>serviceGrants.has(t.name)).map(t=>`when ${q(t.name)} then array[${sqlList(serviceGrants.get(t.name))}]`).join('\n');
  const sql=`-- NETWORK V2 PHASE 17: DDL-only validation, NOT a deployment migration.
-- Expected Development: lwkxufnbjrpsehdkfmgy. Identity MUST be checked outside SQL.
-- No Auth users, fixture rows, application RPC calls, transports or activation.
-- Default blocked. Change only the acknowledgement after separate authorization.
-- A rollback does NOT erase logs or external effects. Enabled event triggers cause STOP.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local transaction_timeout='90s'; -- PostgreSQL 17+, cancels the entire transaction
set local idle_in_transaction_session_timeout='30s';
set local check_function_bodies=on;
set local search_path=pg_catalog,pg_temp;
set local safemelink.phase17_target_review='UNCONFIRMED';
do $phase17_guard$
declare item text;
begin
  if current_user<>'postgres' or current_setting('server_version_num')::integer<170000
    or current_setting('safemelink.phase17_target_review',true) is distinct from 'AUTHORIZED_DEVELOPMENT_lwkxufnbjrpsehdkfmgy' then
    raise exception 'STOP: explicit Development authorization / role / PG17 required'; end if;
  if exists(select 1 from pg_event_trigger where evtenabled<>'D') then
    raise exception 'STOP: enabled DDL event trigger; review externally, do not disable it for this test'; end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis' and n.nspname='extensions') then
    raise exception 'STOP: PostGIS in extensions required'; end if;
  foreach item in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=item) then raise exception 'STOP: missing required role'; end if;
  end loop;
  foreach item in array array['public.profiles','public.network_reports','public.network_preferences','public.network_config','public.network_user_restrictions'] loop
    if to_regclass(item) is null then raise exception 'STOP: base table missing: %',item; end if;
  end loop;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('public.network_user_is_eligible(uuid)') is null
    or to_regprocedure('public.network_user_is_restricted(uuid,text)') is null then raise exception 'STOP: base function missing'; end if;
  if has_schema_privilege('anon','public','CREATE') is distinct from false or has_schema_privilege('authenticated','public','CREATE') is distinct from false
    or has_schema_privilege('anon','extensions','CREATE') is distinct from false or has_schema_privilege('authenticated','extensions','CREATE') is distinct from false then
    raise exception 'STOP: untrusted schema CREATE'; end if;
  foreach item in array array[${sqlList(relationNames)}] loop
    if to_regclass('public.'||item) is not null or to_regtype('public.'||item) is not null then raise exception 'STOP: occupied relation/type name: %',item; end if;
  end loop;
  foreach item in array array[${sqlList(tableNames)}] loop
    if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and left(c.relname::text,length(item)+1)=item||'_') then raise exception 'STOP: occupied generated-object prefix: %',item; end if;
  end loop;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${sqlList(functionNames)})) then
    raise exception 'STOP: occupied V2 function name or overload'; end if;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and t.tgname in (${sqlList(triggers.map(t=>t.name))})) then raise exception 'STOP: occupied V2 trigger name'; end if;
end $phase17_guard$;
do $phase17_baseline$ declare h text; begin
  ${fingerprint} into h;
  perform set_config('safemelink.phase17_catalog_fingerprint',h,true);
end $phase17_baseline$;
${parts.map((p,i)=>`-- BEGIN EXACT MIGRATION BODY ${names[i]} SHA256 ${hash(sources[i])}\n${p.body}\n-- END EXACT MIGRATION BODY ${names[i]}`).join('\n')}
do $phase17_assertions$
declare r record; oid_now oid; h text;
begin
  for r in select * from (values ${tables.map(t=>`(${q(t.name)},${t.columns.length})`).join(',')}) v(name,column_count) loop
    select c.oid into oid_now from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=r.name and c.relkind='r' and c.relrowsecurity
        and not c.relforcerowsecurity and pg_get_userbyid(c.relowner)='postgres';
    if oid_now is null then raise exception 'Table/RLS/owner mismatch: %',r.name; end if;
    if exists(select 1 from pg_policy where polrelid=oid_now) then raise exception 'Unexpected client policy: %',r.name; end if;
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      left join pg_roles gr on gr.oid=a.grantee where c.oid=oid_now and a.grantee<>c.relowner
      and (a.is_grantable or (gr.rolname='service_role' and a.privilege_type=any(case r.name
        ${serviceGrantCases}
        else array[]::text[] end)) is not true)) then
      raise exception 'Unexpected table grantee/grant option: %',r.name; end if;
    if (select count(*) from pg_attribute where attrelid=oid_now and attnum>0 and not attisdropped)<>r.column_count then
      raise exception 'Column count mismatch: %',r.name; end if;
  end loop;
  for r in select * from (values ${columnValues}) v(table_name,column_name,type_name,not_null) loop
    if not exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||r.table_name) and a.attname=r.column_name and a.attnum>0 and not a.attisdropped
      and regexp_replace(lower(format_type(a.atttypid,a.atttypmod)),'\\s','','g')=r.type_name and a.attnotnull=r.not_null and a.attacl is null) then
      raise exception 'Column/type/nullability mismatch: %.%',r.table_name,r.column_name; end if;
  end loop;
  for r in select * from (values ${tables.flatMap(t=>Object.entries(t.constraints).map(([type,count])=>`(${q(t.name)},${q(type)},${count})`)).join(',')}) v(name,kind,expected) loop
    if (select count(*) from pg_constraint k where k.conrelid=to_regclass('public.'||r.name) and k.contype::text=r.kind and k.convalidated)<>r.expected then
      raise exception 'Constraint mismatch: % / %',r.name,r.kind; end if;
  end loop;
  for r in select * from (values ${indexes.map(i=>`(${q(i.name)},${q(i.table)})`).join(',')}) v(name,table_name) loop
    if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.'||r.name) and i.indrelid=to_regclass('public.'||r.table_name) and i.indisvalid and i.indisready) then
      raise exception 'Index mismatch: %',r.name; end if;
  end loop;
  for r in select * from (values ${functionValues}) v(name,signature,result_type,definer,language,volatility,client_execute,service_execute) loop
    oid_now:=to_regprocedure(r.signature);
    if oid_now is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=oid_now
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef=r.definer and l.lanname=r.language and p.provolatile::text=r.volatility
      and regexp_replace(lower(pg_get_function_result(p.oid)),'\\s','','g')=r.result_type
      and exists(select 1 from unnest(p.proconfig) s where regexp_replace(s,'\\s','','g')='search_path=pg_catalog,pg_temp')) then
      raise exception 'Function signature/owner/definer/path mismatch: %',r.name; end if;
    if has_function_privilege('anon',oid_now,'EXECUTE') is distinct from false
      or has_function_privilege('authenticated',oid_now,'EXECUTE') is distinct from r.client_execute
      or has_function_privilege('service_role',oid_now,'EXECUTE') is distinct from r.service_execute
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=oid_now and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Function ACL mismatch: %',r.name; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      left join pg_roles gr on gr.oid=a.grantee where p.oid=oid_now and a.grantee<>p.proowner
      and (a.is_grantable or a.privilege_type<>'EXECUTE' or
        ((gr.rolname='authenticated' and r.client_execute) or (gr.rolname='service_role' and r.service_execute)) is not true)) then
      raise exception 'Unexpected function grantee/grant option: %',r.name; end if;
  end loop;
  for r in select * from (values ${aclValues}) v(table_name,role_name,privilege_name,expected) loop
    if has_table_privilege(r.role_name::name,'public.'||r.table_name,r.privilege_name) is distinct from r.expected then
      raise exception 'Table ACL mismatch: % / % / %',r.table_name,r.role_name,r.privilege_name; end if;
  end loop;
  foreach h in array array['network_map_territories_v2','network_event_policies_v2','network_social_policies_v2'] loop
    if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass('public.'||h) and a.attname='enabled' and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then
      raise exception 'Gate default OFF missing: %',h; end if;
  end loop;
  for r in select * from (values ${triggers.map(t=>`(${q(t.name)},${q(t.table)})`).join(',')}) v(name,table_name) loop
    if not exists(select 1 from pg_trigger t where t.tgname=r.name and t.tgrelid=to_regclass('public.'||r.table_name) and not t.tgisinternal and t.tgenabled='O') then
      raise exception 'Trigger mismatch: %',r.name; end if;
  end loop;
  ${fingerprint} into h;
  if h is distinct from current_setting('safemelink.phase17_catalog_fingerprint',true) then raise exception 'Pre-existing business metadata changed'; end if;
  raise notice 'DDL STRUCTURE CHECKS COMPLETED. No fixture, RPC execution, JWT, concurrency or external effects test. ROLLBACK follows.';
end $phase17_assertions$;
select pg_catalog.jsonb_build_object('status','DDL_ASSERTIONS_PASSED_ROLLBACK_FOLLOWS',
  'tables',17,'columns',150,'functions',30,'explicitIndexes',21,'triggers',2,
  'functionalRpcTests',false,'fixturesCreated',false,'postRollbackCheckStillRequired',true) as phase17_result;
rollback;
`;
  const statements=topLevel(sql);
  assert.deepEqual(statements.filter(s=>/^(begin|commit|rollback|start transaction)\b/.test(s.token)).map(s=>s.token),['begin','rollback']);
  for(const p of parts)assert.equal(sql.split(p.body).length-1,1,'Migration body must occur exactly once');
  assert.doesNotMatch(sql,/\b(?:http_post|http_get|pg_notify|dblink|cron\.schedule|net\.http|copy\s+[^;]*program)\s*\(/i);
  return {sql,tables,functions,indexes,triggers,columns:tables.reduce((n,t)=>n+t.columns.length,0),
    inputs:names.map((name,i)=>({name,sha256:hash(sources[i])})),sqlSha256:hash(sql)};
}
module.exports={buildDdlValidation,inspect};
if(require.main===module){const b=buildDdlValidation();const chunk=process.argv.find(a=>a.startsWith('--chunk='));
  if(chunk)process.stdout.write(b.sql.slice(Number(chunk.split('=')[1])*20000,(Number(chunk.split('=')[1])+1)*20000));
  else if(process.argv.includes('--emit-sql'))process.stdout.write(b.sql);
  else console.log(JSON.stringify({status:'PREPARED_NOT_EXECUTED',tables:b.tables.length,columns:b.columns,functions:b.functions.length,indexes:b.indexes.length,triggers:b.triggers.length,
    sqlLength:b.sql.length,chunks:Math.ceil(b.sql.length/20000),sqlSha256:b.sqlSha256,inputs:b.inputs}));}
