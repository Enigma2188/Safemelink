-- READ ONLY / complete query / no functions invoked, no tokens or coordinates.
with signatures(name,role_name) as (values
  ('public.create_or_reuse_my_sos_v2(uuid,double precision,double precision,double precision,timestamptz)','authenticated'),
  ('public.finish_my_sos_v2(uuid,text)','authenticated'),
  ('public.process_safety_watchdog_v2(uuid)','service_role'),
  ('public.safety_sos_v2_lock_account(uuid)',null),
  ('public.safety_sos_v2_create_or_reuse(uuid,uuid,text,uuid,double precision,double precision,double precision,timestamptz)',null),
  ('public.safety_sos_v2_immutable_journal()',null)
), tables(name) as (values ('safety_sos_v2_accounts'),('safety_sos_v2_operations'),('safety_watchdog_v2_resolutions')),
checks as (
  select f.name as item,case when p.oid is not null and p.prosecdef
    and p.proconfig @> array['search_path=pg_catalog, pg_temp']
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and has_function_privilege('authenticated',p.oid,'EXECUTE')=coalesce(f.role_name='authenticated',false)
    and has_function_privilege('service_role',p.oid,'EXECUTE')=coalesce(f.role_name='service_role',false)
    then 'PASS' else 'WARN' end as result,
    jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) as detail
    from signatures f left join pg_proc p on p.oid=to_regprocedure(f.name)
  union all
  select t.name,case when c.oid is not null and c.relrowsecurity
    and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not exists(select 1 from pg_policy p where p.polrelid=c.oid)
    then 'PASS' else 'WARN' end,
    jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text)
    from tables t left join pg_class c on c.oid=to_regclass('public.'||t.name)
)
select item,result,detail from checks order by item;
