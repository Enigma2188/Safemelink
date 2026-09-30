# Phase 7B — local validation package, NOT production-ready

Android/manual SOS and all clients are unchanged. No migration applied, no remote
SQL, deployment, build, commit or push. Read together with Phase 7; this document
supersedes its old 779-minute HOME_RETURN and non-journaled delivery descriptions.

## Files and manual order

1. Run `scripts/check-safety-watchdog-scheduler.sql`: one read-only query. Metadata
   only, no job commands/tokens printed. Missing cron schema/table is safe.
2. Review `20260928120000_safety_watchdog.sql` in full. It has NEVER been applied:
   7B updates this local draft, not a previously applied migration.
3. Only with a new explicit authorization, apply the reviewed migration to an
   isolated Development environment. Do NOT schedule or deploy a worker yet.
4. Run `scripts/verify-safety-watchdog-post-migration.sql` (read-only). Inspect
   definitions, columns, constraints, indexes and policies as well as PASS/WARN.
   PASS is catalog screening, not semantic proof of SQL or ownership safety.
5. Run `scripts/test-safety-watchdog-development.sql` as one transaction ending
   ROLLBACK. It refuses nonempty watchdog tables, uses existing profiles, and
   simulates authenticated A/B via SET LOCAL ROLE + claims. No real JWT is tested.
   It never calls HTTP or prepare_sos_delivery. On error explicitly ROLLBACK.
6. Run the separate-connection procedures below only in isolated Development,
   with all watchdog scheduling/consumers OFF. Complete mandatory cleanup.
7. Require true authenticated JWT smoke tests, operational scheduler latency,
   private worker authentication and device notification tests before enablement.

SCHEDULER CAPABILITY DA VERIFICARE. Upstream added seconds intervals in 1.5:
https://github.com/citusdata/pg_cron/blob/main/CHANGELOG.md
Installed extension metadata does not prove matching binaries or latency.

## Review results and local corrections

All new functions schema-qualify persistent objects, fix search_path to
pg_catalog,pg_temp and revoke PUBLIC/anon. Four owner RPCs grant authenticated;
seven internal functions grant service_role only. Three tables have RLS/no client
policies and no direct grants. User arguments do not accept owner/deadline/state.
Unique active-owner index, request deduplication and session/generation guards
remain. T2 is always T1+30, never worker-now+30. SKIP LOCKED is bounded; per-session
failure rollback leaves durable retries without suppressing other sessions.
No trigger/index/constraint/lock was added to the shared SOS insertion path.
SQL syntax has been manually reviewed, NOT executed or certified by PostgreSQL.

Concrete 7B gaps addressed: no per-send durable progress in the interrupted worker;
HOME_RETURN incorrectly reused the Checkpoint product ceiling. Existing Phase 7
SQL table creation/functions remain a single new transactional migration.

## Journal and retry contract

New `safety_watchdog_deliveries`: unique(event_id,recipient_hash), immutable SHA256
fingerprint snapshot; no raw token, coordinate or body. Fingerprints are still
private pseudonymous metadata, not publicly accessible anonymized data.
Stage commits all planned sends and SOS dispatch reservation atomically. A lost
stage response is not followed by releasing the SOS claim. Its commit can be
discovered on later invocations. Maximum snapshot: 10,000 recipients.

Every send has PENDING/CLAIMED/ATTEMPTED/ACCEPTED/REJECTED/UNKNOWN/FAILED/OBSOLETE.
CLAIMED: 2-minute lease, maximum 5 pre-send attempts, 5*attempt seconds backoff.
Only pre-send PENDING/expired CLAIMED can be retried. ATTEMPTED crash/timeout or
lost acknowledgment -> UNKNOWN, never automatically replayed. Explicit Expo error
ticket -> REJECTED, terminal (not mislabeled delivered). Provider ACCEPTED means
ticket acceptance only; device receipt/read is not certified.
Each invocation stages at most 5 events and sends at most 20 individual messages.
Accepted/uncertain siblings never replay; pending siblings survive process death.
Parent reconciliation is DB-only and separately repeatable after a last-ACK crash.
Current token ownership/recipient eligibility is resolved again before each send;
rotated/revoked snapshots become OBSOLETE rather than targeting a different user.
No console/error payload logging added; existing recipient helper logs counts only.

