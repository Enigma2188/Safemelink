const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readSourceTree = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      return readSourceTree(childPath);
    }
    return /\.(?:ts|tsx|cjs)$/.test(entry.name) ? [read(childPath)] : [];
  });
};
const check = (name, callback) => {
  callback();
  process.stdout.write(`PASS ${name}\n`);
};

const radarService = read('services/RadarService.ts');
const radarRepository = read('backend/repositories/RadarRepository.ts');
const radarProvider = read('components/RadarProvider.tsx');
const radarPresenceMigration = read(
  'supabase/migrations/20260722130000_radar_presence.sql',
);
const radarMigration = read(
  'supabase/migrations/20260722140000_radar_preferences_and_nickname.sql',
);
const initialSchemaMigration = read('supabase/migrations/20260714120000_initial_schema.sql');
const pushSchemaMigration = read('supabase/migrations/20260715120000_minimal_push_test.sql');
const emergencyService = read('services/EmergencyProfileService.ts');
const emergencyRepository = read(
  'backend/repositories/EmergencyProfileRepository.ts',
);
const emergencyHook = read('hooks/useEmergencyProfile.ts');
const emergencyScreen = read('screens/EmergencyProfileScreen.tsx');
const radarScreen = read('screens/RadarScreen.tsx');
const emergencyMigration = read(
  'supabase/migrations/20260723120000_emergency_profile.sql',
);
const backendErrors = read('backend/errors/BackendError.ts');
const databaseTypes = read('backend/database.types.ts');
const pushFunction = read('supabase/functions/send-sos-push/index.ts');
const pushRecipients = read('supabase/functions/send-sos-push/pushRecipients.ts');
const sosPushService = read('backend/functions/SOSPushService.ts');
const receivedSOSMigration = read(
  'supabase/migrations/20260722120000_received_sos_details.sql',
);
const lifecycleMigration = read(
  'supabase/migrations/20260724120000_sos_lifecycle_hardening.sql',
);
const accountStorage = read('storage/AccountScopedStorage.ts');
const homeScreen = read('app/(tabs)/index.tsx');
const contactsScreen = read('screens/TrustedContactsScreen.tsx');
const voiceProtectionScreen = read('app/voice-protection.tsx');
const voiceProtectionService = read('services/VoiceProtectionService.ts');
const voiceProtectionLifecycle = read('components/VoiceProtectionLifecycle.tsx');
const voiceProtectionRuntime = read('services/VoiceProtectionRuntime.ts');
const voiceProtectionPlugin = read(
  'plugins/withVoiceProtectionForegroundService.cjs',
);
const pushTokenRegistrar = read('components/PushTokenRegistrar.tsx');
const sosNotificationCenter = read('components/SOSNotificationCenter.tsx');
const sosNotificationPayload = read('services/SOSNotificationPayload.ts');
const pushNotificationService = read('services/PushNotificationService.ts');
const rootLayout = read('app/_layout.tsx');
const pushTokenRepository = read('backend/repositories/PushTokenRepository.ts');
const pushTokenOwnershipMigration = read(
  'supabase/migrations/20260815120000_push_token_ownership.sql',
);
const trustedLinksHardeningMigration = read(
  'supabase/migrations/20260815121000_trusted_links_hardening.sql',
);
const trustedPhoneIdentityMigration = read(
  'supabase/migrations/20260820120000_trusted_contact_phone_identity.sql',
);
const contactsService = read('services/ContactsService.ts');
const contactsStorage = read('storage/ContactsStorage.ts');
const goHomeStorage = read('storage/GoHomeStorage.ts');
const phoneIdentity = read('services/PhoneIdentity.ts');
const sosProximityNetworkMigration = read(
  'supabase/migrations/20260817120000_sos_proximity_network.sql',
);
const accountBootstrapMigration = read(
  'supabase/migrations/20260817121000_account_bootstrap_and_sos_dispatch_guard.sql',
);
const authService = read('backend/auth/AuthService.ts');
const authProvider = read('backend/auth/AuthProvider.tsx');
const accountAccessPanel = read('components/AccountAccessPanel.tsx');
const offlineStatusBanner = read('components/OfflineStatusBanner.tsx');
const locationService = read('services/LocationService.ts');
const sosService = read('services/SOSService.ts');
const sosAlertService = read('services/SOSAlertService.ts');
const trustedLinksService = read('services/TrustedLinksService.ts');
const sosChannelQueriesPlugin = read('plugins/withSOSChannelQueries.cjs');
const receivedSOSRepository = read('backend/repositories/ReceivedSOSRepository.ts');
const receivedSOSScreen = read('app/sos/[id].tsx');

check('Radar client uses 1 km and 25 results', () => {
  assert.match(radarService, /RADAR_SEARCH_RADIUS_METERS = 1_000/);
  assert.match(radarService, /RADAR_RESULT_LIMIT = 25/);
});

