# Phase 7C — additive canonical SOS primitives, DORMANT

## Status / boundary

Local implementation only on `ios/phase-1-shell`. No application/native/client
file changes. No replacement of the applied Phase 7B migration or processor.
No remote SQL, migration application, scheduling, transport activation or build.

User-reported Development evidence supersedes the historical status paragraphs in
Phase 7B: sub-minute scheduler (~10 s), catalog/runtime checks, CANCEL COMMIT and
ROLLBACK concurrency passed; manual legacy insert vs watchdog race was reproduced.
The Phase 7B files are deliberately preserved byte-for-byte.

**The legacy Android race is NOT fixed by this dormant package.** Only callers of
the new protocol serialize with each other. Do not enable iOS preventive modes or
the production watchdog while a legacy writer can bypass this protection.

## Migration and dormancy

`supabase/migrations/20261003120000_safety_sos_canonical_v2.sql` is a new,
transactional, one-time incremental migration. Re-running fails atomically rather
than silently adopting schema drift. It assumes the reviewed Phase 7B schema,
including the `safety_watchdog_sessions_state_check` constraint.

It creates three RLS/private tables:

- `safety_sos_v2_accounts`: explicit account allowlist, `enabled` defaults false;
  NO rows seeded. Normal clients/service_role cannot change it directly.
- `safety_sos_v2_operations`: global operation UUID PK, owner, canonical SOS UUID,
  origin (`manual`/`watchdog`), original result (`created`/`reused_active`), time.
  Multiple operations can refer to one SOS. No cascading SOS/account FK: replay
  after deletion remains a tombstone, not permission to create a new emergency.
- `safety_watchdog_v2_resolutions`: immutable session/generation outcome and
  canonical SOS binding; operation references the new journal. No user PII,
  location or push token in either journal.

Association updates are blocked by triggers on the TWO NEW journal tables only.
No trigger/constraint/index/privilege change is installed on `public.sos` or the
legacy operation journal. Administrative DELETE remains possible for explicitly
identified Development fixtures; no application role has that privilege. Runtime
code never deletes journal records. Production retention is NOT implemented.

All six functions have SECURITY DEFINER, pg_catalog/pg_temp search_path and
schema-qualified persistent objects. PUBLIC/anon grants are revoked. The table
owner runs their controlled operations; RLS is enabled, not FORCE. Helpers have
no authenticated/service_role EXECUTE. No end-user accepts an owner parameter.

## New API

`create_or_reuse_my_sos_v2(p_operation_id uuid,
p_latitude double precision default null, p_longitude double precision default null,
p_accuracy double precision default null, p_observed_at timestamptz default null)`

Authenticated-only, owner from auth.uid(); account must be explicitly enabled.
Returns JSON with:

- `outcome`: created / reused_active / replayed;
- `operation_result`: original created / reused_active;
- `sos_id`: authoritative canonical UUID, even for a deleted historical SOS;
- `status`: actual enum value, NULL if deleted;
- `lifecycle`: active / terminal / missing;
- `sos`: actual owner-authorized row, NULL if missing.

No assumption of `open`. Reusing `accepted` leaves acceptance, dispatch, timestamps,
coordinates and lifecycle completely unchanged. Invalid coordinate pairs/ranges,
nonfinite values and cross-owner operations are rejected. Legacy operation IDs
are reserved and rejected, not silently migrated or rebound.

Replayed operations do not absorb newly armed sessions and never create a SOS,
even when the prior SOS has closed or been deleted. If preexisting legacy data
contains multiple active SOS, the RPC fails explicitly without picking a winner.

`finish_my_sos_v2(p_sos_id uuid,p_status text)` is a new opt-in closure adapter.
It locks the same account, checks owner, and calls the EXISTING close/cancel RPC;
neither old RPC is replaced. An unexpected unabsorbed active session blocks this
new adapter for reconciliation. Legacy clients keep their existing closure path.

## Lock ordering / concurrency

All new entry points take `safety_sos_v2_lock_account` before locking sessions or
reading/creating a canonical SOS. Namespace is `watchdog-owner:<UUID>` (also used
by Phase 7B arming), acquired by pg_try_advisory_xact_lock. Contention returns
40001, NOT a false successful result and NOT an aggressive internal retry loop.

