# iOS Phase 6 — safety architecture review

Reviewed 2026-09-28 on ios/phase-1-shell, starting at
876c2bf59c53871c7b9cbda7fd06fe9cb4c5234e.
Android baseline: a4cc228065afa4dbce8ee86f15b7185e9fddc975.

## Decision

Do not enable Checkpoint / repeated Checkpoint / Go Home on iOS yet.
Keep the existing Home platform gates. No production code changed in this review.
Local notification delivery does not run the deadline escalation code. Enabling
the existing controls would offer an incomplete safety mode, not the existing
Android semantics. A foreground-only product requires an explicit separate
product decision; Go Home must not silently become a reminder.

The added tests characterize the existing implementation and its gates. They do
not certify native iOS notification delivery or a completed Phase 6 implementation.

## Existing Android implementation

Home startCheckpoint/startGoHome persist their source snapshots, then call
SafetyExpirationService.schedule. SafetyExpirationRuntime persists expiresAt
and confirmationExpiresAt = expiresAt + 30 seconds. Android prepares a native
generation and stable operationId. SafetyNotifications arms both native alarms.

SafetyDeadlineStore uses setAlarmClock for T1 and T2, private durable storage,
generation-matching PendingIntents and synchronized claim/cancel. T1 posts the
prompt. T2 starts SafetyEscalationService with a bounded wake lock / Headless JS.
SafetyHeadlessTask verifies account and native generation before processDue.
Runtime invokes the ordinary SOSService.completeSOS with escalationOperationId.
The journal and create_my_safety_sos provide durable logical SOS idempotency.
Native lease is five minutes with bounded recovery attempts (three); this is not
an unlimited execution guarantee. Completion is persisted before source cleanup.

Single Checkpoint: custom duration 1–779 minutes, one source snapshot, one T1/T2,
positive response cancels, no response invokes the ordinary SOS. Home uses
Date.now and absolute timestamps rather than counting timer callbacks.

Repeat: repeatEnabled/interval/total/completed persist, total capped at ten.
Positive response awaits cancellation, increments completed and schedules only
one next checkpoint; final response cleans up. No response ends the chain in SOS.
IMPORTANT: the current code creates a NEW startedAt on each cycle. The series
configuration survives, but there is no immutable series identifier. Calling it
one persistent session ID would be inaccurate. Do not alter Android to resolve
this in the iOS phase. A future iOS/server series needs its own stable series ID.

Go Home: stored home position + a foreground position yield distance and an ETA
for walking/cycling/driving; user confirms the estimate. The active snapshot
persists ID, startedAt, expiresAt, duration, distance and transport, not a new
continuous location tracker. At expiry the same 30-second confirmation and SOS
runtime apply. It is not merely a reminder.

Home guards starts with preventiveStartInFlightRef, current SOS state and the
other preventive mode. Manual SOS supersedes preventive state. Account change
invalidates generations/refs and cancels old schedules; logout requests cleanup
before signout. Runtime cancellation refuses an already executing escalation.
SOSService rechecks the authenticated account across asynchronous work.

## iOS states, separately

| State | Local notification | Existing JS deadline/escalation capability |
| --- | --- | --- |
| Foreground and JS responsive | In-app presentation subject to notification policy | Can evaluate T1/T2 and invoke SOS; network completion is not guaranteed |
| Background, briefly executing | OS can deliver a scheduled notification | Remaining execution time is not guaranteed through T2 |
| Screen locked | OS can present notification, subject to permissions/Focus/settings | Lock does not grant execution; app may be suspended |
| Suspended | OS owns scheduled notification | JS timers/runtime do not execute on a guaranteed deadline |
| Terminated by system | Scheduled OS notification may still be delivered | No guaranteed process launch for this local alert |
| User force-quit | Already scheduled alert is distinct from process execution | No guaranteed automatic relaunch or SOS escalation |

Apple does not guarantee timely notification presentation either. No safety claim
may depend on notification receipt, a listener, silent push, background fetch,
audio, Live SOS location callbacks or permanent background JS.

## Concrete implementation gaps found

1. Both Home entry points currently return early on iOS. Preserve those gates.
2. ensureSafetyMonitoring intentionally returns on non-Android; no native T2
   execution mechanism exists on iOS.
3. SafetyNotifications has a DATE request with stable safety-{sessionId}-confirm
   identifier and no Android channel in the iOS trigger. But ensure trusts the
   persisted confirmationNotificationScheduled boolean, not the actual OS queue.
   It does not reconcile getAllScheduledNotificationsAsync. Do not claim verified
   native deduplication/recovery from string-matching tests.
