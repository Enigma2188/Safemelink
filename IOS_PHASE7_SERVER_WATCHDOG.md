# iOS Phase 7 — server safety watchdog (LOCAL / NOT APPLIED)

Phase 7B update: see `IOS_PHASE7B_VALIDATION.md` for the current delivery journal,
HOME_RETURN hard bound, validation scripts and explicit manual-SOS concurrency
blocker. Those sections supersede the historical Phase 7 draft below. No client
or shared manual SOS insertion behavior is changed; not production-ready.

Started 2026-09-28; resumed 2026-09-29 on `ios/phase-1-shell`.
Base `de48b22a54d2c1b22189181f1a531b9ae816bae8`.
Frozen main/origin/main: `a4cc228065afa4dbce8ee86f15b7185e9fddc975`.

## Resume inventory and scope

The interrupted work contained only the new migration
`supabase/migrations/20260928120000_safety_watchdog.sql` and internal worker
`supabase/functions/_shared/safetyWatchdogWorker.ts`. The first draft already
contained sessions, RPCs, atomic SOS escalation, outbox and an Expo consumer.
This continuation preserves them and adds bounded recovery of stale leases,
per-session processor error isolation/backoff, current-session read, a server-side
T1 freshness recheck before sending, tests and this review document.

No client file or existing migration/function is changed. Nothing is scheduled,
deployed or applied. No HTTP entry point has been added. Checkpoint and Go Home
iOS gates remain disabled. This is a review candidate, NOT production readiness.

## Backend reused (audit already completed before interruption)

- Existing `public.sos` model/status/closure/RLS, including nullable coordinate
  pairs and `location_updated_at`, as corrected by the September 18 migrations.
- `safety_sos_operations`: durable unique operation UUID = SOS UUID; no reset of
  existing SOS lifecycle or dispatch. Same advisory-lock namespace as
  `create_my_safety_sos`. The user-facing function is NOT changed or impersonated.
- `prepare_sos_delivery`: trusted recipients independent of coordinates; nearby
  requires actual coordinates and valid opted-in presence. Existing recipient
  resolver also handles multi-device active tokens, paging and token deduplication.
- Existing claim/attempt/complete/release dispatch RPCs. The existing
  `send-sos-push` HTTP function continues to require `auth.getUser(accessToken)`.
  The internal library does not call it using a fake user or service-role JWT.
- Existing NETWORK pg_cron job runs every five minutes: unsuitable for this job.

## Schema and state machine

`safety_watchdog_sessions` contains owner, server session UUID, request UUID,
mode, state, generation, duration minutes, finite repeat total/completed,
T1/T2, server audit times, per-generation operation UUID, SOS id and recovery
metadata. It contains no location, telephone, contacts, audio or message body.

`ACTIVE -> AWAITING_CONFIRMATION -> COMPLETE` for a single successful cycle.
On a repeat confirmation: same session, next generation, new operation UUID,
one new T1/T2, `ACTIVE`. No response: `ESCALATED`. Accepted STOP: `CANCELLED`.
Terminal states cannot be re-armed. There is no generic client state setter.
The DB partial unique index permits at most one ACTIVE/AWAITING session per owner.

Repeat enabled is represented by `repeat_total > 1`; repeat interval is
`duration_minutes`. Total is 1..10, interval 1..779 minutes, matching Checkpoint
limits. One repeat series has exactly one stable session UUID. A repeated old
generation command returns a stale-generation error, never advances twice;
re-read authoritative state after uncertain confirmation. Same-generation terminal
confirm/cancel retries return the terminal row.

Go Home accepts an ETA duration, never a device deadline, and disallows repeats.
IMPORTANT PRODUCT BOUNDARY: Android's ETA formula has a lower bound of 1 minute
but no explicit maximum. This local server draft conservatively uses the same
779-minute maximum as Checkpoint. Confirm this Go Home ceiling before Phase 8;
do not present it as an already approved Android limit. Android is unchanged.

## User RPC contract

