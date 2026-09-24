const fs = require('node:fs');
const assert = require('node:assert/strict');

const service = fs.readFileSync('services/SOSLiveLocationService.ts', 'utf8');
const background = fs.readFileSync('services/SOSLiveLocationBackgroundTask.ts', 'utf8');
const auth = fs.readFileSync('backend/auth/AuthProvider.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260902120000_sos_delivery_all_nearby_and_live_location.sql',
  'utf8',
);

assert.match(service, /getCurrentPositionAsync\(\{ accuracy: Location\.Accuracy\.High \}\)/);
assert.match(service, /SOS_LIVE_INITIAL_FIX_TIMEOUT_MS/);
assert.match(service, /SOS_LIVE_MOVING_INTERVAL_MS/);
assert.match(service, /SOS_LIVE_STILL_INTERVAL_MS/);
assert.match(service, /SOS_LIVE_MOVING_SPEED_MPS/);
assert.match(service, /movementState/);
assert.match(service, /Location\.startLocationUpdatesAsync\(SOS_LIVE_LOCATION_TASK/);
assert.match(service, /Location\.watchPositionAsync/);
assert.match(service, /Location\.stopLocationUpdatesAsync\(SOS_LIVE_LOCATION_TASK/);
assert.match(service, /accuracy,\n\s+observedAt: new Date\(location\.timestamp\)/);
assert.match(background, /SOSLiveLocationStorage\.get\(session\.user\.id\)/);
assert.match(auth, /SOSLiveLocationService\.restore\(userId, stored\.sosId\)/);
assert.match(auth, /SOSLifecycleRepository\.getStatus\(stored\.sosId\)/);
assert.match(migration, /target\.user_id = current_user_id/);
assert.match(migration, /target\.status in \('open', 'accepted'\)/);
assert.doesNotMatch(service, /setInterval/);

console.log('SOS live location checks passed (initial fix, bounded background updates, auth scope, cleanup, recovery).');