Order: account -> session -> sorted operation locks/journal -> SOS -> outbox.
Operation locks are also nonblocking, so cross-account reuse/collisions cannot
create an operation-lock waiting cycle. A retry must restart the transaction with
the SAME operation ID, bounded backoff, and no external side effects repeated.
At READ COMMITTED subsequent statements read the winner's committed row. Higher
isolation levels can require serialization retry; no stale-snapshot guarantee.

One account per processor call; do not wrap arbitrary multi-account batches in
one long transaction. Lock hashes can serialize unrelated accounts, safely.
Row locks can still wait; integration needs bounded DB timeouts. No HTTP inside
these transactions. PostgreSQL deadlock/serialization errors must abort/retry the
whole DB operation, never silently fall through to another creation path.

`process_safety_watchdog_v2(p_session_id uuid)` is service_role-only and dormant.
It does a nonlocking owner lookup, account lock, then row lock with SKIP LOCKED
and revalidation. It is NOT the old row-first batch processor. One explicit
session is handled per transaction. T1/T2 and repeat configuration are unchanged.
T1 reuses the old outbox; T2 calls the SAME canonical helper as the new manual RPC.
Failures leave the transaction uncommitted; an external runner must retry safely.

## ABSORBED and delivery boundary

Manual activation with an armed session atomically creates/reuses the canonical
SOS, journals both operations, binds its generation, and marks it **ABSORBED**.
This is neither cancellation nor a falsely timed T2 escalation. Existing
`sos_id`/`escalated_at` remain NULL for ABSORBED; binding is in the resolution table.
All existing terminal consistency checks remain unchanged. Pending/claimed T1
outbox items are obsoleted; already attempted delivery cannot be unsent.

At T2 the outcome is ESCALATED, with actual canonical SOS UUID in the session,
even if it differs from the operation UUID. Reprocessing terminal resolved
generations returns the journal's live/terminal/missing result, never re-arms.
STOP via the old cancel RPC rejects ABSORBED/ESCALATED and cannot cancel that SOS.
Closing the SOS leaves the consumed generation terminal.

Only a newly created watchdog SOS queues SOS_DISPATCH. Reuse never resets dispatch
or creates another dispatch intent. The existing lease/journal transport is not
modified. **Manual V2 creates identity only; manual delivery/client integration is
not connected in this phase.** Before rollout, recovery of a manual creation with
a lost response before dispatch must be integrated/tested with the canonical
dispatch lease. This package is not a delivery-completeness certification.

Do not run the old and new processor concurrently on the same accounts: the old
processor is not participant in the new owner-lock contract. Existing Phase 7B
clients/processors are untouched, not magically made V2-compatible. Current
Android SMS, Voice, tracking, UI, recovery and error semantics are unchanged.

## Local checks versus actual PostgreSQL

- `node scripts/test-ios-phase7c-canonical.cjs`: static contract and no-change guards.
- `node scripts/test-ios-phase7-watchdog.cjs`: original static/mock regression.
- TypeScript `--noEmit`, ESLint of the new CJS, git diff --check.

These do NOT execute PL/pgSQL or prove MVCC/concurrency. No local PostgreSQL/Docker
command was available during preparation. No SQL was executed remotely.

## Development validation package — complete files, manual ONLY

First review this diff. Applying the new migration requires a separate explicit
authorization. After application do NOT add production allowlist accounts.

1. **READ ONLY** `scripts/verify-safety-sos-v2.sql`: catalog/ACL screening.
2. **MUTATING TRANSACTIONAL** `scripts/test-safety-sos-v2-development.sql`:
   whole file, BEGIN/ROLLBACK, no permanent changes. Refuses nonempty watchdog/V2
   tables, chooses two existing idle profiles, uses simulated auth roles/claims.
   Tests disabled gate, private helper grants, manual-first absorption, replay,
   same account different operations, cross-account rejection, accepted reuse
   with full row equality, immutable journal, close/terminal/missing replay,
   no late escalation, watchdog-first reuse and dispatch intent deduplication.
   On ANY error explicitly ROLLBACK before proceeding.

