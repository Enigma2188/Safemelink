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
const runtimeMigration = read('supabase/migrations/20260912120000_network_runtime_radius_5km.sql');
const radiusMigration = read('supabase/migrations/20260914120000_network_feed_radius_and_resolution.sql');
const eligibilityMigration = read('supabase/migrations/20260914122000_network_launch_eligibility.sql');

for (const category of [
  'SUSPICIOUS_ACTIVITY',
  'DISTURBANCE_OR_DANGER',
  'UNSAFE_AREA',
  'URBAN_HAZARD',
  'OTHER_SAFETY',
]) assert.match(models, new RegExp(category));

assert.match(service, /LocationService\.getCurrentLocation/);
assert.match(service, /NETWORK_FEED_RADIUS_METERS/);
assert.match(models, /NETWORK_FEED_RADIUS_METERS = 5_000/);
assert.match(models, /\[1_000, 2_500, 5_000, 10_000\]/);
assert.doesNotMatch(service, /watchPosition|setInterval|WhatsApp|whatsapp/);
const publicFeedModel = models.match(/export type NetworkFeedReport = \{[\s\S]*?\n\};/)?.[0] ?? '';
assert.ok(publicFeedModel);
assert.doesNotMatch(publicFeedModel, /latitude|longitude|phone|email/i);
assert.match(repository, /list_nearby_network_reports/);
assert.match(repository, /respond_to_network_report/);
assert.match(repository, /abortSignal/);
assert.doesNotMatch(repository, /console\.(log|info|warn|error)/);
assert.match(screen, /NetworkService\.getMyNetworkOnboardingStatus/);
assert.match(screen, /NetworkService\.updateIdentity/);
assert.match(screen, /NetworkService\.loadFeed/);
assert.match(screen, /NetworkService\.createReport/);
assert.match(screen, /NetworkService\.respond/);
assert.match(screen, /NetworkService\.resolve/);
assert.match(screen, /NetworkService\.setFeedRadius/);
assert.match(screen, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
assert.match(screen, /keyboardDismissMode="on-drag"/);
assert.match(screen, /keyboardShouldPersistTaps="handled"/);
assert.match(screen, /Keyboard\.dismiss\(\)/);
assert.match(screen, /label=\{busy \? 'PUBBLICAZIONE…' : 'PUBBLICA'\}/);
assert.match(screen, /'Segnalazione pubblicata\.'[\s\S]*setPublishMessage/);
assert.match(screen, /setDescription\(''\)/);
assert.match(screen, /await load\(false\)/);
assert.match(screen, /if \(actionRef\.current \|\| !userId\) return/);
assert.match(screen, /La posizione mostrata è sempre approssimativa/);
assert.match(screen, /Zona approssimativa/);
assert.doesNotMatch(screen, /formatDistance|distanceBucketMeters/);
assert.match(screen, /error instanceof BackendError/);
assert.match(screen, /error instanceof RemoteRequestTimeoutError/);
assert.doesNotMatch(screen, /\/network\|fetch/);
assert.doesNotMatch(screen, /setInterval|watchPosition|latitude|longitude/);
assert.match(route, /NetworkScreen as default/);
assert.match(layout, /name="network"/);
assert.match(home, /navigateFromDrawer\('\/network'/);
assert.match(runtimeMigration, /create or replace function public\.get_my_network_onboarding_status\(\)/);
assert.match(runtimeMigration, /default_feed_radius_meters = 5000/);
assert.match(runtimeMigration, /max_feed_radius_meters = 5000/);
assert.match(runtimeMigration, /where feed_radius_meters = 1000/);
assert.match(runtimeMigration, /grant execute on function public\.get_my_network_onboarding_status\(\) to authenticated/);
assert.match(radiusMigration, /max_feed_radius_meters = 10000/);
assert.match(radiusMigration, /resolved_visibility = interval '24 hours'/);
assert.match(radiusMigration, /is_mine boolean/);
assert.match(eligibilityMigration, /phone_present boolean/);
assert.match(eligibilityMigration, /La verifica SMS del telefono è facoltativa|phone_verified_at/);
assert.match(screen, /La verifica SMS del telefono è facoltativa/);

console.log('NETWORK Phase 2 client contract checks passed.');
