# Phase 14 — composite ICE privacy (local, not deployed)

## Implemented additive contract

`get_my_ice_privacy_status(expected_owner_id)` returns only owner-scoped flags,
legacy text presence and server verification time: not text/name/phone. It reads
legacy and advanced consents in a single statement snapshot. The UI displays that
verified snapshot, never unsaved switch values as applied privacy, and warns about
legacy free text without parsing it. Medical and personal-safety sharing remain
separate; phone data can still be voluntarily present in old medical notes.

`revoke_my_all_ice_sharing(expected_owner_id)` updates legacy ICE, then advanced
ICE/phone in one RPC transaction. It preserves every ICE value, medical consent
and safety consent. Failure aborts the transaction; timeout is uncertain, not
success. Strict client parsing requires all three returned flags false and the
expected account. Missing RPC means non-operational UI, not simulated revocation.
After confirmed OR uncertain completion, the owner forms reload; stale ON drafts
are not silently kept as a subsequent save. Same-screen saves and revoke cannot
be intentionally run together through the UI. Reads/callbacks are owner/version/
foreground guarded; no new sensitive logs, push/SMS or persistent cache exists.

Migration `20261015120000_ice_composite_privacy.sql` requires Phase12 installed.
It is a one-time additive CREATE migration, NOT applied. It adds no receiver read
path and changes no legacy RPC signature or body. Default OFF from Phase12 remains.
Fixed lock order is legacy row then advanced row. Existing single-table writers
have no reverse two-table lock order; verify actual database triggers separately.

## Persistent protection — IMPLEMENTATION STOPPED, approval required

An old APK can still call update_my_emergency_profile(...,true), including a request
already pending when revocation commits. It can reactivate legacy sharing after
the new transaction. Concurrent creation of a previously absent legacy row is
also not fenced by UPDATE on a missing row. Newer clients can likewise resave ON
from another device. The status is explicitly point-in-time, not permanent privacy.

Proposed next contract (NOT implemented / no migration prepared for it):

1. Persist an owner-bound ICE block/consent revision when global revocation occurs.
2. All ICE readers must apply it (legacy received RPC AND new structured RPC).
3. All writers must honor it. Legacy attempts to set sharing ON must return an
   explicit authorization/consent error while blocked, NOT silently ignore or
   overwrite the block. Owner getters must report effective OFF consistently.
4. Only a new explicit owner consent RPC with expected consent revision/version
   may clear the block; old endpoints cannot clear it or bypass it by recreating
   a profile. Serializing on a persistent owner row must cover missing profiles.
5. Preserve medical/safety choices and text; do not infer phone numbers from free
   text. Define separately whether the block covers only ICE or broader disclosures.

This changes the meaning of old successful legacy writes. Although return shapes
can stay the same, old APK toggles may receive an error instead of enabling ICE.
That is a real compatibility/product change requiring separate authorization,
updated communication and PostgreSQL/concurrency tests BEFORE implementation.
No persistent override, trigger or replacement legacy RPC was introduced here.

## Reader and legacy inventory

- Legacy owner get/update return ICE text to its owner; update writes its own
  legacy sharing flag. Existing legacy received RPC shares full text with owner/
  linked trusted contacts only during open/accepted SOS and legacy consent ON.
- Advanced owner get/update/delete affect only the advanced table. They cannot
  revoke the legacy path. New received RPC shares name/relation with share_ice,
  phone with BOTH share_ice and share_ice_phone; safety uses share_safety only.
- New composite status/revoke are owner-only and do not expose values to any
  recipient. Old APK receivers work unchanged; an explicit new revocation makes
  the legacy RPC withhold ICE in exactly the same way as legacy consent OFF did.

## Residual risks and Development prerequisites

Already seen/copied data and OS dialer/history cannot be withdrawn. An in-flight
statement can use a pre-revocation snapshot; the existing recipient refresh hides
data while checking and eventually observes new consent. Backend verification
and OS phone opening are not one atomic operation. No new instant invalidation
claim or global number secrecy is made.

Before separately authorized Development testing: external project/host identity
verification, quiet workers, Phase12 schema/grants verified, then review/apply the
complete new migration. Test real owner mismatch/anon grants, status combinations,
preservation of all values, exception after first UPDATE rolling BOTH writes back,
and concurrent legacy saves before/during/after revoke (including missing rows).
Explicitly EXPECT legacy reactivation to remain possible in this additive phase.
Test fresh vs in-flight recipient reads, terminal SOS, account switches and missing/
timeout RPC handling. Local SQL assertions/mock results are not database proof.

`scripts/test-ice-composite-development.sql` is prepared, NOT executed and blocked
by default. Its one transaction uses synthetic accounts and a temporary trigger
to force failure of the second UPDATE, then asserts both consents stayed ON.
The trigger is created on the advanced table within the same rollback transaction;
it requires a quiet Development window because DDL takes table locks. Review
existing auth/profile/SOS triggers for external side effects first; rollback does
not undo external network actions from unrelated deployed triggers. No delivery
function or HTTP transport is invoked by the package itself. This sequential
test does not establish two-connection isolation; those cases still need a
separately authorized, dedicated concurrency package.

Rollout of a promise that old APKs cannot reactivate ICE is BLOCKED pending the
persistent-contract decision. No build/run, migration application or remote call
was performed. Only Tiziano launches builds/workflows manually.
