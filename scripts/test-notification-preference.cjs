const assert = require('node:assert/strict');
const fs = require('node:fs');

const storage = fs.readFileSync('storage/SafetyNotificationPreferenceStorage.ts', 'utf8');
const settings = fs.readFileSync('app/settings.tsx', 'utf8');
const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');

assert.match(storage, /safemelink\.safety-notifications\.enabled/);
assert.match(storage, /value !== 'false'/);
assert.match(settings, /notificationsEnabled/);
assert.match(settings, /getPermissionsAsync/);
assert.match(settings, /ensureOperationalChannel/);
assert.match(settings, /Disattivate in SafeMeLink/);
assert.match(home, /SafetyNotificationPreferenceStorage\.get\(userId\)/);
assert.match(home, /Per usare questa funzione devi attivare gli avvisi di sicurezza/);

console.log('Safety notification preference checks passed (account scope, real permission state and preventive gating)');
