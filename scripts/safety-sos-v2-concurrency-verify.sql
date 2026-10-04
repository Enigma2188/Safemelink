-- READ ONLY. After BOTH tabs finish. IDs/results only, no coordinates/tokens.
with fixture as (select f.* from public.safety_sos_v2_test_fixture f), checks as (
  select 'overlap / independent-account proof' as name,f.contention_verified as ok from fixture f
  union all
  select 'B completed',f.b_result->>'sos_id' is not null from fixture f
  union all
  select 'same account converges; other account isolated',
    case when f.a_result is null then true
      when f.scenario='cross_account' then f.a_result->>'sos_id'<>f.b_result->>'sos_id'
      else f.a_result->>'sos_id'=f.b_result->>'sos_id' end from fixture f
  union all
  select 'at most one active SOS per fixture account',not exists(
    select s.user_id from public.sos s,fixture f where s.user_id in (f.owner_id,f.other_id)
      and s.status in ('open','accepted') group by s.user_id having count(*)>1)
  union all
  select 'one canonical operation binding, existing owned SOS',not exists(
    select 1 from public.safety_sos_v2_operations o,fixture f
    where o.user_id in (f.owner_id,f.other_id) and not exists(
      select 1 from public.sos target where target.id=o.canonical_sos_id and target.user_id=o.user_id))
  union all
  select 'closure replay is historical, never resurrection',case when f.scenario='closure_first'
    then f.b_result->>'outcome'='replayed' and f.b_result->>'status'=case when f.a_result is null then 'open' else 'closed' end
    else true end from fixture f
  union all
  select 'same operation deduplicated',case when f.scenario='same_operation' then
    (select count(*) from public.safety_sos_v2_operations o where o.operation_id=f.manual_op)=1 else true end from fixture f
  union all
  select 'no generated SOS without journal',not exists(
    select 1 from public.sos s,fixture f where s.id in
      ((f.a_result->>'sos_id')::uuid,(f.b_result->>'sos_id')::uuid)
      and not exists(select 1 from public.safety_sos_v2_operations o where o.canonical_sos_id=s.id))
)
select name,case when ok then 'PASS' else 'BLOCKER' end as result from checks order by name;
