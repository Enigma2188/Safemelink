const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const check = (name, callback) => {
  callback();
  process.stdout.write(`PASS ${name}\n`);
};

const radarService = read('services/RadarService.ts');
const radarPresenceMigration = read(
  'supabase/migrations/20260722130000_radar_presence.sql',
);
const radarMigration = read(
  'supabase/migrations/20260722140000_radar_preferences_and_nickname.sql',
);
const emergencyService = read('services/EmergencyProfileService.ts');
const emergencyMigration = read(
  'supabase/migrations/20260723120000_emergency_profile.sql',
);
const pushFunction = read('supabase/functions/send-sos-push/index.ts');
const pushRecipients = read('supabase/functions/_shared/pushRecipients.ts');
const receivedSOSMigration = read(
  'supabase/migrations/20260722120000_received_sos_details.sql',
);
const lifecycleMigration = read(
  'supabase/migrations/20260724120000_sos_lifecycle_hardening.sql',
);
const accountStorage = read('storage/AccountScopedStorage.ts');
const homeScreen = read('app/(tabs)/index.tsx');
const contactsScreen = read('screens/TrustedContactsScreen.tsx');

check('Radar client uses 1 km and 25 results', () => {
  assert.match(radarService, /RADAR_SEARCH_RADIUS_METERS = 1_000/);
  assert.match(radarService, /RADAR_RESULT_LIMIT = 25/);
});

check('Radar reciprocity is enforced for caller and candidates', () => {
  assert.match(
    radarMigration,
    /preferences\.radar_enabled = true[\s\S]*preferences\.visible_to_nearby = true/,
  );
  assert.match(
    radarMigration,
    /candidate_preferences\.radar_enabled = true[\s\S]*candidate_preferences\.visible_to_nearby = true/,
  );
  assert.match(radarMigration, /candidate\.user_id <> current_user_id/);
});

check('Radar technical limits and expiry are bounded', () => {
  assert.match(radarMigration, /search_radius_meters > 5000/);
  assert.match(radarMigration, /result_limit > 50/);
  assert.match(radarPresenceMigration, /interval '5 minutes'/);
});

check('Emergency blood group uses letter O, never number zero', () => {
  assert.match(emergencyService, /'O\+', 'O-'/);
  assert.match(emergencyMigration, /'O\+', 'O-'/);
  assert.doesNotMatch(emergencyService, /'0\+'|'0-'/);
  assert.doesNotMatch(emergencyMigration, /'0\+'|'0-'/);
});

check('Emergency data requires active SOS, trusted access, and consent', () => {
  assert.match(emergencyMigration, /status in \('open', 'accepted'\)/);
  assert.match(emergencyMigration, /trusted_contact\.linked_profile_id = auth\.uid\(\)/);
  assert.match(
    emergencyMigration,
    /share_medical_data_during_sos = true[\s\S]*share_ice_contact_during_sos = true/,
  );
});

check('Push function authenticates JWT and binds SOS to its owner', () => {
  assert.match(pushFunction, /adminClient\.auth\.getUser\(accessToken\)/);
  assert.match(pushFunction, /\.eq\('user_id', user\.id\)/);
  assert.match(pushFunction, /\.eq\('status', 'open'\)/);
});

check('Push recipients are trusted, unique, active, and exclude sender', () => {
  assert.match(pushRecipients, /\.from\('trusted_contacts'\)/);
  assert.match(pushRecipients, /\.eq\('user_id', senderUserId\)/);
  assert.match(pushRecipients, /id !== senderUserId/);
  assert.match(pushRecipients, /new Set/);
  assert.match(pushRecipients, /\.eq\('active', true\)/);
});

check('Notification data contains no sender UUID or coordinates', () => {
  const dataBlock = pushFunction.match(
    /channelId: SOS_CHANNEL_ID,\s*data:\s*\{([\s\S]*?)\r?\n\s*\},\r?\n\s*\}\)\);/,
  )?.[1];
  assert.ok(dataBlock, 'Notification data block not found.');
  assert.match(dataBlock, /type: 'sos_alert'/);
  assert.match(dataBlock, /sosId: sos\.id/);
  assert.doesNotMatch(dataBlock, /senderUserId|latitude|longitude|mapsUrl/);
});

