# Android pre-demo safety corrections — isolated candidate

Base: c9764962a1b723b45aba9266b9b556557590ace2. No remote/backend change.

## Reconciliation

Android cannot enumerate AlarmManager registrations through a public application API.
Recovery therefore re-registers the same generation/stage PendingIntents, replacing
the existing registrations rather than adding alarms. Stored notification flags
are not considered proof of registration. T1 and T2 remain the original absolute
deadlines, with T2 = T1 + 30 seconds. An existing native claim preserves its lease.
Foreground resume reconciles only existing sessions; it never creates a new session.

T1 is marked firstFired only after the native notification post succeeds. Publication
uses one stable notification ID and synchronized generation checks. Logs distinguish
alarm scheduling, receiver execution, publication attempt and post acceptance. None
of these proves that the user saw/heard the notification. A process crash between
post and persistence may produce another alert on recovery (same notification ID);
posting and SharedPreferences cannot be committed atomically.

## Auth and escalation

Auth null leaves the bounded native recovery mechanism intact. A positive different
account cancels; explicit logout/account changes retain their existing cancellation.
No SOS is attempted without an authenticated matching account. Operation ID,
generation, journal, claim lease and bounded retry limits are unchanged.

This is not guaranteed delivery: force-stop, permissions/channel changes, OEM
restrictions, unavailable Auth/network, service startup failure and exhausted retry
limits can still prevent escalation. Android has no server-side rescue watchdog in
this candidate. Late T1 does not extend T2 or provide a fresh 30-second window.

## Casa

Casa hydration is independent of contact/SOS reads, with account/generation guards.
Malformed coordinates/timestamps return null without deleting data. Real storage
I/O errors remain errors and do not silently erase an already displayed Casa.
The temporary address remains memory-only; Casa remains device-local/account-scoped.

## Phase 4 race corrections

Before changing runtime, the real transpiled Runtime/Service and extracted Home
hydration reproduced all three flags as true: CANCEL_RACE_OLD_REARMED,
STALE_RECONCILE_REPLACED_NEW_ALARM, OLDER_CASA_HYDRATION_OVERWROTE_NEW_UI_SAVE.
The same regression harness now expects false; I/O and native bridge boundaries
are controlled, not the JS functions containing the races.

Intentional starts invalidate older async revisions immediately. Recovery and
storage mutations run on one queue and reject different session identities.
Native recover/finish/operationId are synchronized identity checks and mutations;
recover never replaces a different native generation. Delayed arm remains
generation-checked. An obsolete rollback/headless cleanup finishes only its
expected generation. SOS completion persistence uses the same queue.
Native cancellation preserves a durable inactive tombstone so a crash before JS
cleanup cannot authorize revival. Missing native identity with a persisted old
generation fails closed, rather than silently preparing a fresh generation.

Late T1 reports that confirmation time has expired and asks to inspect SOS state,
not that SOS delivery succeeded. Before T2 it reports only the remaining seconds.
Home hides expired confirmation actions and their handlers re-check the absolute
deadline. Neither T2 nor claim/operation ID/recovery lease is extended.

Casa writes invalidate account-specific hydration revisions before storage awaits.
Account and Home load-generation checks remain in place. No storage key or
temporary-destination contract changes.

Native Kotlin changes have static API/bridge review, not compilation or device
execution in this phase. Notification posting and firstFired persistence remain
non-atomic across process death. Native/client SOS escalation remains bounded
best-effort; unavailable network/Auth, force-stop and OEM restrictions still matter.

### Required device validation before acceptance

Same APK fingerprint on both phones; foreground, background, locked screen, ordinary
process death, reboot, permission revoke/regrant, battery restrictions and DND.
Capture native T1/T2 schedule/fire/post timestamps plus Headless/SOS completion.
Test confirmation/Repeat/cancellation, Auth unavailable then recovery, account switch,
offline escalation recovery and absence of duplicate SOS. Verify saved Casa after
process death/login and failing contact hydration; temporary address loss remains
expected. Native changes have static coverage, not an Android runtime guarantee.
