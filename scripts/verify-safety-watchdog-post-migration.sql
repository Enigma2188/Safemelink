-- ONE READ-ONLY catalog query; safe before or after application. No function invoked.
with tables(name) as (values ('safety_watchdog_sessions'),('safety_watchdog_outbox'),('safety_watchdog_deliveries')),
functions(signature,client) as (values
 ('public.start_my_safety_watchdog(uuid,text,integer,integer)',true),
 ('public.get_my_safety_watchdog(uuid)',true),
 ('public.confirm_my_safety_watchdog(uuid,integer)',true),
 ('public.cancel_my_safety_watchdog(uuid,integer)',true),
 ('public.process_due_safety_watchdogs(integer)',false),
 ('public.claim_safety_watchdog_outbox(uuid)',false),
 ('public.finish_safety_watchdog_outbox(uuid,uuid,text)',false),
 ('public.stage_safety_watchdog_deliveries(uuid,uuid,text[])',false),
 ('public.claim_safety_watchdog_delivery(uuid)',false),
 ('public.finish_safety_watchdog_delivery(uuid,uuid,text)',false),
 ('public.reconcile_safety_watchdog_deliveries()',false)
), required_indexes(name,is_unique) as (values
 ('safety_watchdog_one_active_owner',true),('safety_watchdog_owner_created',false),('safety_watchdog_due',false),
 ('safety_watchdog_outbox_due',false),('safety_watchdog_outbox_lease',false),
 ('safety_watchdog_delivery_due',false),('safety_watchdog_delivery_lease',false)
), result as (
 select 'TABLE '||t.name as item,case when c.oid is not null and c.relrowsecurity
   and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   and not exists(select 1 from pg_policy p where p.polrelid=c.oid)
   then 'PASS' else 'WARN' end as status,
   jsonb_build_object('exists',c.oid is not null,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),
     'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum)
       from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
     'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid)) from pg_constraint k where k.conrelid=c.oid),
     'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid),
     'policies',(select jsonb_agg(p.polname) from pg_policy p where p.polrelid=c.oid),
     'acl',c.relacl::text) as detail
 from tables t left join pg_class c on c.oid=to_regclass('public.'||t.name)
 union all
 select 'RPC '||f.signature,case when p.oid is not null and p.prosecdef
   and p.proconfig @> array['search_path=pg_catalog, pg_temp']
   and not has_function_privilege('anon',p.oid,'EXECUTE')
   and has_function_privilege('authenticated',p.oid,'EXECUTE')=f.client
   and has_function_privilege('service_role',p.oid,'EXECUTE')=(not f.client)
   then 'PASS' else 'WARN' end,
   jsonb_build_object('exists',p.oid is not null,'definer',p.prosecdef,'settings',p.proconfig,
     'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'clientRPC',f.client,
     'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
     'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
     'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'))
 from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
 union all
 select 'INDEX '||r.name,case when i.indexrelid is not null and i.indisvalid and i.indisunique=r.is_unique then 'PASS' else 'WARN' end,
   jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),'valid',i.indisvalid)
 from required_indexes r left join pg_index i on i.indexrelid=to_regclass('public.'||r.name)
)
select status,item,detail from result order by item;
