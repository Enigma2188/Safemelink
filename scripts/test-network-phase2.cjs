const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const models = read('services/NetworkModels.ts');
const service = read('services/NetworkService.ts');
const repository = read('backend/repositories/NetworkRepository.ts');
const screen = read('screens/NetworkScreen.tsx');
const route = read('app/network.tsx');
const layout = read('app/_layout.tsx');
const home = read('app/(tabs)/index.tsx');

for (const category of [
  'SUSPICIOUS_ACTIVITY',
  'DISTURBANCE_OR_DANGER',
  'UNSAFE_AREA',
  'URBAN_HAZARD',
  'OTHER_SAFETY',
]) assert.match(models, new RegExp(category));

assert.match(service, /LocationService\.getCurrentLocation/);
assert.match(service, /NETWORK_FEED_RADIUS_METERS/);
assert.doesNotMatch(service, /watchPosition|setInterval|WhatsApp|whatsapp/);
const publicFeedModel = models.match(/export type NetworkFeedReport = \{[\s\S]*?\n\};/)?.[0] ?? '';
assert.ok(publicFeedModel);
assert.doesNotMatch(publicFeedModel, /latitude|longitude|phone|email/i);
assert.match(repository, /list_nearby_network_reports/);
assert.match(repository, /respond_to_network_report/);
assert.match(repository, /abortSignal/);
assert.doesNotMatch(repository, /console\.(log|info|warn|error)/);
assert.match(screen, /NetworkService\.getMyNetworkOnboardingStatus/);
assert.match(screen, /NetworkService\.loadFeed/);
assert.match(screen, /NetworkService\.createReport/);
assert.match(screen, /NetworkService\.respond/);
assert.match(screen, /La posizione mostrata è sempre approssimativa/);
assert.doesNotMatch(screen, /setInterval|watchPosition|latitude|longitude/);
assert.match(route, /NetworkScreen as default/);
assert.match(layout, /name="network"/);
assert.match(home, /navigateFromDrawer\('\/network'/);

console.log('NETWORK Phase 2 client contract checks passed.');
