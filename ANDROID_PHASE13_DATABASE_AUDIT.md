# Phase 13 — local database/privacy audit

No remote SQL or native build was executed. Sequential PostgreSQL tests are
prepared in `scripts/test-phase13-development.sql`, default blocked, single
transaction/ROLLBACK. Test identities are generated, not selected from real users.
No delivery/HTTP calls occur in the test. Existing DB triggers/worker side effects
must be reviewed externally before authorizing it; rollback cannot undo a network
side effect from an independently installed trigger.

## GPS findings

The Phase 8 RPC locks the owned SOS row before comparison and updates every GPS
field together. Same/older fixes return stale; the legacy boolean wrapper returns
true for stale so installed tracking is not stopped. Terminal false and missing/
foreign false are preserved; validation/auth/network failures remain errors.
Lifecycle writers also update/lock the SOS row, so order is serialized. An update
that commits before closure may be valid; closure that commits first makes the
RPC inactive. SQL runtime/concurrency is not proven by the model tests.

The existing hardening migration drops the owner's direct SOS UPDATE policy;
catalog preflight must confirm no later remote policy/grant restores a bypass.
Privileged administrative writers can bypass the RPC. Monotonicity is not a
universal trigger constraint and should not be described as one.

Clock skew: validated timestamps permit +2 minutes and -10 minutes. A future but
allowed fix can hold the timestamp high until the clock catches up; true/stale
keeps the watcher running but does not publish a newer physical observation.
Receiver future-timestamp handling may hide it or retain a last-known point.
Ordering does not prove physical freshness. now() is transaction-start time;
short PostgREST transactions fit this contract, long admin transactions do not
have a moving validation window. No skew policy change is implemented here.

## Privacy / legacy ICE findings

New table: no direct anon/authenticated/service_role grants, FORCE RLS, no
policies; fixed postgres definer with precondition BYPASSRLS/superuser. Qualified
relations and pg_catalog search_path avoid public object shadowing. Four new RPCs
bind owner writes to auth.uid/expected owner and trusted active-SOS reads to the
current linked contact. No nearby-alert branch. Catalog verification is still
required for inherited grants, owner roles and deployment drift.

Legacy ICE is independently exposed by get_my_emergency_profile (owner),
update_my_emergency_profile RETURNING (owner), and get_received_sos_emergency_profile
(owner or linked trusted contact while active and legacy consent enabled).
Old APKs can still read it. Turning the NEW ICE/phone consents OFF or deleting the
advanced row DOES NOT revoke the old field. Legacy medical notes can also contain
voluntarily entered phone/safety text. Privileged database access/backups remain
outside end-user RPC confidentiality; no new public/Radar/community read path was
found for the advanced data in the versioned code.

Recommended next implementation (not implemented): a prominent composite status
for legacy ICE and structured ICE, with a verified ONE transaction action to turn
off both legacy ICE sharing and new ICE/phone sharing WITHOUT deleting content.
Keep RPC return shapes intact and explain that an old client can subsequently
re-enable legacy sharing. Do not label a number globally hidden: medical notes,
previous disclosures and copies may contain it. A persistent global override
blocking old clients would change legacy semantics and requires a separately
approved incremental migration and explicit communication, not a silent change.
The present warning is necessary but not a guarantee; rollout requires that UX
decision. No corrective migration or application change was made in this audit.

## Read/revoke/closure races

Stable reader functions see a statement snapshot: an in-flight read can finish
with data whose consent/active SOS was valid before a concurrent commit. Future
READ COMMITTED calls see revocation; REPEATABLE READ may retain an old snapshot.
The dialer rechecks the RPC, then canOpenURL, then account/SOS/generation before
openURL. Consent/closure can change AFTER the last server check: this TOCTOU window
cannot be atomically coupled to Android's external dialer. ACTION_VIEW/tel is not
an automatic ACTION_CALL; no CALL_PHONE permission is added. No instantaneous
cross-device revocation, deletion of screenshots, copies or call history is possible.
Known context changes hide data before effect cleanup; sensitive data is not
persisted by the new components. Remote changes await the existing verification.

## Exact separately authorized Development plan

1. Externally verify Management API project identity/hostname for ONLY
   lwkxufnbjrpsehdkfmgy; review deploys, schedulers/consumers and host workers OFF.
2. Run phase13-development-preflight.sql READ ONLY. Review schema/functions,
   definitions, ownership, inherited privileges, policies and auth/SOS triggers.
   Before installation new objects may be absent; this is not a PASS for them.
3. Separately approve applying the complete two migrations. They have independent
   BEGIN/COMMIT; do not concatenate them into a supposed rollback-only test.
   Phase12 is one-time CREATE, not re-runnable. Phase8 CREATE OR REPLACE is repeatable
   for these signatures, but deployment owner/default privileges still matter.
4. Repeat catalog preflight. Edit only the two attestation literals in the complete
   transactional script after external checks; execute the whole file in ONE
   connection. On any error explicitly ROLLBACK before proceeding. Confirm no
   fixture accounts or data remain; no workers may run during the test.
5. Concurrent test requires an independently approved fixture setup committed
   BEFORE the two connections; rollback-only independent fixtures cannot prove
   contention on the same existing SOS. Do not use real SOS/accounts. Prepare this
   dedicated setup/cleanup package now prepared, but execute only after separate
   authorization: phase13-concurrency-setup.sql, A commit/rollback, B and
   phase13-concurrency-verify-cleanup.sql. Choose one of the five documented
   scenarios in fresh setup; execute A, B within 3 seconds, await both completions,
   then verify+cleanup. A holds the SOS row for 12s; B proves contention and retries
   once after 15s. If any statement fails, STOP, ROLLBACK the failed connection
   and inspect; verify-cleanup intentionally does not delete failed-test evidence.
   Required orders: newer-lock A vs older B; older A vs newer B; A rollback vs B;
   closure-first vs GPS and GPS-first vs closure. B uses lock_timeout=3s to prove
   overlap (55P03), then ONE explicit retry after A finishes. Final row must equal
   greatest accepted observation, or remain terminal with no later GPS write.
6. Revoke-first vs trusted read and read-first vs revoke, both COMMIT/ROLLBACK:
   demonstrate snapshot exposure for in-flight read, null on fresh post-revocation
   call, no claim that already returned data disappears. Repeat for SOS closure,
   removal of trusted link and phone-only consent revocation. Also test current
   account/JWT changes and anon/direct table denial using real SQL roles.

Blocking gates: remote schema verification, actual SQL/RLS/role testing, actual
two-connection evidence, legacy privacy UX decision and real-device dialer/map
validation. Local unit/static PASS is not production privacy or GPS proof.