Limits: once ATTEMPTED is committed, crash before HTTP is conservatively UNKNOWN.
Exactly-once provider delivery is impossible without provider idempotency; there
is no unsafe automatic replay. Rejected/unknown sends need operational inspection,
not a fake success. Receipts and user visibility remain future validation work.

## HOME_RETURN duration

779 comes from Checkpoint 12h59, NOT Android Go Home (its ETA has no explicit max).
Checkpoint stays 1..779. HOME_RETURN local server hard bound is 1..10,080 minutes
(7 days), no repeats. This is a proposed abuse/overflow guard, NOT a UX promise or
approved route duration. PRODUCT DECISION PENDING for the actual iOS UX range and
operational acceptance of this ceiling. No client input/control was changed.

## Manual SOS/watchdog contract — BLOCKER OPEN

A. No active SOS: T2 creates one SOS with the generation's stable operation UUID.
B. Manual SOS already active at T2: current processor may create another SOS.
C. Manual insert concurrent with T2: both transactions may commit different ids.
   Window starts whenever a watchdog is armed and another device activates SOS;
   the narrow race includes an uncommitted manual insert while T2 creates its row.
   The reverse order (watchdog first, manual second) is also unprotected.
D. Retried watchdog processing: same generation remains idempotent; no additional
   watchdog SOS. This does NOT deduplicate an unrelated manual operation.

Consequences: parallel emergencies/recipient selection/notifications, ambiguous
closure and live tracking. Neither a start-time existence check nor a lock used
only by watchdog can serialize the existing direct `.from('sos').insert(...)`.
Do NOT claim production readiness or enable preventive iOS modes.

### Phase 7C proposal — NOT IMPLEMENTED

First agree whether an existing open/accepted SOS is reused or an incoming launch
is rejected, and how the client receives the authoritative sos_id without reporting
a false activation failure. Then design ONE owner-scoped transactional entry path
used by every writer, with consistent lock order, canonical active SOS identity,
durable per-operation mapping and integration with closure. A constraint alone
would introduce errors into the frozen Android direct insert and is insufficient.

Required invariants: one incompatible logical active emergency per account;
no lost escalation; idempotent retries across all writers; no reset of lifecycle,
dispatch or creation time when reusing; closed SOS never resurrected; owner isolation;
watchdog cancellation cannot undo committed emergency; clear accepted-state policy.
Preserve Android manual countdown, direct-launch success/error semantics, SMS,
voice suspension/restart, recipient dispatch, live tracking, recovery and explicit
closure. No shared backend change is authorized by the current option 1.

## Two-connection tests (manual, NOT executed)

These require an isolated Development with no watchdog data and consumers OFF.
The setup intentionally commits ONE fixture for visibility to both connections.
Use the same database; do not reuse this fixture id outside this package. The
account is selected from existing profiles, never hardcoded or created.

### Setup (run once before each scenario)

```sql
begin;
do $$ declare u uuid; s public.safety_watchdog_sessions; begin
 if exists(select 1 from public.safety_watchdog_sessions) or exists(select 1 from public.sos where id='7b000000-0000-4000-8000-000000000002') then raise exception 'Fixture environment not empty'; end if;
 select p.id into u from public.profiles p where not exists(select 1 from public.sos z where z.user_id=p.id and z.status in ('open','accepted')) order by p.id limit 1;
 if u is null then raise exception 'Existing idle profile required'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 s:=public.start_my_safety_watchdog('7b000000-0000-4000-8000-000000000001','CHECKPOINT',1,1);
end $$;
commit;
```