check('Received SOS RPC requires authentication and a trusted link', () => {
  assert.match(receivedSOSMigration, /auth\.uid\(\) is not null/);
  assert.match(receivedSOSMigration, /tc\.linked_profile_id = auth\.uid\(\)/);
});

check('AsyncStorage keys are scoped by account UUID', () => {
  assert.match(accountStorage, /STORAGE_PREFIX\}:\$\{userId\}:\$\{namespace\}/);
  assert.match(accountStorage, /LEGACY_OWNER_KEY/);
  assert.match(accountStorage, /blocked:different-owner/);
  assert.match(accountStorage, /migrationQueue/);
});

check('Legacy migration is marked and cannot be claimed by a second account', () => {
  assert.match(accountStorage, /existingMarker\[1\] !== null/);
  assert.match(accountStorage, /legacyOwnerId !== userId/);
  assert.match(accountStorage, /AsyncStorage\.setItem\(markerKey, 'migrated'\)/);
  assert.match(accountStorage, /AsyncStorage\.setItem\(LEGACY_OWNER_KEY, userId\)/);
});

check('Sensitive React state resets when the active account changes', () => {
  assert.match(homeScreen, /resetSensitiveState\(\);[\s\S]*\}, \[resetSensitiveState, userId\]\)/);
  assert.match(contactsScreen, /setContacts\(\[\]\);[\s\S]*\}, \[userId\]\)/);
  assert.match(homeScreen, /activeUserIdRef\.current !== loadUserId/);
  assert.match(contactsScreen, /activeUserIdRef\.current !== loadUserId/);
});

check('SOS lifecycle RPCs are authenticated and locked against races', () => {
  for (const functionName of ['accept_sos', 'close_my_sos', 'cancel_my_sos']) {
    const functionStart = lifecycleMigration.indexOf(
      `create or replace function public.${functionName}`,
    );
    assert.notEqual(functionStart, -1, `${functionName} missing`);
    const functionEnd = lifecycleMigration.indexOf('$$;', functionStart);
    const functionBody = lifecycleMigration.slice(functionStart, functionEnd);
    assert.match(functionBody, /security definer/);
    assert.match(functionBody, /set search_path = public, pg_temp/);
    assert.match(functionBody, /auth\.uid\(\)/);
    assert.match(functionBody, /for update/);
  }
});

check('SOS transition rules allow only active-to-terminal or open-to-accepted', () => {
  assert.match(lifecycleMigration, /target_sos\.status <> 'open'/);
  assert.match(lifecycleMigration, /target_sos\.status not in \('open', 'accepted'\)/);
  assert.match(lifecycleMigration, /Invalid SOS transition to accepted/);
  assert.match(lifecycleMigration, /Invalid SOS transition to closed/);
  assert.match(lifecycleMigration, /Invalid SOS transition to cancelled/);
  assert.match(lifecycleMigration, /drop policy if exists "sos_update_own"/);
});

check('Lifecycle RPC grants are restricted to authenticated users', () => {
  for (const functionName of [
    'get_sos_status',
    'accept_sos',
    'close_my_sos',
    'cancel_my_sos',
  ]) {
    assert.match(
      lifecycleMigration,
      new RegExp(`revoke all on function public\\.${functionName}\\(uuid\\) from public`),
    );
    assert.match(
      lifecycleMigration,
      new RegExp(`grant execute on function public\\.${functionName}\\(uuid\\) to authenticated`),
    );
  }
});

check('Closed or cancelled SOS expose neither coordinates nor medical data', () => {
  assert.match(lifecycleMigration, /target\.status in \('open', 'accepted'\)/);
  assert.match(emergencyMigration, /emergency_sos\.status in \('open', 'accepted'\)/);
  assert.match(homeScreen, /location: null/);
  assert.match(homeScreen, /message: null/);
});

process.stdout.write('All static audit checks passed.\n');
