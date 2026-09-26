const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
const layout = fs.readFileSync('app/_layout.tsx', 'utf8');
const settings = fs.readFileSync('app/settings.tsx', 'utf8');
const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const email = fs.readFileSync('app/email-confirmed.tsx', 'utf8');
const guide = fs.readFileSync('app/how-safemelink-works.tsx', 'utf8');
const keyboard = fs.readFileSync('components/KeyboardSafeForm.tsx', 'utf8');
const network = fs.readFileSync('screens/NetworkScreen.tsx', 'utf8');
const neighborhood = fs.readFileSync('screens/NeighborhoodNetworkScreen.tsx', 'utf8');

assert.equal(config.scheme, 'safemelink');
assert.equal(config.ios.bundleIdentifier, 'com.tiziano.safemelink');
const splash = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
assert.ok(splash);
assert.equal(splash[1].backgroundColor, '#050816');
assert.match(splash[1].image, /safemelink-eye-earth\.png$/);
assert.match(layout, /email-confirmed/);
assert.match(layout, /safemelink-eye-earth\.png/);
assert.match(settings, /Platform\.OS === 'android'/);
assert.match(settings, /InterfaceModeStorage/);
assert.match(email, /useURL/);
assert.match(email, /SafeAreaView/);
assert.match(guide, /Per usare la rete devi attivarla/);
for (const screen of [network, neighborhood]) {
  assert.match(screen, /SafeAreaView/);
  assert.match(screen, /KeyboardAvoidingView/);
  assert.match(screen, /KeyboardSafeScrollView/);
}
assert.match(keyboard, /Platform\.OS !== 'android'/);
assert.match(home, /Platform\.OS === 'ios'/);
assert.match(home, /disponibile su iPhone in una fase successiva/);

console.log('iOS Phase 1 shell checks passed (config, deep link, safe area, keyboard and platform gating)');
