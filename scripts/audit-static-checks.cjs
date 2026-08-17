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
const radarRepository = read('backend/repositories/RadarRepository.ts');
const radarProvider = read('components/RadarProvider.tsx');
const radarPresenceMigration = read(
  'supabase/migrations/20260722130000_radar_presence.sql',
);
const radarMigration = read(
  'supabase/migrations/20260722140000_radar_preferences_and_nickname.sql',
);
const emergencyService = read('services/EmergencyProfileService.ts');
const emergencyRepository = read(
  'backend/repositories/EmergencyProfileRepository.ts',
);
const emergencyHook = read('hooks/useEmergencyProfile.ts');
const emergencyScreen = read('screens/EmergencyProfileScreen.tsx');
const emergencyMigration = read(
  'supabase/migrations/20260723120000_emergency_profile.sql',
);
const backendErrors = read('backend/errors/BackendError.ts');
const databaseTypes = read('backend/database.types.ts');
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
const locationService = read('services/LocationService.ts');
const sosService = read('services/SOSService.ts');
const sosAlertService = read('services/SOSAlertService.ts');
const trustedLinksService = read('services/TrustedLinksService.ts');
const sosChannelQueriesPlugin = read('plugins/withSOSChannelQueries.cjs');

check('Radar client uses 1 km and 25 results', () => {
  assert.match(radarService, /RADAR_SEARCH_RADIUS_METERS = 1_000/);
  assert.match(radarService, /RADAR_RESULT_LIMIT = 25/);
});

check('Radar missing preferences are initialized with safe OFF defaults', () => {
  assert.match(radarRepository, /\.rpc\('get_my_radar_preferences'\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(radarService, /DEFAULT_RADAR_PREFERENCES = \{[\s\S]*radarEnabled: false/);
  assert.match(radarService, /visibleToNearby: true/);
  assert.match(radarService, /showNickname: false/);
  assert.match(
    radarService,
    /if \(storedPreferences\)[\s\S]*RadarRepository\.updatePreferences\(DEFAULT_RADAR_PREFERENCES\)/,
  );
  assert.match(
    radarMigration,
    /insert into public\.radar_preferences \(user_id\)[\s\S]*on conflict \(user_id\) do nothing/,
  );
});

check('Radar OFF performs no location publication or nearby search', () => {
  assert.match(radarService, /preferences\?\.radarEnabled && preferences\.visibleToNearby/);
  assert.match(
    radarProvider,
    /const canRunRadar = Boolean\([\s\S]*isRadarScreenActive/,
  );
  assert.match(
    radarProvider,
    /!canRunRadar[\s\S]*activeUserIdRef\.current !== userId/,
  );
  assert.match(
    radarProvider,
    /!participationEnabled[\s\S]*preferencesUserId === userId[\s\S]*deactivate\(\)/,
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

check('Radar has no automatic polling, retry, or recurring timer', () => {
  assert.doesNotMatch(radarProvider, /setInterval\(|setTimeout\(/);
  assert.doesNotMatch(radarProvider, /scheduleNetworkRefresh|runSingleLocationFallback/);
  assert.doesNotMatch(radarService, /RADAR_REFRESH_INTERVAL_MS|RADAR_LOCATION_FALLBACK_INTERVAL_MS/);
  assert.match(radarProvider, /manualRefreshRef\.current = \(\) =>/);
  assert.match(radarProvider, /attemptInFlight/);
  assert.doesNotMatch(
    radarProvider,
    /appState = nextState;[\s\S]{0,120}attemptInFlight = false/,
  );
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
  assert.doesNotMatch(cleanup, /deactivate\(\)/);
  assert.match(
    radarProvider,
    /preferences[\s\S]*!participationEnabled[\s\S]*deactivate\(\)/,
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
  assert.match(sosAlertService, /\^\\\+\[1-9\]\\d\{6,14\}\$/);
  assert.match(
    sosAlertService,
    /return \[\s*`whatsapp:\/\/send[\s\S]*`https:\/\/wa\.me/,
  );
  assert.doesNotMatch(sosAlertService, /\+39|defaultCountry|countryCode/);
  assert.match(sosAlertService, /excludeAmbiguousLegacyContacts/);
  assert.match(sosAlertService, /linked_contact_without_verified_phone/);
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

check('Trusted contacts migrate phone fallbacks but links require accepted requests', () => {
  assert.match(trustedLinksService, /initialMerge\.localOnlyContacts/);
  assert.match(trustedLinksService, /linked_profile_id: null/);
  assert.match(trustedLinksService, /trusted_contacts confermati/);
  assert.match(
    trustedLinksHardeningMigration,
    /linked_profile_id is null/,
  );
  assert.match(
    trustedLinksHardeningMigration,
    /prevent_direct_trusted_link_change/,
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