4. Notification payload contains only type=safety_check. SOSNotificationCenter
   parses sos_alert/sos only; it ignores safety_check and may consume the cold
   response. There is no dedicated account/generation-aware safety navigation.
5. Shared processDue, if invoked after T2, escalates immediately. It does not
   restart a 30-second window. This preserves timestamps but could surprise an
   iOS user reopening long after an unseen alert. It must not be enabled without
   the approved server state/late-response semantics.
6. iOS schedules have no native generation/operationId; a persisted executing
   claim after process death is treated as uncertain and not replayed. Native
   Android durable recovery does not transfer automatically to iOS.
7. Cancellation of the notification is fire-and-forget and suppresses failures.
   Existing Android behavior is frozen; a new iOS adapter needs awaited,
   serialized native notification cleanup and reconciliation before readiness.
8. Home reads the account preference; Settings separates that preference from OS
   permissions and offers openSettings/canAskAgain handling. However a false
   configureNotifications result only sets a warning in the dormant shared
   start path. Future iOS start must reject before arming/persisting an active
   session when either preference or alert authorization is unavailable.
9. Repeat has no in-handler confirmation lock, and Go Home confirmation does not
   await cancellation. These paths require explicit race tests/serialized iOS
   handling before iOS enablement, without changing frozen Android behavior.
10. Date.now tolerates timezone changes with ISO deadlines, but manual clock jumps
    can advance/delay local escalation. It is not an authoritative server clock.

## Proposed iOS adapter after backend contract approval

Keep the same conceptual controls and transport options. Add an iOS-specific
adapter, never route Android through it. Require account-scoped user preference
AND actual OS alert authorization. Provisional/quiet delivery must not be treated
as an audible-alert guarantee. If blocked, offer the existing Settings flow.
No Always location or microphone requirement; Go Home uses a foreground fix for
the ETA only. Do not request background execution privileges for this feature.

Persist server session ID, owner, revision, cycle, mode, expiresAt and
confirmationExpiresAt. One serialized notification operation per active session:
stable opaque identifier (no account/coordinates in payload), inspect native
pending requests, replace only on deadline/revision change, cancel obsolete
requests, await cleanup, and revalidate account/generation after every await.
Only one next-cycle notification, never pre-schedule a whole repeat series.

App startup, AppState active and notification tap converge on one reconciliation.
Wait for auth and navigation readiness, fetch server state, verify owner/revision,
then restore the correct panel/prompt. Stale taps are ignored. Tapping is neither
positive confirmation nor authorization to reset a deadline. Timers only redraw
the UI; no local timer creates an independent SOS. Offline state must explicitly
say the server state/confirmation is not yet verified. Never grant a fresh
30 seconds at reopen; overdue uses the authoritative persisted server T2.

## Concrete watchdog design (proposal only, no SQL or remote changes)

The repository has a five-minute pg_cron job for NETWORK expiry, not a safety
scheduler. Reusing that cadence cannot implement a 30-second confirmation window.
Use a durable delayed-job worker or an independently monitored short-period
service-side scheduler (target <=5-second scan, measured delay and capacity).
Scheduler punctuality and downstream delivery have operational SLOs, not an
absolute guarantee. Do not claim an exact 30 seconds under outages.

Server-owned safety_sessions should contain owner, stable session/series UUID,
mode, state (armed/confirming/escalated/completed/cancelled), revision, cycle,
repeat interval/total/completed, server T1/T2, creation/update timestamps,
arming device, last command ID and eventual sos_id. Enforce one incompatible
active session per owner transactionally. Generate times on the server from a
bounded duration; client timestamps cannot determine authorization or expiry.
No home coordinates are necessary for the deadline scheduler itself.

Start is authenticated, idempotent by client command UUID, and effective only
after server acknowledgement. Failure/offline => NOT ARMED, clearly visible.
Mode consent must explicitly disclose that a server session survives suspension
and that an offline cancellation is not confirmed. This product contract needs
approval before enabling the feature.

At T1 the worker locks the row, validates revision/state and transitions to
confirming. It enqueues a deduplicated alert to the owner in an outbox. T2 remains
the original server T1+30 seconds, not push delivery time. If the worker is late,
record lateness; do not silently reset the deadline or claim the alert was seen.
Push failure is not evidence of safety and must not silently cancel the session.
Whether a documented bounded grace is acceptable is a product decision, not an
implicit code change. No additional grace is assumed in this proposal.