### Scenario CANCEL: tab A, then tab B within 10 seconds

Tab A cancels while valid, holds the row and rolls back. Tab B uses the real
processor after setting only the fixture deadline past. Its UPDATE must wait for
A's row lock. Because A rolls back, escalation is correct, not cancellation loss.
Repeat with COMMIT instead of the final ROLLBACK in tab A to verify accepted STOP:
B must create no SOS. This one explicit variant changes only test transaction end.

```sql
begin;
do $$ declare s public.safety_watchdog_sessions; begin
 select w.* into strict s from public.safety_watchdog_sessions w where w.request_id='7b000000-0000-4000-8000-000000000001';
 perform set_config('request.jwt.claim.sub',s.user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id,'role','authenticated')::text,true);
 perform public.cancel_my_safety_watchdog(s.id,1);
end $$;
select pg_sleep(15);
rollback;
```

Tab B (complete block):

```sql
begin;
set local lock_timeout='25s';
with t as(select clock_timestamp()-interval '31 seconds' t1)
update public.safety_watchdog_sessions w set next_check_at=t.t1,confirmation_deadline_at=t.t1+interval '30 seconds'
from t where w.request_id='7b000000-0000-4000-8000-000000000001';
select public.process_due_safety_watchdogs(1);
select w.state,w.sos_id is not null as has_sos from public.safety_watchdog_sessions w where w.request_id='7b000000-0000-4000-8000-000000000001';
rollback;
```

Expected: A ROLLBACK -> B ESCALATED; A COMMIT -> B CANCELLED, has_sos=false.
Cleanup below after BOTH tabs have finished, then a fresh setup for next case.

### Scenario MANUAL/WATCHDOG: expected BLOCKER, NOT PASS

Tab A inserts through the unchanged manual table path and holds it uncommitted:

```sql
begin;
do $$ declare u uuid; begin
 select w.user_id into strict u from public.safety_watchdog_sessions w where w.request_id='7b000000-0000-4000-8000-000000000001';
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
set local role authenticated;
insert into public.sos(id,user_id,latitude,longitude) values('7b000000-0000-4000-8000-000000000002',auth.uid(),0,0);
select pg_sleep(15);
rollback;
```

Run the same complete tab B block above during these 15 seconds. B can create
the watchdog SOS without waiting for the manual insert. Two separate logical
SOS exist in concurrent transactions; both could commit. B and A ROLLBACK avoid
permanent emergencies. This demonstrates the OPEN BLOCKER, not its resolution.

### Mandatory cleanup after both tabs end

```sql
begin;
do $$ declare s public.safety_watchdog_sessions; begin
 select w.* into strict s from public.safety_watchdog_sessions w where w.request_id='7b000000-0000-4000-8000-000000000001';
 if s.sos_id is not null or exists(select 1 from public.sos z where z.id=s.operation_id or z.id='7b000000-0000-4000-8000-000000000002') then
   raise exception 'Unexpected committed SOS: STOP, inspect; do not delete an emergency automatically';
 end if;
 delete from public.safety_watchdog_sessions w where w.id=s.id and w.request_id='7b000000-0000-4000-8000-000000000001';
end $$;
commit;
```

Only the setup fixture is removed. Existing account/profile/SOS data is untouched.
No scheduling, transport worker, push or SMS may run during these tests.

## Validation status

Package prepared locally. SQL/catalog/concurrency scripts NOT executed; database
runtime remains REQUIRES DEVELOPMENT DATABASE VALIDATION. Static/mock tests do
not substitute for PostgreSQL parsing, MVCC locks or actual role/ACL validation.

Local final checks: TypeScript PASS, full ESLint zero warning PASS, Phase 7 tests
PASS, audit-static-checks PASS, Android CI non-build PASS. The read-only static
test initially misclassified a to_regprocedure catalog string as a scheduler
invocation; only that assertion was corrected and rerun, plus targeted lint.
No application/shared backend file changed. No test SQL executed.
