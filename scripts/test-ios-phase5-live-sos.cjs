const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const service = read('services/SOSLiveLocationService.ts');
const task = read('services/SOSLiveLocationBackgroundTask.ts');
const app = JSON.parse(read('app.json')).expo;
const network = read('services/SOSNetworkPresenceService.ts');
const layout = read('app/_layout.tsx');

const locationPlugin = app.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location',
);
assert.ok(locationPlugin, 'expo-location plugin must be configured');
assert.equal(locationPlugin[1].isIosBackgroundLocationEnabled, true);
assert.equal(typeof app.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription, 'string');
assert.equal(typeof app.ios.infoPlist.NSLocationAlwaysUsageDescription, 'string');

assert.match(task, /TaskManager\.defineTask/);
assert.match(layout, /SOSLiveLocationBackgroundTask/);
assert.equal((task.match(/TaskManager\.defineTask/g) ?? []).length, 1);
assert.match(service, /requestBackgroundPermissionsAsync/);
assert.match(service, /backgroundPermission\.canAskAgain/);
assert.match(service, /Platform\.OS === 'ios'/);
assert.match(service, /showsBackgroundLocationIndicator: true/);
assert.match(service, /foregroundService:/);
assert.match(service, /Location\.watchPositionAsync/);
assert.match(service, /Location\.stopLocationUpdatesAsync\(SOS_LIVE_LOCATION_TASK\)/);
assert.doesNotMatch(service, /setInterval\(/);
assert.doesNotMatch(service, /silent push|keepalive/i);

// The general SOS network must remain foreground-only on iOS.
assert.match(network, /if \(Platform\.OS !== 'android'\)/);
assert.match(network, /return \{ foregroundGranted: true, backgroundGranted: false \}/);
assert.doesNotMatch(network, /Platform\.OS === 'ios'[\s\S]{0,240}requestBackgroundPermissionsAsync/);

// Background tracking is an SOS-only capability; no app-wide task is started here.
assert.match(service, /const startTracking = async/);
assert.match(service, /SOSLiveLocationStorage\.save/);
assert.match(service, /SOSLiveLocationStorage\.clear/);

console.log('iOS Phase 5 live SOS checks: PASS');