Confirm/cancel and the T2 worker take the SAME row lock. Commands include expected
revision/cycle and command UUID. Before escalation commits, a valid cancellation
wins if it obtains the lock first; after escalation commits it returns ALREADY
ESCALATED with sos_id. Do not show cancellation success in that case. A late
confirmation must not delete/close an existing SOS implicitly: use the normal
explicit SOS closure flow. A completed command retry returns the stored result.

Positive repeat response increments completed exactly once under the lock. If
remaining, preserve the series UUID, increment cycle/revision, derive a single
next T1 from server confirmation time + interval and T2=T1+30s. Otherwise mark
completed. No response escalates and prohibits all future cycles. SOS activation
and preventive sessions need a shared server-side mutual-exclusion transaction;
local Home refs alone cannot serialize another device with the watchdog.

Escalation key: immutable server-generated UUID unique to (session_id, cycle),
not revision (revision changes must not permit another SOS for the same cycle).
In ONE database transaction lock/check state, create or reuse the SOS mapping,
mark escalated and add unique outbox work. Worker lease/recovery retries reuse
that UUID. Cancellation cannot overtake an already committed logical SOS.

Existing create_my_safety_sos requires auth.uid() = expected_user_id; a service
worker cannot simply impersonate the user or pass a service-role token to it.
A future restricted server RPC must validate the stored session and transition
atomically; it may reuse the existing mapping/tombstone rules through a carefully
factored internal primitive. Keep existing authenticated RPC and Android intact.
No direct client SELECT/UPDATE on protected scheduler/outbox tables; owner-scoped
RPCs only. Worker RPC EXECUTE only to the server role, fixed search_path, explicit
object qualification, bounded queries and account-state checks.

The current send-sos-push endpoint requires a REAL user JWT via auth.getUser and
checks ownership. It cannot be called as an offline user's background identity.
A separate private outbox worker/internal dispatch contract is necessary; do not
weaken that endpoint. Preserve prepare_sos_delivery server-side selection and
claim/attempted/completed/release semantics. Exactly-once logical SOS is feasible;
exactly-once Expo delivery after an uncertain network attempt is not. Reuse lease
rules, never blindly resend an uncertain batch. Push receipts do not prove the
person saw the alert. iOS/server cannot send automatic device SMS; do not claim
SMS parity or a new SMS provider.

Without fresh coordinates, create the permitted null-coordinate SOS. Trusted
contacts remain eligible; nearby selection requires an appropriately fresh valid
location. Never present the starting/house location as current. The server cannot
start GPS on a suspended/force-quit phone. Fresh location consent/cache policy is
a separate decision; no location permission escalation is implied here.

Logout/account switch must await server cancellation acknowledgement before
claiming the safety session is stopped, then remove the exact local notification
and invalidate owner/generation. If offline or acknowledgement uncertain, show
pending cancellation; do not falsely report safety disabled. Unexpected auth loss
must not transfer ownership or silently cancel a potentially real emergency.
Device shutdown/uninstall cannot communicate cancellation; disclose that before
arming. No architecture can guarantee both offline cancellation and no false SOS
under an unbounded network partition. This is a required product decision.

Worker crash: leases expire and queued jobs replay with stable operation keys;
database transaction boundaries prevent partial mapping/SOS creation. Monitor
oldest due session, outbox backlog and bounded retry failures; expose aggregate
operational metrics. Restrict internal audit records (command/transition/time/
reason/revision); no phone, coordinate, token or message content in application
logs. Define retention/access controls before production rollout.

## Validation boundary and required next steps

Local regression tests prove current source behavior under mocks, not native
execution. Phase 6 tests deliberately preserve the release gate and demonstrate
that a notification does not itself invoke SOS, uses a stable identifier, and
that the current parser does not route safety taps. Existing safety runtime tests
cover foreground T1/T2, no-response, cancellation, persistence and native leases;
repeat tests are structural rather than a rendered double-tap test.

BLOCKED for iOS product enablement pending backend/cancellation/offline policy,
iOS adapter and tap implementation, idempotent recovery and race testing. The
current branch remains safe to review because no preventive iOS mode is enabled.
Required iPhone validation later: alert/sound/Focus/permissions, lock/suspend,
cold/warm tap, timezone/manual clock, offline confirmation/cancel, process death,
force-quit, interrupted arming, account switch, double response and repeat final
cleanup; accessibility on small/large screens with enlarged fonts.

Sources:
- https://docs.expo.dev/versions/v54.0.0/sdk/notifications/
- https://docs.expo.dev/push-notifications/what-you-need-to-know/
- https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app
- https://developer.apple.com/Documentation/usernotifications/
