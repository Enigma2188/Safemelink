const fs = require('node:fs');
const assert = require('node:assert/strict');

const migration = fs.readFileSync('supabase/migrations/20260923120000_protection_signals.sql', 'utf8');
const screen = fs.readFileSync('app/protection-signal.tsx', 'utf8');
const service = fs.readFileSync('services/ProtectionSignalService.ts', 'utf8');
const contactService = fs.readFileSync('services/ProtectionSignalTrustedContactService.ts', 'utf8');

assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.protection_signals/);
assert.match(migration, /count\(distinct ps\.user_id\) >= 3/);
assert.match(migration, /list_protection_area_alerts/);
assert.match(migration, /group by 1, 2/);
assert.match(migration, /and ps\.place_type <> 'ONLINE'/);
assert.match(migration, /created_at >= now\(\) - interval '14 days'/);
assert.match(migration, /target_place_type = 'ONLINE'/);
assert.match(migration, /Too many protection signals/);
assert.match(screen, /Segnale Tutela/);
assert.match(screen, /DANGER_NOW/);
assert.match(screen, /normale SOS SafeMeLink/);
assert.doesNotMatch(screen, /TextInput|FormData|latitude|longitude/);
assert.match(screen, /Tutela nella tua zona/);
assert.match(screen, /più segnali indipendenti/);
assert.match(service, /target_area_bucket/);
assert.match(service, /LocationService\.getCurrentLocation/);
assert.match(contactService, /Segnale Tutela/);
assert.match(contactService, /sendSms/);
assert.match(contactService, /Linking\.openURL/);
assert.match(contactService, /deliveryInFlight/);
assert.doesNotMatch(contactService, /bullismo|cyberbullismo|latitude|longitude|SOSService/);

console.log('Protection signal checks passed (structured input, online privacy, approximate area, threshold and SOS handoff).');
