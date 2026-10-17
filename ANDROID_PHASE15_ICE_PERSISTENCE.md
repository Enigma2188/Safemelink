# Phase15 — persistent ICE revocation, LOCAL PREPARATION ONLY

## Contract and scope

New `ice_privacy_control` persists block, per-channel eligibility, revision,
consent version and server time. It contains no ICE text/phone. Defaults preserve
prior compatibility BEFORE a global revocation, without turning any sharing flag
ON. Revocation creates/updates the row even when both profiles are absent, sets
all eligibility false, bumps revision and turns all three sharing flags OFF.
Text/name/number, medical consent and safety consent are retained.

All user-facing writers (legacy update, advanced update/delete, global revoke,
new confirmation and the legacy getter that can insert) take the SAME per-owner
transaction advisory lock BEFORE any profile row mutation. Authorization precedes
locking. Hash collisions can serialize unrelated accounts, never authorize them.
Lock order: account lock, control row, legacy row, advanced row where applicable;
single-table wrappers hold the same account lock. No profile-row trigger acquires
an account lock AFTER an UPDATE already locked a row: that would invert the order.

READ COMMITTED is required. Stronger isolation can preserve a pre-revocation
snapshot despite waiting for a lock; wrappers reject it explicitly. Normal
PostgREST uses fresh request transactions, but deployed configuration must be
verified. A waiting legacy write resumes AFTER revocation and reads the committed
block; a write first can complete, then revocation turns it OFF. Rollback of
revocation leaves the previous policy, never a partly committed block.

`confirm_my_ice_sharing` is the ONLY unblocking contract: authenticated expected
owner, exact revision, version ICE_V1, explicit desired channel booleans and
existing valid content. Revoke vs stale confirmation returns 40001. Confirm first
then revoke ends blocked. Re-enabling structured ICE alone does NOT authorize old
legacy writes or phone disclosure. Old APIs can edit private text with flags OFF,
but cannot expand eligibility. An authenticated versioned request is auditable
protocol evidence, not proof of a physical human tap or informed legal consent.

The new consent RPC is prepared in SQL/types; the native consent/reenable UI is
NOT implemented. The current panel explicitly says reenabling is unavailable in
this build. This is a rollout blocker, not a reason to simulate confirmation.

## Legacy compatibility impact (intentional, privacy takes precedence)

Signatures/return shapes are preserved. Implementations are wrapped; originals
are renamed to _ice15_* helpers and all anon/authenticated/service_role EXECUTE
grants are revoked. Only fixed canonical wrappers are granted authenticated access.
Helper ownership is fixed to postgres. Direct normal-user table access is revoked;
RLS remains enabled, and control/advanced tables use FORCE RLS. Privileged database
owners/administrators are trusted and can override database policy; this is not
protection against compromised administrative credentials or backups.

While blocked an old ON save returns 42501/ICE_SHARING_BLOCKED, NOT false success.
Because the old form saves medical and ICE values together, its ENTIRE save fails
if it still requests ICE ON. Turning ICE OFF allows a private save. Old hooks show
the returned error; a local unsaved switch may remain ON until reload. Owner reads
report effective OFF. Old APKs cannot clear the block. This is a functional
compatibility restriction, explicitly authorized by privacy priority, and must be
communicated before deployment. No old migration was modified.

Both receiver RPCs retain trusted/auth/active-SOS checks, then mask blocked ICE.
Safety/medical content remains governed separately and can contain voluntarily
entered phone text: no global number secrecy is promised. New owner reads keep
contents visible to their owner while reporting effective consents. Status includes
optional block/revision metadata; client code still accepts Phase14 responses as
unprotected, never assumes the new backend is installed.

## Boundaries requiring explicit rollout checks

- A response already in flight can contain its pre-revocation statement snapshot;
  copies, screenshots and OS phone history cannot be revoked. Fresh reads after
  commit obey the block. Dialer verification and Android opening are not atomic.
- Drain PRE-migration requests and pooled prepared plans before deployment. A
  previously executing original function cannot be retroactively wrapped. Apply
  only in a quiet window, refresh PostgREST schema/plans, verify catalog grants
  and helper denial, then admit requests. No scheduler/worker activation is needed.
- Stored dependencies or unexpected overloads/policies cause the migration to
  FAIL rather than silently preserve a bypass. Review pg_depend, functions,
  inherited role grants, all privileged writers and database drift before apply.
- Phase14 never stored a durable global-revocation marker. Historical explicit
  revocations before Phase15 cannot be inferred from OFF booleans. Confirm Phase14
  has not been used remotely (as currently reported), or obtain a separate safe
  history/backfill decision. Do not silently block all users based on guessed history.
- Deleting only advanced profile contents never deletes control. Account/profile
  deletion cascades the control as part of deleting the account, not reenabling it.

## Verification and application order (separate authorization)

Order: existing emergency schema -> 20261013120000 GPS -> 20261014120000 private
details -> 20261015120000 composite -> 20261016120000 persistent revocation.
The new migration is one-time and transactional, NOT rerunnable after helper
renames. On failure the whole migration must roll back; never resume midway.
No automatic down migration: reverting wrappers would remove privacy protection.
Prefer disabling clients/reenable operations and a forward fix, preserving control.

Before remote tests: verify ONLY Development lwkxufnbjrpsehdkfmgy externally,
drained transactions/quiet workers, role postgres bypass, expected schema/RPCs,
no alternative grants/policies/writers. Review/apply the complete migration only
after explicit approval. Never execute historical Phase13/14 SQL tests expecting
legacy reactivation as a Phase15 success gate.

`test-ice-persistent-development.sql` is default blocked, synthetic identities,
single transaction/ROLLBACK, with a temporary trigger proving failure rolls back
the revision too. DDL table locks require quiet Development. Review existing
auth/SOS triggers for external effects, since SQL rollback cannot undo an external
transport from unrelated installed triggers. No delivery/HTTP call is in this test.

Prepared two-connection scripts (NOT RUN): `ice15-concurrency-setup.sql`,
`ice15-concurrency-a-commit.sql` / `ice15-concurrency-a-rollback.sql`,
`ice15-concurrency-b.sql`, `ice15-concurrency-verify-cleanup.sql`, under scripts/.
After external preflight, explicitly unlock setup, select scenario and a_commits,
run setup, run the matching complete A script, and start complete B within 3s.
Wait for BOTH to finish before verify/cleanup. Repeat fresh setup for every case.
These concurrency fixtures COMMIT and therefore REQUIRE the separate cleanup;
only the sequential package is entirely rolled back. A failure preserves evidence:
inspect and authorize targeted cleanup, never blindly replace an existing fixture.

Two-connection scenarios use a committed synthetic fixture, fresh per case:
writer first / revoker first, both A COMMIT and A ROLLBACK; confirmation first /
revocation first with stale expected revision; missing legacy profile insertion;
read before/after revocation, terminal SOS, removed trusted link, wrong account,
helper/direct-table/anon denial. Demonstrate real contention using bounded lock
timeout before one explicit retry; inspect final block/revision/flags and cleanup
only the test identities. Sequential/model tests do not establish these outcomes.

GO is only for independently reviewed Development verification, NOT rollout.
No remote SQL/build/run/commit/push was performed. Native explicit re-consent UI,
real SQL/concurrency, deployment drain and old-APK error UX remain blockers.