All are SECURITY DEFINER with `search_path = pg_catalog, pg_temp`; persistent
objects are schema-qualified. Direct table access is revoked, including for
service_role; owner RPCs have EXECUTE only for authenticated.

| RPC | Arguments | Result |
| --- | --- | --- |
| start_my_safety_watchdog | request UUID, mode text, duration minutes integer, repeat total integer default 1 | session row |
| get_my_safety_watchdog | session UUID default NULL | own session, or own active session when NULL; unavailable raises |
| confirm_my_safety_watchdog | session UUID, generation integer | authoritative session row |
| cancel_my_safety_watchdog | session UUID, generation integer | authoritative session row |

`auth.uid()` is mandatory; owner is never accepted as input. Start serializes by
owner, rate-limits new requests to 30/hour and has unique(owner,request_id).
A retried request returns its original session even if terminal. Conflicting
configuration under the same request UUID is rejected. Known active SOS blocks
start. Session/read calls do not expose another owner's record.

## Server clock, T1, T2 and linearization

Server `clock_timestamp()` sets T1 = start + duration and T2 = T1 + 30 seconds.
T2 is stored at arming, not reset when a delayed worker reaches T1. At T1 the
processor commits AWAITING_CONFIRMATION and a deduplicated SAFETY_CHECK_DUE event.
When already past T2, the same transaction creates SOS and obsoletes stale T1
work. Push loss NEVER delays/cancels the SOS decision.

Confirm is valid in [T1,T2), even if the processor has not yet marked AWAITING.
At exactly T2 it is late. The authoritative request instant is the database
linearization point AFTER acquiring the session lock, not client time or the
beginning of a long transaction. Lock contention can therefore make an arrival
late; no claim of arrival-at-the-network-edge fairness is made.

Cancel uses the same lock and is valid before T2 only, from either active state.
An already escalated or overdue session cannot be reported as cancelled, even
when the scheduler is late. Nothing silently closes an already created SOS.

STOP offline: until the server acknowledges CANCELLED the session remains armed.
Future UI must show “Disattivazione in corso — connessione necessaria per
confermare”. Logout/account switching must reconcile or request STOP; simply
losing a client session does not cancel the server. No client implementation here.

## Internal processor / atomic escalation

`process_due_safety_watchdogs(p_limit integer default 100)` is service-role only.
Bound 1..500, indexed next-action key, ordered `FOR UPDATE SKIP LOCKED`.
Confirm, cancel and escalation serialize on the session row. Two workers cannot
escalate the same generation. Start's partial unique index covers concurrent starts.

Inside ONE transaction: lock/check deadline, advisory lock operation UUID,
create SOS + existing tombstone mapping, update session ESCALATED, insert unique
SOS_DISPATCH outbox event. SOS_DISPATCH is the concrete SAFETY_ESCALATED side effect.
Crash before commit rolls all of these back; after commit replay sees terminal
state. Existing mappings are validated for owner and SOS existence, never reset.
Deletion does not recreate a tombstoned emergency.

Each session transition has a subtransaction: an error rolls back its SOS/state/
outbox together, increments a sanitized failure counter and schedules retry with
30..300-second bounded backoff. Other sessions proceed. Operators must alert on
processor_failures and overdue backlog; a permanent schema/data error is not a
recoverable safety guarantee. No exception text is persisted or logged.

New server SOS has NULL coordinates (no invented/stale house position). Trusted
recipients still resolve; nearby cannot resolve without coordinates. This phase
does not authorize a new location-cache policy. Live tracking can only resume
through the normal future client lifecycle, not by waking GPS from the server.
No server SMS provider is introduced; device SMS cannot execute on a suspended
iPhone merely because a DB row was created.

## Outbox and delivery boundary

Outbox has unique(session,generation,kind), no token/body/coordinate storage,
PENDING -> CLAIMED -> ATTEMPTED -> ACCEPTED or UNKNOWN/FAILED/OBSOLETE.
Internal `claim_safety_watchdog_outbox(uuid)` and
`finish_safety_watchdog_outbox(uuid,uuid,text)` are service-role only.
Claims have 2-minute leases and at most five pre-send attempts, increasing
30-second backoff. Expired pre-send leases can be reclaimed. Fifth crashed claim
becomes FAILED; crashed ATTEMPTED becomes UNKNOWN in bounded housekeeping.

