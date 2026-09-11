const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const app = JSON.parse(read('app.json')).expo;
const voiceService = read('services/VoiceProtectionService.ts');
const voiceLifecycle = read('components/VoiceProtectionLifecycle.tsx');
const voiceScreen = read('app/voice-protection.tsx');
const safetyNotifications = read('services/SafetyNotifications.ts');
const smsConfig = JSON.parse(read('modules/safemelink-sms/expo-module.config.json'));

assert.equal(app.ios.bundleIdentifier, 'com.tiziano.safemelink');
assert.equal(app.scheme, 'safemelink');
assert.match(app.ios.infoPlist.NSLocationAlwaysUsageDescription, /rete SOS/i);
assert.equal(app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location')[1].isIosBackgroundLocationEnabled, true);
assert.deepEqual(smsConfig.platforms, ['android'], 'native automatic SMS must remain Android-only');
assert.match(voiceService, /isRunning\(\) \{\s*return Platform\.OS === 'android'/);
assert.match(voiceService, /if \(Platform\.OS !== 'android'\) return;/);
assert.match(voiceLifecycle, /if \(Platform\.OS !== 'android'\) return;/);
assert.match(voiceScreen, /iOS non consente/);
assert.match(safetyNotifications, /SchedulableTriggerInputTypes\.DATE/);
assert.match(safetyNotifications, /Platform\.OS === 'android' \? \{ channelId: CHANNEL_ID \} : \{\}/);

console.log('PASS iOS bundle, location, local deadlines, Android-only SMS and voice capability guards');
