# Phase 12 — additive private emergency details (local preparation)

The legacy table/RPCs/medical and ICE consents are unchanged. No old text is
parsed/imported into structured ICE. New RPCs and `emergency_private_details`
are independent, with OFF defaults and owner-bound writes/deletion. The new
Android form has a separate save, clears on background/context changes and
cannot edit until its server load succeeds. A missing migration fails closed;
the legacy profile remains usable. No migration has been applied.

## Separate disclosures

- Structured ICE name/relation: explicit `share_ice`.
- Phone: additional `share_ice_phone`, requiring an ICE name and valid international
  number. The RPC withholds the phone without both consents. The recipient opens
  the native phone UI only after confirmation, fresh server consent verification,
  capability check and account/SOS/snapshot checks after asynchronous operations.
  This is not an automatic call or hidden-number service. Once an OS dialer opens,
  the app cannot erase its contents/history or revoke already disclosed numbers.
  A dedicated Android-only manifest mod adds ACTION_VIEW/tel visibility for
  canOpenURL on Android 11+, preserving existing SMS queries and adding no
  CALL_PHONE permission. It takes effect only in a future manually built binary.
- Stalking, domestic violence, other risk and instructions: optional private text;
  independent `share_safety`. No medical/legacy ICE consent is reused.

The new received RPC requires an active SOS and a current linked trusted contact,
the same existing DB trust relation, never a nearby-alert/community membership.
New fields are not exposed to the SOS owner through the recipient RPC: the owner
uses the private owner RPC instead. Missing/terminal/unauthorized results yield no
data. No new transport, GPS update, delivery or SMS/push contents are introduced.

The legacy free-text ICE field may already contain a phone number. Its existing
consent still shares that entire field with old clients. The new phone consent
cannot retroactively redact arbitrary legacy text without changing the existing
contract. The UI warns about this; owners must clear/redact that old field or turn
off the legacy ICE consent if they do not want it shared. The same caution applies
to sensitive details voluntarily written into legacy medical notes.

## Threat model / rollout blockers

Sharing with linked trusted contacts is not proof that those people are safe.
An aggressor can be in that circle; the UI warns that sharing includes all eligible
linked trusted contacts, including those added later. For now keep OFF when in
doubt. Per-recipient exclusion/allowlist, safety-safe deletion UI and a dedicated
consent/risk review are future decisions, not implemented here. No nearby safety
disclosure is allowed: any future option needs a new independent opt-in, explicit
recipient scope, expiry/revocation, abuse assessment and server-side filtering.

The declarations are not verified facts. Avoid third-party names/accusations and
unnecessary detail; no moderation or factual verification is promised. Device
access, screenshots and recipients remembering/copying data cannot be prevented
by clearing React state. Review legal/privacy basis, notice, retention/backups and
consent records before rollout; this document is not a GDPR compliance finding.
Deleting this row does not promise erasure from backups or from recipients.

Authorization is rechecked on each received fetch and before opening the dialer.
Revocation is visible at the existing recipient refresh (15s after completion),
not instantaneous remote push invalidation. Refresh hides/unmounts sensitive UI;
account/logout/background/blur guards hide it before effect cleanup. No additional
persistent cache exists. Already issued legacy profile disclosures are unchanged.

## Required manual Development verification, separately authorized

Before rollout review and apply only `20261014120000_emergency_private_details.sql`
on Development, then test with synthetic owner/trusted/outsider/nearby accounts
in BEGIN/ROLLBACK: optional fields, all defaults OFF, invalid lengths/phone/null
consents, owner mismatch, independent phone redaction, private/shared safety,
revocation/deletion, terminal SOS, unlinked trusted removal, anon/table grants,
and old APK legacy RPCs unchanged. Confirm postgres function ownership and RLS
bypass semantics of the deployment role. Real SQL/RLS testing has NOT occurred.

Native device tests: readable scaled input, keyboard/scroll, background clearing,
offline/unavailable server, cancel/unavailable dialer, account change during RPC,
and consent changes on another device. No real SOS or call should be used for
local tests. Builds/runs remain manual, exclusively by Tiziano.