check('Radar missing preferences are initialized with safe OFF defaults', () => {
  assert.match(radarRepository, /\.rpc\('get_my_radar_preferences'\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(radarService, /DEFAULT_RADAR_PREFERENCES = \{[\s\S]*radarEnabled: false/);
  assert.match(radarService, /visibleToNearby: false/);
  assert.match(radarService, /showNickname: false/);
  assert.match(
    accountBootstrapMigration,
    /alter column visible_to_nearby set default false/,
  );
  assert.match(
    radarService,
    /if \(storedPreferences\)[\s\S]*RadarRepository\.updatePreferences\(DEFAULT_RADAR_PREFERENCES\)/,
  );
  assert.match(
    radarMigration,
    /insert into public\.radar_preferences \(user_id\)[\s\S]*on conflict \(user_id\) do nothing/,
  );
});

check('Fresh users can sign up and receive an idempotent account bootstrap', () => {
  assert.match(authService, /client\.auth\.signUp\(\{ email, password \}\)/);
  assert.match(authProvider, /AuthService\.initializeAccount\(nextSession\.user\.id\)/);
  assert.match(accountAccessPanel, /Crea account/);
  assert.match(accountAccessPanel, /requiresEmailConfirmation/);
  assert.match(accountBootstrapMigration, /create or replace function public\.handle_new_auth_user/);
  assert.match(accountBootstrapMigration, /insert into public\.profiles \(id, phone\)/);
  assert.match(accountBootstrapMigration, /insert into public\.radar_preferences/);
  assert.match(accountBootstrapMigration, /create or replace function public\.initialize_my_account/);
  assert.match(accountBootstrapMigration, /current_user_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(accountBootstrapMigration, /initialize_my_account\([^)]*uuid/);
});

check('Persisted authentication degrades safely while offline and recovers', () => {
  assert.match(authProvider, /setSession\(nextSession\);[\s\S]*await bootstrapSession/);
  assert.match(authProvider, /classifyAuthFailure\(initializationError\)/);
  assert.match(authProvider, /setIsOffline\(true\);[\s\S]*scheduleRecovery/);
  assert.match(authProvider, /AppState\.addEventListener\('change'/);
  assert.match(authProvider, /invalidateSession\(generation\)/);
  assert.match(authProvider, /Riconnettiti prima di cambiare o disconnettere l.account/);
  assert.match(authService, /AuthFailureCategory = 'network' \| 'invalid_session' \| 'other'/);
  assert.match(authService, /AuthNetworkUnavailableError/);
  assert.match(rootLayout, /<OfflineStatusBanner \/>/);
  assert.match(
    offlineStatusBanner,
    /Sei offline\. Alcune funzioni SafeMeLink non sono disponibili\./,
  );
  assert.match(pushTokenRegistrar, /if \(!userId \|\| isOffline\)/);
  assert.match(sosService, /allowRemoteDelivery/);
  assert.match(sosService, /ContactsService\.listCached\(expectedUserId\)/);
  assert.match(homeScreen, /isOffline \? ContactsService\.listCached\(loadUserId\)/);
});

check('Fresh-user network defaults require explicit privacy opt-in', () => {
  assert.match(
    accountBootstrapMigration,
    /new\.id,[\s\S]*false,[\s\S]*false,[\s\S]*false,[\s\S]*null/,
  );
  assert.match(accountAccessPanel, /dati locali restano separati per ogni utente/);
  assert.match(radarScreen, /Entra o esci dalla rete SafeMeLink/);
  assert.match(radarScreen, /Mostrami agli utenti vicini/);
  assert.match(radarScreen, /value=\{preferences\?\.visibleToNearby \?\? false\}/);
});

check('Database types cover server-side SOS delivery RPCs', () => {
  assert.match(databaseTypes, /claim_sos_push_dispatch:[\s\S]*target_sos_id: string/);
  assert.match(databaseTypes, /prepare_sos_delivery:[\s\S]*recipient_user_id: string/);
  assert.match(databaseTypes, /is_trusted: boolean/);
  assert.match(databaseTypes, /is_nearby: boolean/);
  assert.match(databaseTypes, /distance_meters: number \| null/);
});

check('Radar OFF performs no location publication or nearby search', () => {
  assert.match(radarService, /preferences\?\.radarEnabled && preferences\.visibleToNearby/);
  assert.match(
    radarProvider,
    /const canPublishPresence = Boolean\([\s\S]*participationEnabled/,
  );
  assert.match(
    radarProvider,
    /!canPublishPresence[\s\S]*activeUserIdRef\.current !== userId/,
  );
  assert.match(
    radarProvider,
    /!participationEnabled[\s\S]*preferencesUserId === userId[\s\S]*deactivate\(userId\)/,
  );
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

check('Radar has no invisible mode and nickname remains optional', () => {
  assert.match(radarService, /radarEnabled && preferences\.visibleToNearby/);
  assert.match(radarService, /if \(!normalized\)[\s\S]*normalized: null/);
  assert.match(
    radarMigration,
    /public_nickname is null[\s\S]*public_nickname ~ '\^\[A-Za-z0-9_-\]\{3,20\}\$'/,
  );
});

check('Radar RPC exposes rounded distance but no precise coordinates', () => {
  const returnSignature = radarMigration.match(
    /create function public\.find_nearby_users\([\s\S]*?returns table \(([\s\S]*?)\)\r?\nlanguage plpgsql/,
  )?.[1];
  assert.ok(returnSignature, 'Radar return signature not found.');
  assert.match(returnSignature, /distance_meters integer/);
  assert.doesNotMatch(returnSignature, /latitude|longitude/);
  assert.match(radarMigration, /greatest\(50, round\(candidate\.exact_distance_meters \/ 50\) \* 50\)/);
});

check('Radar technical limits and expiry are bounded', () => {
  assert.match(radarMigration, /search_radius_meters > 5000/);
  assert.match(radarMigration, /result_limit > 50/);
  assert.match(radarPresenceMigration, /interval '5 minutes'/);
});

check('Emergency missing record is treated as an empty editable profile', () => {
  assert.match(emergencyRepository, /\.rpc\('get_my_emergency_profile'\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(
    emergencyService,
    /row[\s\S]*\? \{[\s\S]*: \{[\s\S]*\.\.\.EMPTY_EMERGENCY_PROFILE,[\s\S]*updatedAt: null/,
  );
  assert.match(
    emergencyMigration,
    /insert into public\.emergency_profiles \(user_id\)[\s\S]*on conflict \(user_id\) do nothing/,
  );
});

check('Emergency load state gates editing and saving', () => {
  assert.match(emergencyHook, /setHasLoadedProfile\(false\);[\s\S]*setStatus\('loading'\)/);
  assert.match(
    emergencyHook,
    /setDraft\(profile\);[\s\S]*setHasLoadedProfile\(true\);[\s\S]*setStatus\('ready'\)/,
  );
  assert.match(
    emergencyHook,
    /\.catch\([\s\S]*setStatus\('error'\)[\s\S]*setError\(/,
  );
  assert.match(
    emergencyScreen,
    /const canEdit = hasLoadedProfile[\s\S]*status !== 'loading'/,
  );
  assert.match(
    emergencyScreen,
    /disabled=\{!canEdit \|\| isBusy \|\| !validation\.valid\}/,
  );
});

check('Emergency blood group uses letter O, never number zero', () => {
  assert.match(emergencyService, /'O\+', 'O-'/);
  assert.match(emergencyMigration, /'O\+', 'O-'/);
  assert.doesNotMatch(emergencyService, /'0\+'|'0-'/);
  assert.doesNotMatch(emergencyMigration, /'0\+'|'0-'/);
});

check('Emergency medical and ICE consent remain separate', () => {
  assert.match(emergencyService, /shareMedicalDataDuringSOS: boolean/);
  assert.match(emergencyService, /shareICEContactDuringSOS: boolean/);
  assert.match(
    emergencyMigration,
    /share_medical_data_during_sos boolean not null default false/,
  );
  assert.match(
    emergencyMigration,
    /share_ice_contact_during_sos boolean not null default false/,
  );
  assert.match(
    emergencyMigration,
    /case when emergency_profile\.share_medical_data_during_sos[\s\S]*case when emergency_profile\.share_ice_contact_during_sos/,
  );
});

check('Emergency data requires active SOS, trusted access, and consent', () => {
  assert.match(emergencyMigration, /status in \('open', 'accepted'\)/);
  assert.match(emergencyMigration, /trusted_contact\.linked_profile_id = auth\.uid\(\)/);
  assert.match(
    emergencyMigration,
    /share_medical_data_during_sos = true[\s\S]*share_ice_contact_during_sos = true/,
  );
});

check('Health data is absent from Radar and push payloads', () => {
  for (const source of [radarService, radarRepository, pushFunction]) {
    assert.doesNotMatch(
      source,
      /declared_blood_group|severe_allergies|important_conditions|relevant_medications|lifesaving_medications|ice_contact|emergency_notes/,
    );
  }
});

check('Feature backend errors are safely categorized', () => {
  assert.match(backendErrors, /PGRST202/);
  assert.match(backendErrors, /PGRST205/);
  assert.match(backendErrors, /42883/);
  assert.match(backendErrors, /42P01/);
  assert.match(backendErrors, /28000/);
  assert.match(backendErrors, /42501/);
  assert.match(backendErrors, /failed to fetch\|network request failed/);
  assert.match(backendErrors, /console\.warn\(`\[SafeMeLink Backend\]/);
  const diagnosticFields = backendErrors.match(
    /console\.warn\(`\[SafeMeLink Backend\][\s\S]*?\{([\s\S]*?)\}\);/,
  )?.[1];
  assert.ok(diagnosticFields, 'Backend diagnostic log not found.');
  assert.match(diagnosticFields, /category/);
  assert.match(diagnosticFields, /code/);
  assert.doesNotMatch(diagnosticFields, /cause|message/);
});

check('Radar and Emergency RPC types match client calls', () => {
  for (const rpcName of [
    'get_my_radar_preferences',
    'update_my_radar_preferences',
    'update_my_radar_presence',
    'deactivate_my_radar_presence',
    'find_nearby_users',
    'get_my_emergency_profile',
    'update_my_emergency_profile',
    'get_received_sos_emergency_profile',
  ]) {
    assert.match(databaseTypes, new RegExp(`${rpcName}:`));
  }
});

check('Radar and Emergency SQL access is scoped to authenticated RPCs', () => {
  assert.match(radarPresenceMigration, /alter table public\.radar_presence enable row level security/);
  assert.match(radarMigration, /alter table public\.radar_preferences enable row level security/);
  assert.match(emergencyMigration, /alter table public\.emergency_profiles enable row level security/);

  for (const [migration, functionNames] of [
    [
      radarPresenceMigration,
      ['update_my_radar_presence', 'deactivate_my_radar_presence', 'find_nearby_users'],
    ],
    [
      radarMigration,
      ['get_my_radar_preferences', 'update_my_radar_preferences', 'find_nearby_users'],
    ],
    [
      emergencyMigration,
      [
        'get_my_emergency_profile',
        'update_my_emergency_profile',
        'get_received_sos_emergency_profile',
      ],
    ],
  ]) {
    for (const functionName of functionNames) {
      const functionStart =
        migration.indexOf(`create or replace function public.${functionName}`) >= 0
          ? migration.indexOf(`create or replace function public.${functionName}`)
          : migration.indexOf(`create function public.${functionName}`);
      assert.notEqual(functionStart, -1, `${functionName} missing`);
      const functionEnd = migration.indexOf('$$;', functionStart);
      const functionBody = migration.slice(functionStart, functionEnd);
      assert.match(functionBody, /security definer/);
      assert.match(functionBody, /set search_path = public, pg_temp/);
      assert.match(functionBody, /auth\.uid\(\)/);
    }
  }

  assert.match(radarPresenceMigration, /revoke all on table public\.radar_presence from anon, authenticated/);
  assert.match(radarMigration, /revoke all on table public\.radar_preferences from anon, authenticated/);
  assert.match(emergencyMigration, /revoke all on table public\.emergency_profiles from anon, authenticated/);
  assert.match(radarPresenceMigration, /grant execute on function public\.update_my_radar_presence[\s\S]*to authenticated/);
  assert.match(radarMigration, /grant execute on function public\.get_my_radar_preferences\(\) to authenticated/);
  assert.match(emergencyMigration, /grant execute on function public\.get_my_emergency_profile\(\) to authenticated/);
});

check('Push function authenticates JWT and binds SOS to its owner', () => {
  assert.match(pushFunction, /adminClient\.auth\.getUser\(accessToken\)/);
  assert.match(pushFunction, /\.eq\('user_id', user\.id\)/);
  assert.match(pushFunction, /\.eq\('status', 'open'\)/);
});

check('Push recipients are resolved authoritatively, unique, active, and multi-device', () => {
  assert.match(pushRecipients, /\.rpc\(\s*'prepare_sos_delivery'/);
  assert.match(pushRecipients, /target_sos_id: sosId/);
  assert.match(pushRecipients, /\.from\('device_push_tokens'\)/);
  assert.match(pushRecipients, /new Set/);
  assert.match(pushRecipients, /new Map<string, SOSRecipientToken>/);
  assert.match(pushRecipients, /\.eq\('active', true\)/);
  assert.doesNotMatch(pushRecipients, /\.from\('trusted_contacts'\)/);
});

check('SOS push dispatch is idempotent and rate limited on the server', () => {
  assert.match(pushFunction, /\.rpc\(\s*'claim_sos_push_dispatch'/);
  assert.match(accountBootstrapMigration, /push_dispatched_at timestamptz/);
  assert.match(accountBootstrapMigration, /for update/);
  assert.match(accountBootstrapMigration, /return 'already_dispatched'/);
  assert.match(accountBootstrapMigration, /interval '5 minutes'/);
  assert.match(accountBootstrapMigration, /recent_dispatch_count >= 3/);
  assert.match(
    accountBootstrapMigration,
    /grant execute on function public\.claim_sos_push_dispatch\(uuid\) to service_role/,
  );
  assert.doesNotMatch(accountBootstrapMigration, /grant execute on function public\.claim_sos_push_dispatch\(uuid\) to authenticated/);
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

check('Received SOS RPC accepts only server-selected trusted or nearby recipients', () => {
  assert.match(receivedSOSMigration, /auth\.uid\(\) is not null/);
  assert.match(sosProximityNetworkMigration, /trusted_contact\.linked_profile_id = auth\.uid\(\)/);
  assert.match(sosProximityNetworkMigration, /nearby_alert\.nearby_user_id = auth\.uid\(\)/);
  assert.match(sosProximityNetworkMigration, /target\.status in \('open', 'accepted'\)/);
  assert.match(sosProximityNetworkMigration, /else 'Utente SafeMeLink'/);
});

check('Radar general network never requires a trusted link', () => {
  assert.doesNotMatch(radarMigration, /trusted_contacts|trusted_contact_requests/);
  assert.match(radarMigration, /candidate_preferences\.radar_enabled = true/);
  assert.match(radarMigration, /candidate_preferences\.visible_to_nearby = true/);
  assert.match(radarMigration, /candidate\.user_id <> current_user_id/);
});

check('SOS proximity recipients enforce opt-in, TTL, radius, limit, and sender exclusion', () => {
  assert.match(sosProximityNetworkMigration, /prepare_sos_delivery/);
  assert.match(sosProximityNetworkMigration, /sender_preferences\.radar_enabled = true/);
  assert.match(sosProximityNetworkMigration, /sender_preferences\.visible_to_nearby = true/);
  assert.match(sosProximityNetworkMigration, /preferences\.radar_enabled = true/);
  assert.match(sosProximityNetworkMigration, /preferences\.visible_to_nearby = true/);
  assert.match(sosProximityNetworkMigration, /now\(\) - public\.radar_presence_ttl\(\)/);
  assert.match(sosProximityNetworkMigration, /exact_distance_meters <= 1000/);
  assert.match(sosProximityNetworkMigration, /presence\.user_id <> target_sos\.user_id/);
  assert.match(sosProximityNetworkMigration, /limit 25/);
});

check('Nearby alert authorization expires with the SOS lifecycle', () => {
  assert.match(accountBootstrapMigration, /expire_nearby_alerts_on_sos_terminal/);
  assert.match(accountBootstrapMigration, /new\.status in \('closed', 'cancelled'\)/);
  assert.match(accountBootstrapMigration, /set status = 'expired'/);
  assert.match(
    accountBootstrapMigration,
    /nearby_alert\.status in \('detected', 'acknowledged', 'expired'\)/,
  );
  assert.match(
    accountBootstrapMigration,
    /after update of status on public\.sos/,
  );
});

check('Trusted and nearby SOS recipients remain separate and are deduplicated', () => {
  assert.match(sosProximityNetworkMigration, /trusted_recipients/);
  assert.match(sosProximityNetworkMigration, /nearby_recipients/);
  assert.match(sosProximityNetworkMigration, /union all/);
  assert.match(sosProximityNetworkMigration, /group by combined\.user_id/);
  assert.match(sosProximityNetworkMigration, /bool_or\(combined\.trusted\)/);
  assert.match(sosProximityNetworkMigration, /bool_or\(combined\.nearby\)/);
});

check('SOS recipient selection is service-role only and client payload chooses no recipients', () => {
  assert.match(
    sosProximityNetworkMigration,
    /revoke all on function public\.prepare_sos_delivery\(uuid\) from public, anon, authenticated/,
  );
  assert.match(
    sosProximityNetworkMigration,
    /grant execute on function public\.prepare_sos_delivery\(uuid\) to service_role/,
  );
  assert.match(pushFunction, /type SOSPushRequest = \{\s*sosId: string;\s*\}/);
  assert.doesNotMatch(pushFunction, /body\.recipient|recipientIds.*body/);
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

check('Voice Protection recognition stays local and delegates SOS through runtime', () => {
  assert.match(voiceProtectionLifecycle, /requiresOnDeviceRecognition: true/);
  assert.match(
    voiceProtectionScreen,
    /supportsOnDeviceRecognition\(\)/,
  );
  assert.doesNotMatch(voiceProtectionScreen, /SOSService|SOSLifecycleService|completeSOS/);
  assert.doesNotMatch(voiceProtectionService, /supabase|functions\.invoke|fetch\(/);
  assert.match(voiceProtectionLifecycle, /VoiceProtectionRuntime\.requestSOS\(/);
});

check('Voice Protection foreground service is declared as microphone', () => {
  assert.match(
    voiceProtectionService,
    /foregroundServiceType: \['microphone'\]/,
  );
  assert.match(
    voiceProtectionPlugin,
    /android\.permission\.FOREGROUND_SERVICE_MICROPHONE/,
  );
  assert.match(
    voiceProtectionPlugin,
    /android:foregroundServiceType'\] = 'microphone'/,
  );
});

check('Voice Protection state remains local and account scoped', () => {
  assert.match(accountStorage, /\| 'voice-protection'/);
  assert.match(voiceProtectionScreen, /VoiceProtectionStorage\.save\(userId/);
  assert.match(voiceProtectionService, /VoiceProtectionStorage\.save\(taskUserId/);
});

check('Voice permission denial offers a direct recovery path', () => {
  assert.match(voiceProtectionScreen, /showPermissionSettings/);
  assert.match(voiceProtectionScreen, /Linking\.openSettings\(\)/);
  assert.match(voiceProtectionScreen, /APRI IMPOSTAZIONI APP/);
});

check('Push token registration retries and follows native token rotation', () => {
  assert.match(pushTokenRegistrar, /addPushTokenListener/);
  assert.match(pushTokenRegistrar, /registerDevice\('foreground'\)/);
  assert.match(pushTokenRegistrar, /scheduleRetry/);
  assert.match(pushTokenRegistrar, /Math\.min\(60_000/);
  assert.match(pushTokenRegistrar, /MAX_AUTOMATIC_RETRY_ATTEMPTS = 5/);
  assert.match(
    pushTokenRegistrar,
    /retryAttempt >= MAX_AUTOMATIC_RETRY_ATTEMPTS/,
  );
  assert.match(
    pushTokenRepository,
    /select\('id,user_id,active,updated_at'\)[\s\S]*\.single\(\)/,
  );
});

check('Push token ownership supports account changes without affecting other devices', () => {
  assert.match(pushTokenRepository, /\.rpc\('claim_my_device_push_token'/);
  assert.match(pushTokenRepository, /removeForUserAndToken/);
  assert.match(
    pushTokenOwnershipMigration,
    /delete from public\.device_push_tokens tokens[\s\S]*tokens\.user_id <> current_user_id/,
  );
  assert.match(
    pushTokenOwnershipMigration,
    /on conflict \(expo_push_token\) do update[\s\S]*user_id = excluded\.user_id/,
  );
  assert.doesNotMatch(pushTokenOwnershipMigration, /delete from public\.device_push_tokens\s*;/);
});

check('Received SOS notifications use one global event-driven center', () => {
  assert.match(rootLayout, /<SOSNotificationCenter \/>/);
  assert.match(sosNotificationCenter, /addNotificationReceivedListener/);
  assert.match(sosNotificationCenter, /addNotificationResponseReceivedListener/);
  assert.match(sosNotificationCenter, /getLastNotificationResponseAsync/);
  assert.match(sosNotificationCenter, /receivedSubscription\.remove\(\)/);
  assert.match(sosNotificationCenter, /responseSubscription\.remove\(\)/);
  assert.doesNotMatch(pushTokenRegistrar, /addNotificationReceivedListener/);
  assert.doesNotMatch(pushTokenRegistrar, /addNotificationResponseReceivedListener/);
  assert.doesNotMatch(sosNotificationCenter, /setInterval\(/);
});

check('Received SOS events validate and deduplicate the real SOS identifier', () => {
  assert.match(sosNotificationPayload, /UUID_PATTERN/);
  assert.match(sosNotificationPayload, /candidate\.type !== 'sos_alert'/);
  assert.match(sosNotificationCenter, /eventStatesRef\.current\.has\(payload\.sosId\)/);
  assert.match(sosNotificationCenter, /eventStatesRef\.current\.set\(payload\.sosId, 'unread'\)/);
  assert.match(sosNotificationCenter, /SOSLifecycleService\.getStatus\(currentEvent\.sosId\)/);
  assert.match(sosNotificationCenter, /isUnavailableSOS\(error\)/);
  assert.match(sosNotificationCenter, /router\.push\(routePath as Href\)/);
});

check('Received SOS detail is bounded and does not display the complete UUID', () => {
  assert.match(receivedSOSRepository, /RECEIVED_SOS_REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(receivedSOSRepository, /\.abortSignal\(controller\.signal\)/);
  assert.match(receivedSOSRepository, /clearTimeout\(timeoutId\)/);
  assert.match(receivedSOSScreen, /formatSOSReference/);
  assert.doesNotMatch(receivedSOSScreen, /selectable style=\{styles\.eventId\}/);
});

check('Permission recovery and logout cleanup remain bounded', () => {
  assert.match(radarScreen, /Apri impostazioni/);
  assert.match(radarScreen, /Linking\.openSettings\(\)/);
  assert.match(
    pushNotificationService,
    /runPushStepWithTimeout\([\s\S]*PushTokenRepository\.removeForUserAndToken/,
  );
});

check('Foreground SOS uses the in-app alert while preserving one sound', () => {
  assert.match(pushNotificationService, /isForegroundSOS/);
  assert.match(pushNotificationService, /shouldPlaySound: true/);
  assert.match(pushNotificationService, /shouldShowBanner: !isForegroundSOS/);
  assert.match(sosNotificationCenter, /SOS RICEVUTO/);
  assert.match(sosNotificationCenter, /APRI EMERGENZA/);
});

check('Radar uses one bounded foreground location acquisition per attempt', () => {
  assert.match(radarProvider, /runOneShotRadar/);
  assert.match(
    radarProvider,
    /LocationService\.getCurrentLocation\(\{[\s\S]*timeoutMs: 15_000,[\s\S]*accuracy: 'balanced'/,
  );
  assert.match(
    radarProvider,
    /RadarService\.publishPresence\(location\)[\s\S]*RadarService\.findNearbyUsers\(\)/,
  );
  assert.doesNotMatch(locationService, /watchPositionAsync|watchRadarLocation/);
  assert.doesNotMatch(radarProvider, /startLocationWatch|watchdog|fallbackPending/);
});

check('Radar keeps an opted-in foreground presence fresh without a GPS watcher', () => {
  assert.doesNotMatch(radarProvider, /setInterval\(/);
  assert.match(radarProvider, /RADAR_PRESENCE_REFRESH_MS = 2 \* 60 \* 1_000/);
  assert.match(radarProvider, /RADAR_PRESENCE_RETRY_BASE_MS = 30_000/);
  assert.match(radarProvider, /RADAR_PRESENCE_FAST_RETRY_LIMIT = 3/);
  assert.match(radarProvider, /presenceRefreshTimer = setTimeout/);
  assert.match(
    radarProvider,
    /activeUserIdRef\.current !== expectedUserId/,
    'Radar presence mutations must not cross authenticated accounts.',
  );
  assert.match(
    radarProvider,
    /deactivationInFlightRef\.current\?\.userId === expectedUserId/,
    'Radar presence deactivation must be scoped to the authenticated account.',
  );
  assert.match(radarProvider, /clearTimeout\(presenceRefreshTimer\)/);
  assert.match(radarProvider, /appState !== 'active'[\s\S]{0,120}!canPublishPresence/);
  assert.match(radarProvider, /RADAR_PRESENCE_PUBLICATION_ATTEMPTED/);
  assert.match(radarProvider, /RADAR_PRESENCE_REFRESH_SCHEDULED/);
  assert.match(radarProvider, /RADAR_PRESENCE_REFRESH_EXECUTED/);
  assert.match(radarProvider, /RADAR_GPS_ACQUISITION_FAILED/);
  assert.doesNotMatch(radarProvider, /scheduleNetworkRefresh|runSingleLocationFallback/);
  assert.doesNotMatch(radarService, /RADAR_REFRESH_INTERVAL_MS|RADAR_LOCATION_FALLBACK_INTERVAL_MS/);
  assert.match(radarProvider, /manualRefreshRef\.current = \(\) =>/);
  assert.match(radarProvider, /attemptInFlight/);
  assert.doesNotMatch(
    radarProvider,
    /appState = nextState;[\s\S]{0,120}attemptInFlight = false/,
  );
});

check('Radar preference bootstrap recovers from temporary backend failures', () => {
  assert.match(radarProvider, /RADAR_PREFERENCES_MAX_RETRIES = 5/);
  assert.match(radarProvider, /schedulePreferencesRetry/);
  assert.match(radarProvider, /retryAttempt >= RADAR_PREFERENCES_MAX_RETRIES/);
  assert.match(radarProvider, /AppState\.currentState !== 'active'/);
  assert.match(radarProvider, /retryAttempt = 0;[\s\S]*loadPreferences\(\)/);
});

check('Radar ignores stale async results and cleans up screen lifecycle', () => {
  assert.match(radarProvider, /attemptGeneration/);
  assert.match(radarProvider, /isAttemptCurrent\(generation\)/);
  assert.match(radarProvider, /attemptGeneration \+= 1/);
  assert.match(radarProvider, /appStateSubscription\.remove\(\)/);
  assert.match(radarProvider, /manualRefreshRef\.current = \(\) => undefined/);
});

check('Radar keeps a TTL presence after screen blur without keeping GPS active', () => {
  const cleanupMarker = radarProvider.indexOf(
    'manualRefreshRef.current = () => undefined;',
  );
  const cleanupStart = radarProvider.lastIndexOf('return () => {', cleanupMarker);
  const cleanupEnd = radarProvider.indexOf('\n    };', cleanupMarker);
  assert.ok(cleanupMarker >= 0 && cleanupStart >= 0 && cleanupEnd >= 0);
  const cleanup = radarProvider.slice(cleanupStart, cleanupEnd);
  assert.doesNotMatch(cleanup, /deactivate\(/);
  assert.match(
    radarProvider,
    /preferences[\s\S]*!participationEnabled[\s\S]*deactivate\(userId\)/,
  );
  const appStateHandler = radarProvider.match(
    /AppState\.addEventListener\('change',[\s\S]*?\n    \}\);/,
  )?.[0];
  assert.ok(appStateHandler, 'Radar AppState handler not found.');
  assert.doesNotMatch(appStateHandler, /deactivate\(/);
});

check('Radar master switch represents complete reciprocal participation', () => {
  assert.match(radarScreen, /const isParticipating = canParticipateInRadar\(preferences\)/);
  assert.match(
    radarScreen,
    /saveChanges\(\{ radarEnabled, visibleToNearby: radarEnabled \}\)/,
  );
  assert.match(radarScreen, /value=\{isParticipating\}/);
});

check('SOS network diagnostics expose only aggregate delivery counts', () => {
  for (const marker of [
    'SOS_NEARBY_RECIPIENT_COUNT',
    'SOS_NEARBY_NO_ELIGIBLE_USERS',
    'PUSH_TOKEN_COUNT',
    'PUSH_SENT_COUNT',
    'PUSH_FAILED_COUNT',
    'EXPO_TICKET_OK_COUNT',
    'EXPO_TICKET_ERROR_COUNT',
  ]) {
    assert.match(sosPushService, new RegExp(marker));
    assert.match(pushFunction, new RegExp(marker));
  }
  assert.doesNotMatch(
    sosPushService,
    /SOS_NEARBY_RECIPIENT_COUNT[\s\S]{0,180}(sosId|userId|token|latitude|longitude)/,
  );
});

check('Voice recognition has single continuous ownership and bounded restart', () => {
  assert.doesNotMatch(homeScreen, /useSpeechRecognitionEvent|ExpoSpeechRecognitionModule/);
  assert.doesNotMatch(voiceProtectionScreen, /useSpeechRecognitionEvent|runVoiceTest|testTranscript/);
  assert.equal(
    (voiceProtectionLifecycle.match(/useSpeechRecognitionEvent\(/g) ?? []).length,
    4,
  );
  assert.match(voiceProtectionService, /TASK_MAX_SLEEP_MS = 60_000/);
  assert.match(voiceProtectionLifecycle, /MAX_CONSECUTIVE_FAILURES = 5/);
  assert.match(voiceProtectionLifecycle, /disableProtection\(currentUserId, 'circuit_breaker'\)/);
  assert.doesNotMatch(voiceProtectionRuntime, /suspendRecognition|isRecognitionSuspended/);
});

check('Voice activation waits for a confirmed native recognition start', () => {
  assert.match(
    voiceProtectionScreen,
    /waitForRecognitionStart\(userId, 8_000\)[\s\S]*notifySettingsChanged\(userId\)[\s\S]*await recognitionStarted[\s\S]*setSettings\(activeSettings\)/,
  );
  assert.match(
    voiceProtectionLifecycle,
    /useSpeechRecognitionEvent\('start',[\s\S]*notifyRecognitionStarted\(currentUserId\)/,
  );
  assert.match(voiceProtectionScreen, /settingsRefreshPendingRef/);
  assert.match(voiceProtectionScreen, /refreshRequestedRef/);
  assert.match(
    voiceProtectionScreen,
    /refreshInFlightRef\.current\) \{[\s\S]*refreshRequestedRef\.current = true/,
  );
});

check('Voice keyword reaches the existing SOS countdown exactly once per session', () => {
  assert.match(voiceProtectionLifecycle, /sosRequestedForSessionRef/);
  assert.equal(
    (voiceProtectionLifecycle.match(/VoiceProtectionRuntime\.requestSOS\(/g) ?? []).length,
    1,
  );
  assert.match(voiceProtectionRuntime, /waitForRecognitionStart/);
  assert.match(voiceProtectionRuntime, /sosRequestListeners\.size === 0/);
  assert.match(voiceProtectionRuntime, /pendingSOSUserId/);
  assert.match(homeScreen, /VoiceProtectionRuntime\.onSOSRequested/);
  assert.match(homeScreen, /startSOSCountdown\(\)/);
  assert.match(homeScreen, /router\.dismissTo\('\/\(tabs\)'\)/);
  assert.match(homeScreen, /VOICE_LISTENER_RECEIVED/);
  assert.match(homeScreen, /VOICE_COUNTDOWN_STARTED/);
  assert.match(homeScreen, /statusRef\.current = 'countdown'/);
  assert.match(homeScreen, /voiceCountdownPendingRef\.current = false/);
  assert.match(
    homeScreen,
    /if \(statusRef\.current === 'idle'\)[\s\S]*Snapshot locale ignorato durante lifecycle attivo/,
  );
  assert.match(voiceProtectionLifecycle, /VOICE_MATCH_OK/);
  assert.match(voiceProtectionRuntime, /VOICE_SOS_REQUESTED/);
  assert.match(voiceProtectionRuntime, /VOICE_REQUEST_QUEUED/);
});

check('SOS push remains primary and local fallback is bounded and observable', () => {
  assert.match(sosService, /if \(pushResult\.notificationsSent === 0\)/);
  assert.match(sosService, /localDeliveryResult = await sendSosAlert/);
  assert.match(sosAlertService, /LOCAL_FALLBACK_DEADLINE_MS = 12_000/);
  assert.match(sosAlertService, /Linking\.canOpenURL/);
  assert.match(sosAlertService, /contact\.preferredChannel === 'whatsapp'/);
  assert.doesNotMatch(sosAlertService, /Alert\.alert/);
});

check('SOS activation supersedes preventive safety timers', () => {
  const startCountdown = homeScreen.match(
    /const startSOSCountdown = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1];
  assert.ok(startCountdown, 'SOS countdown callback not found.');
  assert.match(startCountdown, /setCheckpointStatus\('idle'\)/);
  assert.match(startCountdown, /goHomeEstimateGenerationRef\.current \+= 1/);
  assert.match(startCountdown, /setGoHomeStatus\('idle'\)/);
});

check('Trusted contact mutations are guarded against duplicate taps', () => {
  assert.match(contactsScreen, /contactActionInFlightRef/);
  assert.match(contactsScreen, /if \(contactActionInFlightRef\.current\)/);
  assert.match(contactsScreen, /linkActionInFlightRef/);
  assert.match(contactsScreen, /if \(linkActionInFlightRef\.current\)/);
  assert.match(contactsScreen, /disabled=\{contactActionPending\}/);
});

check('WhatsApp fallback prefers the native scheme and never invents a country code', () => {
  assert.match(phoneIdentity, /E164_PATTERN = \/\^\\\+\[1-9\]\\d\{6,14\}\$\//);
  assert.match(
    sosAlertService,
    /return \[\s*`whatsapp:\/\/send[\s\S]*`https:\/\/wa\.me/,
  );
  assert.doesNotMatch(sosAlertService, /\+39|defaultCountry|countryCode/);
  assert.match(sosAlertService, /contact\.phoneE164/);
  assert.match(sosAlertService, /WHATSAPP_COMPOSER_OPENED/);
  assert.match(sosAlertService, /smsFollowUpAvailable: true/);
  assert.match(sosAlertService, /CONTACT_SOURCE_LINKED/);
  assert.match(sosAlertService, /CONTACT_SOURCE_LOCAL/);
});

check('Sensitive errors are categorized rather than logged as raw objects', () => {
  assert.doesNotMatch(homeScreen, /errore operazione'[\s\S]{0,160}\berror,\s*\}/);
  assert.doesNotMatch(homeScreen, /impostazioni posizione non riuscita', error\)/);
});

check('Trusted contacts distinguish and deduplicate local and linked recipients', () => {
  assert.match(trustedLinksService, /remoteContactsByIdentity/);
  assert.match(trustedLinksService, /mergedLocalIds/);
  assert.match(contactsScreen, /SafeMeLink collegato \+ numero locale/);
  assert.match(contactsScreen, /Solo numero locale/);
  assert.doesNotMatch(homeScreen, /contacts\.length\}\/3/);
});

check('UI separates the general network from the personal trusted circle', () => {
  assert.match(radarScreen, /La partecipazione alla rete non crea contatti fidati/);
  assert.match(contactsScreen, /cerchia personale, separata dalla rete generale SafeMeLink/);
  assert.match(contactsScreen, /contatto fidato personale e prioritario per gli SOS/);
});

check('Trusted contacts migrate phone fallbacks but links require accepted requests', () => {
  assert.doesNotMatch(trustedLinksService, /localOnlyContacts/);
  assert.doesNotMatch(trustedLinksService, /TrustedContactsRepository\.create/);
  assert.match(trustedLinksService, /CONTACT_SOURCE_REMOTE/);
  assert.match(contactsService, /async importLegacy\(id: string\)/);
  assert.match(contactsScreen, /Contatti locali precedenti/);
  assert.match(contactsScreen, /non vengono sincronizzati automaticamente/);
  assert.match(trustedLinksService, /trusted_contacts confermati/);
  assert.match(
    trustedLinksHardeningMigration,
    /linked_profile_id is null/,
  );
  assert.match(
    trustedLinksHardeningMigration,
    /prevent_direct_trusted_link_change/,
  );
  assert.match(trustedPhoneIdentityMigration, /phone_e164 text/);
  assert.match(trustedPhoneIdentityMigration, /preferred_channel text/);
  assert.match(trustedPhoneIdentityMigration, /trusted_contacts_unique_phone_e164_idx/);
  assert.match(contactsService, /phone_e164: input\.phoneE164/);
  assert.match(contactsService, /preferred_channel: input\.preferredChannel/);
  assert.match(contactsStorage, /phoneE164/);
});

check('Go Home transport mode is account-scoped and belongs to the active session', () => {
  assert.match(goHomeStorage, /GoHomeTransportMode = 'walking' \| 'cycling' \| 'driving'/);
  assert.match(goHomeStorage, /'go-home-transport-mode'/);
  assert.match(goHomeStorage, /transportMode: GoHomeTransportMode/);
  assert.match(homeScreen, /Come ti stai spostando\?/);
  assert.match(homeScreen, /estimateGoHomeMinutes\(distanceKm, transportMode\)/);
  assert.match(homeScreen, /transportMode,/);
});

check('Fundamental production queries have bounded access paths', () => {
  assert.match(initialSchemaMigration, /sos_user_created_idx/);
  assert.match(initialSchemaMigration, /nearby_alerts_unique_detection unique \(sos_id, nearby_user_id\)/);
  assert.match(initialSchemaMigration, /nearby_alerts_nearby_user_created_idx/);
  assert.match(initialSchemaMigration, /trusted_contacts_user_idx/);
  assert.match(pushSchemaMigration, /expo_push_token text not null unique/);
  assert.match(pushSchemaMigration, /device_push_tokens_user_active_idx/);
  assert.match(radarPresenceMigration, /radar_presence_recent_active_idx/);
  assert.match(radarMigration, /user_id uuid primary key/);
  assert.match(accountBootstrapMigration, /sos_push_dispatch_rate_idx/);
});

check('Anonymous nearby users never enter the personal phone fallback', () => {
  assert.doesNotMatch(sosAlertService, /RadarService|NearbyUser|nearby_alerts|radar_presence/);
  assert.match(sosService, /sendSosAlert\(completedEvent, contacts\)/);
  assert.match(sosService, /ContactsService\.list\(expectedUserId\)/);
});

check('Production source contains no hardcoded test accounts or credentials', () => {
  const productionSource = [
    ...readSourceTree('app'),
    ...readSourceTree('backend'),
    ...readSourceTree('components'),
    ...readSourceTree('hooks'),
    ...readSourceTree('screens'),
    ...readSourceTree('services'),
    ...readSourceTree('storage'),
    ...readSourceTree('supabase/functions'),
  ].join('\n');
  assert.doesNotMatch(productionSource, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(
    productionSource,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  assert.doesNotMatch(
    productionSource,
    /(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,}\]/,
  );
});

check('Android package visibility exposes SOS fallback channels', () => {
  assert.match(sosChannelQueriesPlugin, /android\.intent\.action\.SENDTO/);
  assert.match(sosChannelQueriesPlugin, /scheme: 'sms'/);
  assert.match(sosChannelQueriesPlugin, /scheme: 'smsto'/);
  assert.match(sosChannelQueriesPlugin, /scheme: 'whatsapp'/);
  assert.match(sosChannelQueriesPlugin, /com\.whatsapp\.w4b/);
});

process.stdout.write('All static audit checks passed.\n');
