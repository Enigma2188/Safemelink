# Phase 8 — GPS data integrity (local candidate, not applied)

## Contract and scope

The incremental migration `20261013120000_sos_live_location_monotonic.sql`
adds `update_my_active_sos_location_result` with the existing five arguments.
It returns `updated`, `stale`, or `inactive`; missing/foreign SOS raises 42501,
invalid input raises 22023 and missing authentication raises 28000.
The original boolean RPC remains available with unchanged argument names/types:
updated/stale => true; inactive/missing/foreign => false. Other errors propagate.
Installed clients therefore do not stop tracking for an ignored stale update.
They still call it `updated` locally and update their publication throttle even
after a server-side stale no-op. No new outcome is wired into the app here.

Only an owned SOS row is locked FOR UPDATE. Status, timestamp comparison and
mutation happen under that same transaction lock. The UPDATE also contains the
strict monotonic predicate. Equal timestamps are no-ops even if coordinates or
accuracy differ. Stale/inactive calls do not change any field or updated_at.
No SOS creation writer, status transition, RLS/table grant, scheduler, transport,
watcher, sampling interval, iOS code, or old migration is changed.

## Clock limits

The current bounds (server transaction now minus 10 minutes / plus 2 minutes)
are preserved for compatibility. Timestamp ordering is not proof of physical
freshness: device clock skew, an owner-supplied false time, and multi-device
clock differences remain possible. An accepted future fix can reject genuine
subsequent fixes as stale until their timestamps catch up (up to the accepted
skew bound, plus existing historical anomalies). No timestamp is silently
clamped or old stored position rewritten by this migration. Existing rows may
contain a timestamp default/backfill rather than a real observation; inspect
those before applying. Long transactions use transaction now, as before.
The later `20260918123000_fix_safety_sos_location_timestamp.sql` removes the
column default and preserves NULL for unknown observations; this candidate
preserves that contract and supports a NULL baseline. Its RPC still has the
same out-of-order overwrite bug. No previous migration is edited.

The fix guarantees nondecreasing stored observation time only for callers of
these RPCs. It does not fence direct table writers, change the legacy SOS writer
or claim that every possible backend path is monotonic.

## Validation remaining — not executed

No local PostgreSQL runtime was available. The local tests are source checks,
an executable contract model, and real client code with controlled backend I/O;
they are not PostgreSQL execution or proof of database lock behaviour.

Before separate authorization to apply on Development: review catalog signatures,
function owners/grants, other location writers and existing timestamp anomalies.
Then validate newer/older/equal/null-baseline timestamps, invalid future (>2m),
accepted bounded future skew, terminal/missing/foreign SOS and legacy booleans.
Use two genuine PostgreSQL connections: older-first/newer-second and the reverse,
with one transaction held open; also concurrent closure/rollback. Confirm the
stored coordinates, accuracy and timestamp are those of the maximum valid
observation time, no cross-account mutation, and stale => true for installed APKs.
Use isolated test fixtures with cleanup, no recipients/delivery or real accounts.
No remote SQL, migration or new runner has been executed by this phase.

## Adaptive tracking proposal — no implementation

Current configuration: 25 m distance filter, 20 s acquisition/request interval,
MOVING minimum publication interval 20 s, STILL 90 s, movement speed threshold
1 m/s, accuracy cutoff 100 m, received detail refresh 15 s. Native scheduling
does not guarantee these cadences in background/locked-device conditions.

Keep a stable watcher. First address clock quality, stale-outcome handling and
accuracy-aware motion hysteresis rather than requesting more samples. Movement
should require meaningful distance relative to fix uncertainty and/or reliable
speed; enter STILL after multiple consistent stationary fixes, not one noisy
sample. Preserve the one-shot initial fix and bounded publication. Offline:
discard superseded fixes rather than replay a growing backlog; never claim a
fresh position when no server acknowledgement exists. Present observation age
separately from refresh time, and describe future/unreliable time explicitly.

Measure quiet/moving/noisy-GPS/background/locked/poor-network cases on both phones
before selecting new thresholds. Theoretical publication ceilings at the current
minima are 180 writes/hour MOVING and 40/hour STILL, not guaranteed actual counts.
Receiver refresh has 240 cycles/hour; the detail currently reads lifecycle + SOS
and may additionally read the authorized emergency profile per cycle. Costs scale
with receivers and active emergencies; polling improvement requires its own phase.
No frequencies, watchers, precision or permissions are changed here.