### Two connections (separate committed fixture for visibility)

ISOLATED Development only. ALL processors, consumers and clients using these
fixture accounts must remain inactive. Test creation can make real SOS rows;
no script invokes push, SMS, prepare_sos_delivery or external network calls.

For each row below, run the complete setup file, selecting the indicated scenario
literal in its INSERT. No UUID/email/account identifiers need to be assembled.

| scenario | TAB A file ending | Proof |
|---|---|---|
| manual_first | commit | manual first -> T2 replays absorbed canonical SOS |
| watchdog_first | commit | T2 first -> manual reuses same SOS |
| manual_first | rollback | rolled-back manual -> T2 creates one SOS |
| watchdog_first | rollback | rolled-back T2 -> manual creates/absorbs once |
| same_operation | commit | response-lost/same operation -> one journal entry |
| different_operations | commit | two manual operations -> same SOS |
| cross_account | commit | unrelated account succeeds independently |
| closure_first | commit | concurrent historical replay sees closed, no resurrection |
| closure_first | rollback | rolled-back closure -> replay sees still open |

Exact sequence:

1. Run `scripts/safety-sos-v2-concurrency-setup.sql` once. This COMMITs a named
   private fixture table, temporary account allowlist entries and one session.
2. TAB A: run either `scripts/safety-sos-v2-concurrency-a-commit.sql` or
   `scripts/safety-sos-v2-concurrency-a-rollback.sql` as specified. Holds 15 s.
3. Within **5 seconds**, TAB B: run `scripts/safety-sos-v2-concurrency-b.sql`.
   It must observe 40001 during actual overlap (different accounts instead prove
   immediate success, rolled back inside the probe). It then waits 18 s and makes
   ONE fresh-transaction retry. The default nonblocking lock intentionally does
   not wait inside the losing create RPC. Late TAB B produces BLOCKER, not a
   sequential false PASS. If scripts fail, ROLLBACK both tabs before inspecting.
4. When both finish, run complete READ-ONLY
   `scripts/safety-sos-v2-concurrency-verify.sql`. Every row must be PASS.
5. Run `scripts/safety-sos-v2-concurrency-cleanup.sql` as admin. It checks for
   unexpected operations/delivery activity, removes ONLY fixture-bound records,
   and drops the test-only table. Unexpected data -> STOP; never delete an
   unrelated emergency. Repeat with a fresh setup for the next matrix case.

Expected before cleanup: one canonical SOS for same-account cases; for the
cross-account case one per account. A rolled back result is absent, B is durable.
The scripts simulate auth.uid/roles, NOT a real signed JWT or Android PostgREST.
Those real-client tests remain mandatory before activation.

Lock-order stress: with a fresh setup, run the complete
`scripts/safety-sos-v2-lock-order-a.sql` and `scripts/safety-sos-v2-lock-order-b.sql`
in two tabs within 3 seconds. They intentionally acquire two account locks in
opposite orders (an adversarial caller, NOT the supported processor pattern).
Both ROLLBACK. At least one must return BUSY_40001, neither may deadlock/time out.
If both return ACQUIRED_BOTH there was no overlap: repeat, not PASS. Then use the
same fixture cleanup file; no SOS was created by these two lock stress scripts.

## Rollout / logical rollback

There are NO activated accounts, jobs, consumers, client imports or new legacy
guards after migration. Empty/disabled allowlist keeps new calls closed. To undo
an isolated rollout: prevent new requests, stop new scheduling/consumers, wait
for or reconcile in-flight transactions, then disable allowlist entries. Do not
remove journals, reset terminal sessions or resurrect absorbed generations.
Do not revert the state constraint while ABSORBED records exist. Logical rollback
means disable new entry points and retain historical data, NOT destructive DDL.

Before any real rollout: solve/test legacy PostgREST guard compatibility, delivery
ownership/recovery, mixed-client closure, existing duplicate reconciliation,
monitoring and real JWT/device behavior. Scheduler capability alone is not this
authorization. Checkpoint/Torno a casa iOS remain disabled. Android remains frozen.