Worker `runSafetyWatchdogOutbox` handles at most five events per invocation,
uses existing SOS claim and recipient resolver, active token paging/dedup,
100-message Expo batches with 15-second timeouts and isolated batch errors.
No payload/token/error body logs. T1 data only type/session/generation/mode;
SOS data only type/sosId. Titles/bodies are generic. Existing channel IDs are
included so future multi-device Android recipients do not fall to another channel.

No-token/pre-send failures release for bounded retry. After the attempted marker,
uncertain delivery is NEVER automatically replayed. This avoids duplicate alerts
but is NOT exactly-once delivery. If all tickets are accepted, existing SOS dispatch
and outbox completion are acknowledged. ACCEPTED means Expo accepted, not displayed,
heard or read. DB failure after acceptance can leave UNKNOWN; core SOS remains.

CURRENT LIMIT: post-attempt partial rejection/timeout is conservatively UNKNOWN
for the event; there is no per-token receipt reconciliation or durable per-batch
retry journal in this phase. Other batches continue in the live invocation, but
a crash can leave unsent later batches. A verified retry/reconciliation policy
is a Phase 8 release blocker, not a claim that every push is delivered reliably.
Manually replaying UNKNOWN is unsafe. Before enabling users, decide whether to
add per-batch durable progress and Expo receipts, or explicitly accept this same
uncertain-attempt limitation as the existing dispatch contract.

Stale T1 work is checked at claim and attempted authorization using DB time.
An alert already authorized/in flight can arrive after cancel/confirm; future
client must re-read session/generation and NEVER arm/confirm from a push alone.

The worker is a library, NOT an exposed Edge endpoint. A later private runner
must supply server credentials securely and authenticate its scheduler caller.
No public endpoint, secret, cron HTTP token or deployment config is created here.
Core processor and transport must be scheduled separately so Expo stalls cannot
block deadlines. Server role is an operational privileged identity, not a client.

## Scheduler design — SCHEDULER CAPABILITY DA VERIFICARE

Target <=5-second scans with bounded batches and monitored backlog, not an exact
deadline guarantee. The installed Development version/config/latency are unknown.
`scripts/check-safety-watchdog-scheduler.sql` is a separate read-only inspection
script, not executed. It checks version, installed extensions, signatures/settings.
After that, inspect cron.job and telemetry using authorized read-only queries.

Current upstream pg_cron documents seconds intervals, but that does NOT establish
Development support: https://github.com/citusdata/pg_cron#cron-syntax
Conditional scheduling concept only (deliberately NOT executable migration):
named job every 5 seconds -> process_due_safety_watchdogs(100), only after version,
role privileges, timeout and load/latency verification. Otherwise choose a private
external short-period scheduler; do not substitute the five-minute NETWORK job.
No cron registration, extension change, HTTP invocation or secret is installed.

## Security / compatibility / retention

Tables have RLS and no client policies/direct grants. Seven functions revoke
PUBLIC/anon/authenticated/service_role first, then selectively grant owner RPCs
to authenticated and processor/outbox RPCs to service_role. Definer ownership
must be a trusted migration role; verify actual owner/ACLs/search_path on Development.
Clients cannot choose timestamps, arbitrary state, owner or operation UUID.
No existing RLS, auth provider, SOS function or Android function is replaced.

Reapplication uses IF NOT EXISTS for objects and CREATE OR REPLACE for functions;
it is safe for this exact schema, not a reconciler for a divergent partial schema.
Migration transaction is all-or-nothing. No historical data rewrite or deletion.
Session/outbox owner deletion cascades with profiles. Existing SOS operation
tombstones retain their original no-cascade semantics. Do not purge request IDs
without a separate retention policy: that would weaken start idempotency.

