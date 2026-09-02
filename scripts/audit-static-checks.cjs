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
const remoteRequest = read('backend/remoteRequest.ts');
const trustedContactsRepository = read('backend/repositories/TrustedContactsRepository.ts');
const trustedLinksRepository = read('backend/repositories/TrustedLinksRepository.ts');
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
const checkpointStorage = read('storage/CheckpointStorage.ts');
const contactsScreen = read('screens/TrustedContactsScreen.tsx');
const voiceProtectionScreen = read('app/voice-protection.tsx');
const voiceProtectionService = read('services/VoiceProtectionService.ts');
const voiceProtectionLifecycle = read('components/VoiceProtectionLifecycle.tsx');
const voiceProtectionRuntime = read('services/VoiceProtectionRuntime.ts');
const voiceProtectionPlugin = read(
  'plugins/withVoiceProtectionForegroundService.cjs',
);
const smsNativeBuildGradle = read('modules/safemelink-sms/android/build.gradle');
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
const sosAutomaticSmsService = read('services/SOSAutomaticSmsService.ts');
const sosAutomaticSmsStorage = read('storage/SOSAutomaticSmsStorage.ts');
const sosNetworkLocationStorage = read('storage/SOSNetworkLocationStorage.ts');
const smsNativeModule = read(
  'modules/safemelink-sms/android/src/main/java/com/tiziano/safemelink/sms/SafeMeLinkSmsModule.kt',
);
const trustedLinksService = read('services/TrustedLinksService.ts');
const sosChannelQueriesPlugin = read('plugins/withSOSChannelQueries.cjs');
const receivedSOSRepository = read('backend/repositories/ReceivedSOSRepository.ts');
const receivedSOSInboxMigration = read(
  'supabase/migrations/20260831120000_received_sos_inbox.sql',
);
const receivedSOSScreen = read('app/sos/[id].tsx');
const sosNetworkMigration = read(
  'supabase/migrations/20260825120000_sos_network_presence.sql',
);
const sosDeliveryAmbiguityFixMigration = read(
  'supabase/migrations/20260828120000_fix_prepare_sos_delivery_ambiguity.sql',
);
const sosNetworkRepository = read(
  'backend/repositories/SOSNetworkPresenceRepository.ts',
);
const sosNetworkProvider = read('components/SOSNetworkPresenceProvider.tsx');
const sosNetworkService = read('services/SOSNetworkPresenceService.ts');
const sosNetworkTask = read('services/SOSNetworkBackgroundTask.ts');
const sosDispatchLeaseMigration = read(
  'supabase/migrations/20260826120000_sos_push_dispatch_lease.sql',
);
const appConfig = read('app.json');

check('Radar client uses 1 km and 25 results', () => {
  assert.match(radarService, /RADAR_SEARCH_RADIUS_METERS = 1_000/);
  assert.match(radarService, /RADAR_RESULT_LIMIT = 25/);
});

check('SafeMeLink network UI uses persistent SOS-network consent without visual Radar', () => {
  assert.match(sosNetworkMigration, /create table if not exists public\.sos_network_presence/);
  assert.match(sosNetworkMigration, /add column sos_network_enabled boolean not null default false/);
  assert.doesNotMatch(sosNetworkMigration, /set sos_network_enabled = true/);
  assert.match(sosNetworkMigration, /current_user_id uuid := auth\.uid\(\)/);
  assert.match(sosNetworkMigration, /for update/);
  assert.match(sosNetworkRepository, /get_my_sos_network_preference/);
  assert.match(radarScreen, /Rete SafeMeLink attiva/);
  assert.match(radarScreen, /network\.setEnabled\(true\)/);
  assert.match(radarScreen, /network\.setEnabled\(false\)/);
  assert.doesNotMatch(rootLayout, /<RadarProvider>/);
  assert.doesNotMatch(radarScreen, /useRadar|useNearbyUsers|findNearbyUsers/);
  assert.doesNotMatch(
    radarScreen,
    /NearbyUser|publicNickname|distanceMeters|\blatitude\b|\blongitude\b/,
  );
});

