/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const core = read('.github/workflows/android-core-test-apk.yml');
const network = read('.github/workflows/android-test-apk.yml');
assert.match(core, /^on:\s*\r?\n  workflow_dispatch:\s*$/m);
assert.doesNotMatch(core, /^  (push|pull_request|schedule):/m);
assert.match(core, /EXPO_PUBLIC_NETWORK_V2_ENABLED: "false"/);
assert.doesNotMatch(core, /inputs\.|network_v2:|SAFEMELINK_ANDROID_MAPS_API_KEY/);
assert.match(core, /ref: \$\{\{ github\.sha \}\}/);
assert.match(core, /if \[ "\$checked_out_sha" != "\$DISPATCH_SHA" \]; then/);
assert.match(core, /Verify Development URL and client API key \(fail closed\)/);
assert.match(core, /node scripts\/verify-android-test-candidate\.cjs/);
assert.match(core, /node scripts\/validate-generated-android\.cjs/);
assert.match(core, /safemelink-core-test\.apk/);
for (const script of ['test-voice-activation-owner.cjs', 'test-voice-service-loss.cjs', 'test-contacts-cache-races.cjs', 'test-presence-lifecycle-races.cjs', 'test-sos-sms-confirmation.cjs']) {
  assert.ok(core.includes('node scripts/' + script), 'Core CI must run recovered regressions: ' + script);
}

assert.match(core, /gradlew :app:createBundleReleaseJsAndAssets :app:assembleRelease/);
assert.match(network, /network_v2:[\s\S]*?default: false/);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'.github/workflows/android-test-apk.yml'))).digest('hex'), 'b1836878deec3f21e745baf85b4561879ce64d44d0fef1c285cba63644c00b53');
assert.equal(JSON.parse(read('package.json')).dependencies['expo-crypto'], '~15.0.8');
assert.equal(JSON.parse(read('app.json')).expo.android.package, 'com.tiziano.safemelink');
assert.match(read('scripts/validate-generated-android.cjs'), /signingConfigs\\\.debug/);
const home = read('app/(tabs)/index.tsx').replace(/\r\n/g,'\n');
assert.equal(crypto.createHash('sha256').update(home).digest('hex'), '01e90efc44e8cc453ca3610ee9bdc06578c15650496a1f199b76996c9ca3ec97', 'Review and update the core Home fingerprint only with an authorized change');
assert.match(home, /Possibili SMS duplicati/);
assert.match(read('services/SOSAutomaticSmsService.ts'), /MAX_AUTOMATIC_SMS_RECIPIENTS = 3/);
assert.doesNotMatch(read('services/SOSAlertService.ts'), /whatsapp:\/\/|wa\.me\//i);
assert.match(read('services/SOSService.ts'), /!requiresSmsFallbackConfirmation\(automaticSmsResult\)/);
console.log('PASS core workflow is manual, immutable-source, NETWORK OFF, no Maps requirement; NETWORK workflow/crypto preserved; reviewed Home fingerprint, max three SMS, no WhatsApp transport');