Mutual exclusion covers WATCHDOG sessions, not simultaneous legacy/manual SOS
creation on another device: frozen endpoints do not acquire watchdog locks.
Start checks existing SOS but does not eliminate a concurrent manual start race.
Cross-path mutual exclusion needs a separately reviewed integration before Phase 8;
no changes were made to frozen Android to pretend this race is solved.

## Tests and Development validation gate

`scripts/test-ios-phase7-watchdog.cjs` checks actual SQL contracts and executes the
actual transpiled worker with mocked DB/Expo: success, no tokens/release, existing
uncertain dispatch and independent 201-token batches after an early failure.
These are STATIC / MOCKED checks, NOT PostgreSQL runtime or concurrency proof.
Neither psql nor Docker is available on PATH; no database was started or contacted.

Required future isolated Development validation (not executed):

1. Apply reviewed migration under trusted owner; check ACLs/RLS/search_path.
2. Real authenticated A/B: owner start/read/confirm/cancel and outsider denial;
   anon cannot call any RPC; authenticated cannot call internals/direct tables.
3. Same start request twice -> same session; concurrent different starts -> only
   one active session. No device timestamps accepted. Retry after terminal -> same.
4. T1 -> exactly one event, T2 anchored to original T1, late processor does not
   create a new grace period. Confirm before T1/at T2/after T2 rejected.
5. Confirm 1..10 cycles: stable session, monotonic generation, one next deadline,
   final COMPLETE; stale duplicate confirm cannot increment again.
6. Two PostgreSQL connections: confirm/cancel vs processor; accepted cancel never
   produces SOS. Two processors -> exactly one SOS and tombstone per generation.
7. Crash/rollback injection before/after SOS insert: no orphan mapping/SOS/outbox;
   another failing session must not block healthy sessions.
8. T1 stale/cancelled events, expired lease, fifth failure and ATTEMPTED recovery;
   pre-send retry only, UNKNOWN never replayed; lease loss fenced.
9. Null-coordinate SOS retains normal owner closure and trusted recipient access;
   nearby absent without coordinates. No test SMS/push sent in DB-only tests.
10. Separate transport sandbox: Expo timeout/partial response/crash mid-batch and
    receipt/reconciliation policy; scheduler p95/p99 lag under load and outage.

Use isolated test accounts/fixtures and rollback for transactional cases. True
two-connection tests need scoped committed fixtures plus explicit cleanup, never
run an unrestricted processor against unrelated overdue Development sessions.

## Blockers before Phase 8 / product enablement

- PostgreSQL runtime, role isolation, concurrent race and failure-injection tests.
- Scheduler capability, private runner/authentication, measured latency and alerts.
- Delivery uncertainty/per-batch crash recovery policy and operational monitoring.
- Cross-device manual SOS/watchdog mutual-exclusion integration.
- Go Home maximum duration approval; no claim of Android's unbounded ETA parity.
- iOS arm/confirm/cancel reconciliation, pending offline STOP, notification routing,
  permission/preference gating and real-device tests. No client work in Phase 7.

## Final local results — 2026-09-29

One final regression pass: TypeScript PASS; full ESLint --max-warnings 0 PASS;
audit-static-checks PASS; iOS phases 1..7 PASS; iOS readiness PASS;
SOSLaunchRuntime and safety SOS recovery PASS; notification preference/sound PASS;
Live SOS PASS; voice lifecycle/restart PASS; safety expirations and Checkpoint
Repeat PASS; NETWORK client/backend PASS; Neighborhood MVP/discussions/nearby
invites PASS; Protection Signal PASS; Android CI non-build PASS; Expo config PASS.
git diff --check PASS; untracked-file no-index whitespace inspection found only
Git LF-to-CRLF conversion warnings, no whitespace errors.

SQL runtime/concurrency: NOT EXECUTED. Static SQL checks are not a PostgreSQL
parser or database test. No local psql/Docker available on PATH; no remote access.
Initial sandbox Node EPERM was resolved by executing the authorized local checks
outside that sandbox; no source or environment configuration was changed.

Android unchanged; iOS Checkpoint/Go Home remain disabled. No build, prebuild,
commit, push, migration application, deploy or remote Supabase operation.
