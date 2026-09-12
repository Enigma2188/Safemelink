const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const layout = read('app/_layout.tsx');
const onboarding = read('app/onboarding.tsx');
const guide = read('app/how-safemelink-works.tsx');
const storage = read('storage/OnboardingStorage.ts');
const home = read('app/(tabs)/index.tsx');
const networkModels = read('services/NetworkModels.ts');
const networkScreen = read('screens/NetworkScreen.tsx');

assert.match(storage, /safemelink_onboarding_version/);
assert.match(storage, /CURRENT_ONBOARDING_VERSION/);
assert.match(layout, /!isComplete/);
assert.match(layout, /Redirect href=\{'\/onboarding' as Href\}/);
assert.match(onboarding, /SALTA/);
assert.match(onboarding, /INDIETRO/);
assert.match(onboarding, /ENTRA IN SAFEMELINK/);
assert.match(onboarding, /completeOnboarding/);
assert.match(onboarding, /BackHandler\.addEventListener\('hardwareBackPress'/);
assert.match(onboarding, /subscription\.remove\(\)/);
assert.doesNotMatch(onboarding, /requestPermissions|getPermissions|expo-notifications|expo-location/);
assert.match(home, /Come funziona SafeMeLink/);
assert.match(home, /\/how-safemelink-works/);
assert.match(guide, /SOS/);
assert.match(guide, /Rete SafeMeLink/);
assert.match(guide, /NETWORK/);
assert.match(guide, /Rete di quartiere/);
assert.match(guide, /Checkpoint/);
assert.match(guide, /Torno a casa/);
assert.match(guide, /Protezione vocale/);
assert.match(guide, /Notifiche/);
assert.match(guide, /Privacy e posizione/);
assert.doesNotMatch(`${onboarding}\n${guide}`, /setInterval|watchPosition|latitude|longitude|ExponentPushToken|ExpoPushToken/);
assert.match(networkModels, /NETWORK_FEED_RADIUS_METERS = 5_000/);
assert.match(networkScreen, /entro 5 km/);
assert.doesNotMatch(networkScreen, /entro 1 km/);

console.log('Onboarding and SafeMeLink guide checks passed.');