check('SOS network background location is bounded, opportunistic and account-scoped', () => {
  assert.match(sosNetworkService, /Accuracy\.Balanced/);
  assert.match(sosNetworkService, /Accuracy\.High/);
  assert.match(sosNetworkService, /Location\.hasServicesEnabledAsync\(\)/);
  assert.match(sosNetworkService, /SOSNetworkLocationServicesDisabledError/);
  assert.match(sosNetworkService, /BACKGROUND_UPDATE_INTERVAL_MS = 10 \* 60 \* 1_000/);
  assert.match(sosNetworkService, /BACKGROUND_UPDATE_DISTANCE_METERS = 100/);
  assert.match(sosNetworkService, /pausesUpdatesAutomatically: true/);
  assert.match(sosNetworkService, /session\?\.user\.id !== expectedUserId/);
  assert.match(sosNetworkProvider, /FOREGROUND_REFRESH_MS = 10 \* 60 \* 1_000/);
  assert.match(
    sosNetworkProvider,
    /consecutiveFailures > 0 && consecutiveFailures <= 3[\s\S]*30_000 \* 2 \*\* \(consecutiveFailures - 1\)/,
  );
  assert.match(sosNetworkProvider, /location_services_required/);
  assert.match(sosNetworkProvider, /notification_permission_required/);
  assert.match(sosNetworkProvider, /AppState\.addEventListener\('change'/);
  assert.doesNotMatch(sosNetworkProvider, /setInterval/);
  assert.doesNotMatch(sosNetworkService, /watchPositionAsync/);
  assert.match(sosNetworkTask, /TaskManager\.defineTask/);
  assert.match(sosNetworkService, /SOS_NETWORK_PERMISSION_FOREGROUND/);
  assert.match(sosNetworkService, /SOS_NETWORK_PERMISSION_BACKGROUND/);
  assert.match(sosNetworkService, /SOS_NETWORK_PRESENCE_ATTEMPT/);
  assert.match(sosNetworkService, /SOS_NETWORK_PRESENCE_SUCCESS/);
  assert.match(sosNetworkTask, /SOS_NETWORK_PRESENCE_FAILURE/);
  assert.match(sosNetworkProvider, /SOS_NETWORK_OPT_IN_ENABLED/);
  assert.match(
    sosNetworkProvider,
    /startBackgroundUpdates\(\)[\s\S]*publishForegroundPresence/,
  );
  assert.match(
    sosNetworkProvider,
    /catch \(startError: unknown\)[\s\S]*publishForegroundPresence/,
  );
  assert.match(rootLayout, /SOSNetworkBackgroundTask/);
  assert.match(appConfig, /"isAndroidBackgroundLocationEnabled": true/);
  assert.match(appConfig, /"isIosBackgroundLocationEnabled": true/);
});

check('SOS nearby selection uses backend freshness, adaptive radius and deterministic ranking', () => {
  assert.doesNotMatch(sosDeliveryAmbiguityFixMigration, /sender_network_enabled/);
  assert.doesNotMatch(
    sosDeliveryAmbiguityFixMigration,
    /sender_preferences[\s\S]*sos_network_enabled = true/,
  );
  assert.match(
    sosDeliveryAmbiguityFixMigration,
    /preferences\.user_id = presence\.user_id[\s\S]*preferences\.sos_network_enabled = true/,
  );
  assert.match(sosDeliveryAmbiguityFixMigration, /presence\.observed_at >= now\(\) - interval '30 minutes'/);
  assert.match(sosDeliveryAmbiguityFixMigration, /interval '5 minutes' then 0/);
  assert.match(sosDeliveryAmbiguityFixMigration, /interval '15 minutes' then 1000/);
  assert.match(sosDeliveryAmbiguityFixMigration, /presence\.accuracy <= 100/);
  assert.match(sosDeliveryAmbiguityFixMigration, /eligible\.distance_meters <= 1000/);
  assert.match(sosDeliveryAmbiguityFixMigration, /eligible\.distance_meters <= 3000/);
  assert.doesNotMatch(
    sosDeliveryAmbiguityFixMigration,
    /filter \(where distance_meters <=/,
  );
  assert.match(sosDeliveryAmbiguityFixMigration, /selected_radius_meters integer := 5000/);
  assert.match(sosDeliveryAmbiguityFixMigration, /reliability_score/);
  assert.match(sosDeliveryAmbiguityFixMigration, /limit maximum_nearby_recipients/);
  assert.match(sosDeliveryAmbiguityFixMigration, /group by combined\.user_id/);
  assert.doesNotMatch(sosDeliveryAmbiguityFixMigration, /grant execute[\s\S]*prepare_sos_delivery\(uuid\) to authenticated/);
});

check('SOS nearby boundary scenarios retain valid responders', () => {
  const chooseRadius = (distances) => {
    if (distances.filter((distance) => distance <= 1_000).length >= 5) return 1_000;
    if (distances.filter((distance) => distance <= 3_000).length >= 5) return 3_000;
    return 5_000;
  };
  const selected = (distances) => {
    const radius = chooseRadius(distances);
    return distances.filter((distance) => distance <= radius).slice(0, 25);
  };

  assert.deepEqual(selected([150]), [150]);
  for (const distance of [20, 100, 500, 1_000, 3_000, 5_000]) {
    assert.deepEqual(selected([distance]), [distance]);
  }
  assert.deepEqual(selected([150, 250]), [150, 250]);
  assert.deepEqual(selected([150, 250, 350, 450]), [150, 250, 350, 450]);
  assert.equal(chooseRadius([100, 200, 300, 400, 500]), 1_000);
  assert.equal(chooseRadius([2_000]), 5_000);
  assert.deepEqual(selected([2_000]), [2_000]);
  assert.deepEqual(selected([4_000]), [4_000]);
  assert.deepEqual(selected([5_001]), []);
  assert.equal(selected(Array.from({ length: 30 }, (_, index) => index + 100)).length, 25);

  const isFresh = (ageSeconds) => ageSeconds <= 30 * 60;
  const freshnessPenalty = (ageSeconds) =>
    ageSeconds <= 5 * 60 ? 0 : ageSeconds <= 15 * 60 ? 1_000 : 3_000;
  assert.equal(isFresh(4 * 60 + 59), true);
  assert.equal(freshnessPenalty(4 * 60 + 59), 0);
  assert.equal(freshnessPenalty(5 * 60 + 1), 1_000);
  assert.equal(freshnessPenalty(14 * 60 + 59), 1_000);
  assert.equal(freshnessPenalty(15 * 60 + 1), 3_000);
  assert.equal(isFresh(29 * 60 + 59), true);
  assert.equal(isFresh(30 * 60 + 1), false);
  const hasValidAccuracy = (accuracy) => accuracy >= 0 && accuracy <= 100;
  assert.equal(hasValidAccuracy(100), true);
  assert.equal(hasValidAccuracy(100.01), false);
});

check('SOS push claim is a recoverable pre-attempt lease with conservative post-attempt handling', () => {
  assert.match(sosDispatchLeaseMigration, /push_dispatch_claim_id uuid/);
  assert.match(sosDispatchLeaseMigration, /push_dispatch_attempted_at timestamptz/);
  assert.doesNotMatch(sosDispatchLeaseMigration, /drop function.*claim_sos_push_dispatch\(uuid\)/);
  assert.match(sosDispatchLeaseMigration, /interval '2 minutes'/);
  assert.match(sosDispatchLeaseMigration, /return 'attempt_in_progress'/);
  assert.match(sosDispatchLeaseMigration, /return 'in_progress'/);
  assert.match(sosDispatchLeaseMigration, /release_sos_push_dispatch/);
  assert.match(sosDispatchLeaseMigration, /push_dispatch_attempted_at is null/);
  assert.match(pushFunction, /mark_sos_push_dispatch_attempted/);
  assert.match(pushFunction, /complete_sos_push_dispatch/);
  assert.match(pushFunction, /dispatchClaimed && !dispatchAttempted/);
  assert.match(pushFunction, /EXPO_REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(pushFunction, /PUSH_REQUEST_RECEIVED/);
  assert.match(pushFunction, /PUSH_AUTH_VERIFIED/);
  assert.match(pushFunction, /failureStage = 'mark_attempted'/);
  assert.match(pushFunction, /failureStage = 'complete_dispatch'/);
  assert.match(sosPushService, /EDGE_FUNCTION_MAX_ATTEMPTS = 2/);
  assert.match(sosPushService, /attempt <= EDGE_FUNCTION_MAX_ATTEMPTS/);
});

check('Radar diagnostics cover opt-in, permission, presence and nearby results', () => {
  for (const marker of [
    'RADAR_ENABLED',
    'RADAR_PERMISSION',
    'RADAR_PRESENCE_ATTEMPT',
    'RADAR_PRESENCE_SUCCESS',
    'RADAR_PRESENCE_FAILURE',
    'RADAR_NEARBY_COUNT',
  ]) {
    assert.match(radarProvider, new RegExp(marker));
  }
});

check('Cold-start SOS routing waits for authentication and navigation readiness', () => {
  assert.match(sosNotificationCenter, /authReadyRef/);
  assert.match(sosNotificationCenter, /!navigationReadyRef\.current \|\| !authReadyRef\.current/);
  assert.match(
    sosNotificationCenter,
    /isInitializing \|\|[\s\S]*!session\?\.user\.id \|\|[\s\S]*!pendingResponseRef\.current/,
  );
  assert.match(sosNotificationCenter, /SOS_NOTIFICATION_FOREGROUND/);
  assert.match(sosNotificationCenter, /SOS_NOTIFICATION_RESPONSE/);
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
  assert.match(radarScreen, /PARTECIPA ALLA RETE/);
  assert.match(radarScreen, /Partecipando consenti/);
  assert.doesNotMatch(radarScreen, /Radar ON|Mostrami agli utenti vicini/);
});

check('Database types cover server-side SOS delivery RPCs', () => {
  assert.match(
    databaseTypes,
    /claim_sos_push_dispatch:[\s\S]*target_sos_id: string; requested_claim_id: string/,
  );
  assert.match(databaseTypes, /mark_sos_push_dispatch_attempted:[\s\S]*Returns: boolean/);
  assert.match(databaseTypes, /complete_sos_push_dispatch:[\s\S]*Returns: boolean/);
  assert.match(databaseTypes, /release_sos_push_dispatch:[\s\S]*Returns: boolean/);
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
  assert.match(sosDispatchLeaseMigration, /for update/);
  assert.match(sosDispatchLeaseMigration, /return 'already_dispatched'/);
  assert.match(sosDispatchLeaseMigration, /interval '5 minutes'/);
  assert.match(sosDispatchLeaseMigration, /recent_dispatch_count >= 3/);
  assert.match(
    sosDispatchLeaseMigration,
    /grant execute on function public\.claim_sos_push_dispatch\(uuid, uuid\) to service_role/,
  );
  assert.doesNotMatch(
    sosDispatchLeaseMigration,
    /grant execute on function public\.claim_sos_push_dispatch\(uuid, uuid\) to authenticated/,
  );
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
  assert.match(
    homeScreen,
    /resetSensitiveState\(\);[\s\S]*\}, \[clearPersistedCheckpoint, clearPersistedGoHome, resetSensitiveState, userId\]\)/,
  );
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

check('Voice Protection foreground service requires microphone and location', () => {
  const runtimeServiceTypes = voiceProtectionService.match(
    /foregroundServiceType: \[([^\]]+)\]/,
  )?.[1] ?? '';
  assert.match(runtimeServiceTypes, /['"]microphone['"]/);
  assert.match(runtimeServiceTypes, /['"]location['"]/);
  assert.match(
    voiceProtectionPlugin,
    /android\.permission\.FOREGROUND_SERVICE_MICROPHONE/,
  );
  assert.match(
    voiceProtectionPlugin,
    /android\.permission\.FOREGROUND_SERVICE_LOCATION/,
  );
  const manifestServiceTypes = voiceProtectionPlugin.match(
    /android:foregroundServiceType'\]\s*=\s*'([^']+)'/,
  )?.[1]?.split('|') ?? [];
  assert.ok(manifestServiceTypes.includes('microphone'));
  assert.ok(manifestServiceTypes.includes('location'));
  assert.match(voiceProtectionPlugin, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(voiceProtectionScreen, /Location\.requestForegroundPermissionsAsync\(\)/);
});

check('SafeMeLink SMS uses the modern Expo Module Android configuration', () => {
  assert.match(smsNativeBuildGradle, /plugins\s*\{/);
  assert.match(smsNativeBuildGradle, /id 'expo-module-gradle-plugin'/);
  assert.match(smsNativeBuildGradle, /defaultConfig\s*\{/);
  assert.match(smsNativeBuildGradle, /versionCode\s+1/);
  assert.match(smsNativeBuildGradle, /versionName\s+'1\.0\.0'/);
  assert.doesNotMatch(smsNativeBuildGradle, /project\.ext|get\('minSdkVersion'\)/);
});

check('Voice Protection keeps one bounded background recognition owner', () => {
  assert.match(
    voiceProtectionLifecycle,
    /!VoiceProtectionService\.isRunning\(\)/,
  );
  assert.doesNotMatch(
    voiceProtectionLifecycle,
    /if \(nextState !== 'active'\) \{\s*stopRecognition\(\);/,
  );
  assert.match(voiceProtectionLifecycle, /MAX_CONSECUTIVE_FAILURES = 5/);
  assert.match(voiceProtectionLifecycle, /VOICE_TRIGGER_COOLDOWN_MS = 30_000/);
  assert.match(voiceProtectionLifecycle, /accountCleanupPromiseRef/);
  assert.match(
    voiceProtectionLifecycle,
    /activeUserIdRef\.current === userId/,
  );
  assert.match(voiceProtectionService, /ExpoSpeechRecognitionModule\.abort\(\)/);
  assert.match(
    voiceProtectionService,
    /VoiceProtectionRuntime\.notifySettingsChanged\(taskUserId\)/,
  );
  assert.doesNotMatch(voiceProtectionLifecycle, /setInterval\(/);
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
  assert.match(sosNotificationCenter, /ReceivedSOSRepository\.listActive\(\)/);
  assert.match(sosNotificationCenter, /AppState\.addEventListener\('change'/);
  assert.match(receivedSOSInboxMigration, /list_my_active_received_sos/);
  assert.match(receivedSOSInboxMigration, /target\.status in \('open', 'accepted'\)/);
  assert.doesNotMatch(receivedSOSInboxMigration, /target\.latitude|target\.longitude/);
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
  assert.match(radarScreen, /foreground_permission_required/);
  assert.match(radarScreen, /background_permission_required/);
  assert.match(radarScreen, /notification_permission_required/);
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
    /LocationService\.getCurrentLocation\(\{[\s\S]*timeoutMs: 15_000,[\s\S]*accuracy: 'high'/,
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

check('SafeMeLink network screen exposes no individual nearby discovery', () => {
  assert.match(radarScreen, /non mostriamo persone, nickname, distanze o posizioni/);
  assert.match(radarScreen, /solo i destinatari autorizzati possono aprire la posizione reale/);
  assert.doesNotMatch(radarScreen, /RadarService|RadarProvider|radarEnabled|visibleToNearby/);
  assert.doesNotMatch(radarScreen, /dati aggregati|copertura non.*disponibil/);
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
  assert.match(homeScreen, /Date\.now\(\) \+ SAFETY_TIMER_SECONDS \* 1_000/);
  assert.match(homeScreen, /expiresAt - Date\.now\(\)/);
  assert.match(homeScreen, /countdownCompletionHandledRef/);
  assert.match(voiceProtectionRuntime, /VOICE_SOS_COUNTDOWN_MS = 10_000/);
  assert.match(voiceProtectionRuntime, /scheduledSOS = \{ userId, expiresAt: now \+ VOICE_SOS_COUNTDOWN_MS \}/);
  assert.match(voiceProtectionRuntime, /claimDueSOS/);
  assert.match(voiceProtectionRuntime, /waitForBackgroundWake/);
  assert.match(voiceProtectionService, /VoiceProtectionRuntime\.claimDueSOS\(taskUserId\)/);
  assert.match(
    voiceProtectionService,
    /SOSService\.completeSOS\(taskUserId,[\s\S]*allowRecentNetworkLocation: true,[\s\S]*allowInteractiveFallback: false/,
  );
  assert.match(homeScreen, /VoiceProtectionRuntime\.onSOSCompleted/);
  assert.match(homeScreen, /VoiceProtectionRuntime\.expediteScheduledSOS/);
});

check('SOS push and trusted automatic SMS run independently with bounded fallback', () => {
  assert.match(sosService, /const automaticSmsPromise/);
  assert.match(sosService, /SOSAutomaticSmsService\.sendForSOS\(expectedUserId, event, contacts\)/);
  assert.doesNotMatch(sosService, /notificationsSent === 0[\s\S]{0,200}sendForSOS/);
  assert.match(
    sosService,
    /if \(allowInteractiveFallback && automaticSmsResult\.status !== 'sent'\)/,
  );
  assert.match(sosService, /localDeliveryResult = await sendSosAlert/);
  assert.match(sosAlertService, /LOCAL_FALLBACK_DEADLINE_MS = 12_000/);
  assert.match(sosAlertService, /Linking\.canOpenURL/);
  assert.match(sosAlertService, /SMS_COMPOSER_OPENED/);
  assert.doesNotMatch(sosAlertService, /whatsapp:\/\/|wa\.me|WHATSAPP_/i);
  assert.doesNotMatch(sosAlertService, /Alert\.alert/);
});

check('Automatic trusted SMS requires account consent and Android SEND_SMS permission', () => {
  assert.match(appConfig, /android\.permission\.SEND_SMS/);
  assert.match(sosAutomaticSmsService, /SOSAutomaticSmsStorage\.hasConsent\(userId\)/);
  assert.match(sosAutomaticSmsService, /PermissionsAndroid\.PERMISSIONS\.SEND_SMS/);
  assert.match(sosAutomaticSmsService, /PermissionsAndroid\.request/);
  assert.match(
    sosAutomaticSmsService,
    /SOSAutomaticSmsStorage\.setConsent\(userId, true\)[\s\S]*PermissionsAndroid\.request/,
  );
  assert.match(contactsScreen, /value=\{smsConsent\}/);
  assert.match(sosAutomaticSmsService, /getUniquePhones/);
  assert.match(sosAutomaticSmsService, /SOSAutomaticSmsStorage\.markAttempted/);
  assert.match(sosAutomaticSmsStorage, /'sos-sms-consent'/);
  assert.match(sosAutomaticSmsStorage, /'sos-sms-dispatch'/);
  assert.match(smsNativeModule, /Manifest\.permission\.SEND_SMS/);
  assert.match(smsNativeModule, /sendTextMessage|sendMultipartTextMessage/);
  assert.doesNotMatch(sosAutomaticSmsService, /whatsapp|wa\.me/i);
  const smsLogStatements = (
    sosAutomaticSmsService.match(/console\.(?:log|info|warn)\([\s\S]*?\);/g) ?? []
  ).join('\n');
  assert.doesNotMatch(smsLogStatements, /\bphone\b|latitude|longitude|event\.message/);
});

check('Voice SOS can use only a fresh accurate account-scoped network location fallback', () => {
  assert.match(homeScreen, /startSOSCountdown\('voice', scheduledSOS\?\.expiresAt\)/);
  assert.match(homeScreen, /allowRecentNetworkLocation: sosTriggerSourceRef\.current === 'voice'/);
  assert.match(locationService, /SOS_NETWORK_CACHED_LOCATION_MAX_AGE_MS = 10 \* 60 \* 1_000/);
  assert.match(locationService, /SOS_NETWORK_CACHED_LOCATION_MAX_ACCURACY_METERS = 100/);
  assert.match(locationService, /cachedAgeMs >= 0/);
  assert.match(locationService, /allowRecentNetworkLocationForUserId/);
  assert.match(sosNetworkLocationStorage, /getAccountStorageItem\(userId, NAMESPACE/);
  assert.match(sosNetworkLocationStorage, /value\.latitude! < -90/);
  assert.match(sosNetworkLocationStorage, /value\.longitude! > 180/);
  assert.match(sosNetworkService, /SOSNetworkLocationStorage\.save\(expectedUserId/);
  assert.match(sosNetworkProvider, /SOSNetworkLocationStorage\.clear\(expectedUserId\)/);
});

check('Fresh-user and trusted-contact forms keep keyboard-visible stable scroll containers', () => {
  assert.match(accountAccessPanel, /placeholderTextColor="#7180A3"/);
  assert.match(contactsScreen, /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
  assert.match(contactsScreen, /keyboardDismissMode=\{Platform\.OS === 'ios' \? 'interactive' : 'none'\}/);
  assert.match(contactsScreen, /keyboardShouldPersistTaps="handled"/);
  assert.doesNotMatch(contactsScreen, /key=\{(?:form|linkCode|editingId)/);
});

check('SOS activation supersedes preventive safety timers', () => {
  const startCountdownStart = homeScreen.indexOf(
    'const startSOSCountdown = useCallback(',
  );
  const startCountdownEnd = homeScreen.indexOf('\n\n  useEffect(', startCountdownStart);
  assert.ok(
    startCountdownStart >= 0 && startCountdownEnd > startCountdownStart,
    'SOS countdown callback not found.',
  );
  const startCountdown = homeScreen.slice(startCountdownStart, startCountdownEnd);
  assert.match(startCountdown, /setCheckpointStatus\('idle'\)/);
  assert.match(startCountdown, /goHomeEstimateGenerationRef\.current \+= 1/);
  assert.match(startCountdown, /setGoHomeStatus\('idle'\)/);
});

check('Checkpoint duration selector is custom, bounded and uses the existing lifecycle', () => {
  assert.match(homeScreen, /CHECKPOINT_MAX_HOURS = 12/);
  assert.match(homeScreen, /CHECKPOINT_MAX_DURATION_MINUTES = CHECKPOINT_MAX_HOURS \* 60 \+ 59/);
  assert.match(homeScreen, /hours \* 60 \+ minutes/);
  assert.match(homeScreen, /durationMinutes >= 1/);
  assert.match(homeScreen, /minutes > 59/);
  assert.match(homeScreen, /startCheckpoint\(selectedDuration\)/);
  assert.match(homeScreen, /checkpointStartInFlightRef/);
  assert.match(homeScreen, /Concludi o annulla Torno a casa/);
  assert.doesNotMatch(homeScreen, /CHECKPOINT_OPTIONS_MINUTES/);

  const toDuration = (hours, minutes) => hours * 60 + minutes;
  assert.equal(toDuration(0, 0), 0);
  assert.equal(toDuration(0, 1), 1);
  assert.equal(toDuration(0, 5), 5);
  assert.equal(toDuration(0, 59), 59);
  assert.equal(toDuration(1, 0), 60);
  assert.equal(toDuration(1, 1), 61);
  assert.equal(toDuration(1, 30), 90);
  assert.equal(toDuration(2, 15), 135);
  assert.equal(toDuration(12, 59), 779);
});

check('Checkpoint expiry is absolute, persisted, account-scoped and single-fire', () => {
  assert.match(homeScreen, /const \[checkpointExpiresAt, setCheckpointExpiresAt\]/);
  assert.match(homeScreen, /startedAtMs \+ minutes \* 60_000/);
  assert.match(homeScreen, /CheckpointStorage\.saveActive\(userId/);
  assert.match(homeScreen, /CheckpointStorage\.getActive\(loadUserId\)/);
  assert.match(homeScreen, /CheckpointStorage\.clearActive\(targetUserId\)/);
  assert.match(homeScreen, /Date\.parse\(checkpointExpiresAt\) - Date\.now\(\)/);
  assert.match(homeScreen, /AppState\.addEventListener\('change'/);
  assert.match(homeScreen, /checkpointExpirationHandledRef\.current === expiresAt/);
  assert.match(homeScreen, /checkpointOperationGenerationRef\.current/);
  assert.doesNotMatch(
    homeScreen,
    /setCheckpointRemainingSeconds\(\(current\) => Math\.max\(0, current - 1\)\)/,
  );
  assert.match(checkpointStorage, /'checkpoint-active'/);
  assert.match(checkpointStorage, /startedAt: string/);
  assert.match(checkpointStorage, /expiresAt: string/);
  assert.match(checkpointStorage, /getAccountStorageItem\(\s*userId/);
  assert.match(checkpointStorage, /removeAccountStorageItem\(userId, 'checkpoint-active'\)/);

  const remainingSeconds = (expiresAtMs, nowMs) =>
    Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const fiveMinutes = 5 * 60 * 1000;
  const ninetyMinutes = 90 * 60 * 1000;
  assert.equal(remainingSeconds(fiveMinutes, 0), 300);
  assert.equal(remainingSeconds(ninetyMinutes, 0), 5400);
  assert.equal(remainingSeconds(ninetyMinutes, 10 * 60 * 1000), 4800);
  assert.equal(remainingSeconds(60_000, 30_000), 30);
  assert.equal(remainingSeconds(60_000, 60_001), 0);
});

check('Trusted contact mutations are guarded against duplicate taps', () => {
  assert.match(contactsScreen, /contactActionInFlightRef/);
  assert.match(contactsScreen, /if \(contactActionInFlightRef\.current\)/);
  assert.match(contactsScreen, /linkActionInFlightRef/);
  assert.match(contactsScreen, /if \(linkActionInFlightRef\.current\)/);
  assert.match(contactsScreen, /disabled=\{contactActionPending\}/);
});

check('SOS local dispatch is SMS-only and never invents a country code', () => {
  assert.match(phoneIdentity, /E164_PATTERN = \/\^\\\+\[1-9\]\\d\{6,14\}\$\//);
  assert.match(sosAlertService, /`smsto:\$\{contact\.phone\}/);
  assert.match(sosAlertService, /`sms:\$\{contact\.phone\}/);
  assert.doesNotMatch(sosAlertService, /\+39|defaultCountry|countryCode/);
  assert.doesNotMatch(sosAlertService, /whatsapp|wa\.me/i);
  assert.doesNotMatch(sosAlertService, /Share\.share|shareSosAlert/);
  assert.doesNotMatch(sosService, /shareSosAlert|shareSOS/);
  assert.match(homeScreen, /SOSService\.sendSmsFallback\(activeEvent, contacts\)/);
  assert.doesNotMatch(contactsScreen, /Canale locale preferito|Fallback WhatsApp/);
  assert.match(sosAlertService, /CONTACT_SOURCE_LINKED/);
  assert.match(sosAlertService, /CONTACT_SOURCE_LOCAL/);
});

check('Home exposes the existing SOS network preference without duplicating it', () => {
  assert.match(homeScreen, /useSOSNetworkPresence\(\)/);
  assert.match(homeScreen, /sosNetwork\.setEnabled\(!sosNetwork\.enabled\)/);
  assert.match(homeScreen, /Rete SafeMeLink/);
  assert.match(homeScreen, /sosNetwork\.enabled[\s\S]*'ATTIVA'/);
  assert.doesNotMatch(homeScreen, /useState[^\n]*sos_network_enabled/);
});

check('Home keeps the SOS control single-tap and visually compact', () => {
  assert.match(homeScreen, /onPress=\{\(\) => startSOSCountdown\(\)\}/);
  assert.doesNotMatch(homeScreen, /onLongPress|delayLongPress/);
  assert.match(homeScreen, /sosStage:[\s\S]*height: 188[\s\S]*width: 188/);
  assert.match(homeScreen, /sosButton:[\s\S]*height: 128[\s\S]*width: 128/);
});

check('Emergency profile and trusted contact requests have bounded cancellable operations', () => {
  assert.match(remoteRequest, /REMOTE_REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(remoteRequest, /new AbortController\(\)/);
  assert.match(remoteRequest, /controller\.abort\(\)/);
  assert.match(remoteRequest, /clearTimeout\(timeoutId\)/);
  assert.equal((emergencyRepository.match(/runRemoteRequest\(/g) ?? []).length, 3);
  assert.equal((trustedContactsRepository.match(/runRemoteRequest\(/g) ?? []).length, 4);
  assert.equal((trustedLinksRepository.match(/runRemoteRequest\(/g) ?? []).length, 5);
  assert.match(emergencyHook, /activeUserIdRef\.current === userId/);
  assert.match(contactsScreen, /isFocusedRef\.current/);
  assert.match(contactsScreen, /loadGenerationRef\.current === loadGeneration/);
  assert.match(contactsScreen, /Aggiornamento contatti in corso/);
  assert.match(contactsScreen, />Riprova</);
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
  assert.match(radarScreen, /Una rete anonima e protetta/);
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

check('Go Home expiry is absolute, persisted, account-scoped and single-fire', () => {
  assert.match(homeScreen, /const \[goHomeExpiresAt, setGoHomeExpiresAt\]/);
  assert.match(homeScreen, /startedAtMs \+ estimatedMinutes \* 60_000/);
  assert.match(homeScreen, /GoHomeStorage\.saveActive\(actionUserId, session\)/);
  assert.match(homeScreen, /GoHomeStorage\.getActive\(loadUserId\)/);
  assert.match(homeScreen, /GoHomeStorage\.clearActive\(targetUserId\)/);
  assert.match(homeScreen, /Date\.parse\(goHomeExpiresAt\) - Date\.now\(\)/);
  assert.match(homeScreen, /goHomeExpirationHandledRef\.current === expiresAt/);
  assert.match(homeScreen, /goHomeOperationGenerationRef\.current/);
  assert.match(homeScreen, /previousGoHomeUserId/);
  assert.match(homeScreen, /clearPersistedGoHome\(goHomeOwnerUserIdRef\.current\)/);
  assert.doesNotMatch(
    homeScreen,
    /setGoHomeRemainingSeconds\(\(current\) => Math\.max\(0, current - 1\)\)/,
  );
  assert.match(goHomeStorage, /'go-home-active'/);
  assert.match(goHomeStorage, /startedAt: string/);
  assert.match(goHomeStorage, /expiresAt: string/);
  assert.match(goHomeStorage, /getAccountStorageItem\(\s*userId/);
  assert.match(goHomeStorage, /removeAccountStorageItem\(userId, 'go-home-active'\)/);
  const activeGoHomeType = goHomeStorage.match(
    /export type ActiveGoHomeSession = Omit<GoHomeSession, 'homeLocation' \| 'startLocation'> & \{([\s\S]*?)\n\};/,
  )?.[1];
  assert.ok(activeGoHomeType, 'Active Go Home session type not found.');
  assert.doesNotMatch(activeGoHomeType, /startLocation|homeLocation/);

  const remainingSeconds = (expiresAtMs, nowMs) =>
    Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const fiveMinutes = 5 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  assert.equal(remainingSeconds(fiveMinutes, 0), 300);
  assert.equal(remainingSeconds(oneHour, 0), 3600);
  assert.equal(remainingSeconds(oneHour, 20 * 60 * 1000), 2400);
  assert.equal(remainingSeconds(fiveMinutes, fiveMinutes + 1), 0);
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

check('Android package visibility exposes only SOS SMS fallback channels', () => {
  assert.match(sosChannelQueriesPlugin, /android\.intent\.action\.SENDTO/);
  assert.match(sosChannelQueriesPlugin, /scheme: 'sms'/);
  assert.match(sosChannelQueriesPlugin, /scheme: 'smsto'/);
  assert.doesNotMatch(sosChannelQueriesPlugin, /whatsapp/i);
});

process.stdout.write('All static audit checks passed.\n');
