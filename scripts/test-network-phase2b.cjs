const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260908120000_safemelink_phone_otp.sql');
const repository = read('backend/repositories/NetworkRepository.ts');
const service = read('services/NetworkService.ts');
const models = read('services/NetworkModels.ts');
const edgeFunction = read('supabase/functions/phone-verification/index.ts');
const clientIpHelper = read('supabase/functions/phone-verification/clientIp.ts');
const cryptoHelper = read('supabase/functions/phone-verification/crypto.ts');
const phoneHelper = read('supabase/functions/phone-verification/phone.ts');
const provider = read('supabase/functions/phone-verification/smsProvider.ts');
const cryptoRuntimeTest = read('scripts/test-phone-otp-crypto-runtime.cjs');
const providerRuntimeTest = read('scripts/test-phone-otp-provider-runtime.cjs');
const postgresRuntimeTest = read('scripts/test-phone-otp-postgres-runtime.cjs');
const harnessSafety = read('scripts/phone-otp-harness-safety.cjs');
const harnessSafetyTest = read('scripts/test-phone-otp-harness-safety.cjs');
const verifyFunction = migration.match(
  /create or replace function public\.verify_phone_verification_challenge\([\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

assert.match(migration, /create table public\.phone_verification_challenges/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.phone_verification_challenges[\s\S]*from public, anon, authenticated/);
assert.match(migration, /account_verifications_unique_verified_phone_idx/);
assert.match(migration, /PHONE_VERIFICATION_DUPLICATE_LEGACY_PHONE/);
assert.match(migration, /where phone_verified_at is not null/);
assert.match(migration, /phone_verification_one_pending_per_account_idx/);
assert.match(migration, /'DELIVERY_PENDING'/);
assert.match(migration, /default 'DELIVERY_PENDING'/);
assert.match(migration, /delivery_succeeded then 'PENDING'/);
assert.match(migration, /status in \('DELIVERY_PENDING', 'PENDING'\)/);
assert.match(migration, /for update/);
assert.match(migration, /attempt_count \+ 1 >= max_attempts/);
assert.match(migration, /status = 'CONSUMED'/);
assert.match(migration, /verification_source = 'safemelink_phone_otp'/);
assert.match(migration, /interval '10 minutes'/);
assert.match(migration, /interval '60 seconds'/);
assert.match(migration, /interval '15 minutes'[\s\S]*>= 3/);
assert.match(migration, /interval '1 hour'[\s\S]*>= 5/);
assert.match(migration, /interval '1 day'[\s\S]*>= 10/);
assert.match(migration, /ip_hmac = target_ip_hmac[\s\S]*interval '1 hour'[\s\S]*>= 10/);
assert.match(migration, /phone-otp-ip:' \|\| target_ip_hmac/);
assert.match(migration, /user_id uuid references public\.profiles\(id\) on delete set null/);
assert.match(migration, /delete from public\.phone_verification_rate_events[\s\S]*interval '1 day'/);
assert.match(migration, /grant execute on function public\.create_phone_verification_challenge[\s\S]*to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.(?:create|verify|cancel|mark)_phone_verification[^;]*to authenticated/);
assert.doesNotMatch(migration, /auth\.mfa_factors|supabase_mfa_phone|AAL2/i);

const verifyAccountLockIndex = verifyFunction.indexOf("phone-otp-user:' || target_user_id::text");
const verifyChallengeRowLockIndex = verifyFunction.indexOf('for update;');
const verifyPhoneLockIndex = verifyFunction.indexOf("phone-otp-number:' || challenge.phone_hmac");
const verifyPhoneRateCountIndex = verifyFunction.indexOf('event.phone_hmac = challenge.phone_hmac');
const verifyRateInsertIndex = verifyFunction.indexOf('insert into public.phone_verification_rate_events');
const verifyCandidateIndex = verifyFunction.indexOf('candidate_matches is distinct from true');
assert.ok(verifyAccountLockIndex >= 0, 'VERIFY must lock the account');
assert.ok(verifyChallengeRowLockIndex > verifyAccountLockIndex, 'VERIFY must row-lock the challenge after the account');
assert.ok(verifyPhoneLockIndex > verifyChallengeRowLockIndex, 'VERIFY must lock the phone after loading the challenge');
assert.ok(verifyPhoneRateCountIndex > verifyPhoneLockIndex, 'VERIFY phone count must run after the phone lock');
assert.ok(verifyRateInsertIndex > verifyPhoneRateCountIndex, 'VERIFY event insert must run after the phone count');
assert.ok(verifyCandidateIndex > verifyRateInsertIndex, 'VERIFY decision must run after recording the rate event');
assert.equal(
  verifyFunction.indexOf("phone-otp-number:' || challenge.phone_hmac", verifyPhoneLockIndex + 1),
  -1,
  'VERIFY must have exactly one phone lock',
);

assert.match(edgeFunction, /adminClient\.auth\.getUser\(accessToken\)/);
assert.doesNotMatch(edgeFunction, /body\.userId|body\.user_id/);
for (const action of ['request', 'verify', 'cancel']) {
  assert.match(edgeFunction, new RegExp(`action === '${action}'`));
}
assert.match(edgeFunction, /type Action = 'request' \| 'verify' \| 'status' \| 'cancel'/);
assert.match(edgeFunction, /PHONE_OTP_HMAC_SECRET/);
assert.match(edgeFunction, /PHONE_IDENTITY_HMAC_SECRET/);
assert.match(edgeFunction, /PHONE_OTP_ENCRYPTION_KEY_B64/);
assert.match(edgeFunction, /otpSecret === identitySecret/);
assert.match(edgeFunction, /MAX_BODY_BYTES/);
assert.match(edgeFunction, /content-type/);
assert.match(edgeFunction, /hasExactKeys/);
assert.match(edgeFunction, /DATABASE_TIMEOUT_MS/);
assert.match(edgeFunction, /runDatabaseRequest/);
assert.match(edgeFunction, /delivery_pending/);
assert.match(edgeFunction, /provider_not_configured/);
assert.match(edgeFunction, /PHONE_OTP_TRUSTED_IP_HEADER/);
assert.match(edgeFunction, /IP limiting is supplementary/);
assert.doesNotMatch(edgeFunction, /console\.[a-z]+\([^\n]*\{[^\n]*(phone|otp|code|token|ciphertext|hmac)\s*:/i);
assert.doesNotMatch(edgeFunction, /console\.[a-z]+\([^\n]*\$\{[^}]*(phone|otp|code|token|ciphertext|hmac)/i);

assert.match(cryptoHelper, /crypto\.getRandomValues/);
assert.match(cryptoHelper, /HMAC/);
assert.match(cryptoHelper, /SHA-256/);
assert.match(cryptoHelper, /AES-GCM/);
assert.match(cryptoHelper, /additionalData: phoneEncryptionAad/);
assert.match(cryptoHelper, /challengeId[\s\S]*userId[\s\S]*phoneHmac/);
assert.match(cryptoHelper, /constantTimeEqual/);
assert.doesNotMatch(cryptoHelper, /Math\.random/);
assert.match(provider, /AbortController/);
assert.match(provider, /clearTimeout\(timeoutId\)/);
assert.match(provider, /MAX_PROVIDER_RESPONSE_BYTES/);
assert.match(provider, /readBoundedResponse/);
assert.match(provider, /reader\.cancel\(\)/);
assert.match(provider, /PHONE_OTP_PROVIDER_URL/);
assert.match(provider, /PHONE_OTP_PROVIDER_TOKEN/);
assert.match(provider, /PHONE_OTP_PROVIDER_ALLOWED_HOST/);
assert.match(provider, /PHONE_OTP_PROVIDER_ACCEPTED_STATUS/);
assert.match(provider, /PHONE_OTP_PROVIDER_ACCEPTANCE_FIELD/);
assert.match(provider, /endpoint\.protocol !== 'https:'/);
assert.match(provider, /endpoint\.username \|\| endpoint\.password/);
assert.match(provider, /redirect: 'error'/);
assert.match(provider, /response\.status !== config\.acceptedStatus/);
assert.match(clientIpHelper, /if \(!header \|\| !TRUSTED_IP_HEADERS\.has\(header\)\) return null/);
assert.doesNotMatch(provider, /https:\/\/(?:api\.)?(?:twilio|vonage|messagebird|sinch)/i);
assert.match(phoneHelper, /E164_PATTERN/);
assert.match(phoneHelper, /normalizeE164Phone/);
assert.match(cryptoRuntimeTest, /assert\.rejects/);
assert.match(cryptoRuntimeTest, /changedChallenge[\s\S]*changedUser[\s\S]*changedPhoneHmac/);
assert.doesNotMatch(edgeFunction, /code: 'phone_unavailable'/);
assert.match(providerRuntimeTest, /http:\/\/sms\.provider\.example/);
assert.match(providerRuntimeTest, /user:password@/);
assert.match(providerRuntimeTest, /redirectMode, 'error'/);
assert.match(providerRuntimeTest, /status: 'unknown'/);
assert.match(providerRuntimeTest, /status: 'accepted'/);
assert.match(providerRuntimeTest, /repeat\(4_097\)/);
assert.match(providerRuntimeTest, /expectCategory\('timeout'\)/);
assert.match(postgresRuntimeTest, /PHONE_OTP_RUNTIME_TEST_ACK/);
assert.match(postgresRuntimeTest, /PHONE_OTP_RUNTIME_DRY_RUN/);
assert.match(postgresRuntimeTest, /runPostgrest/);
assert.match(postgresRuntimeTest, /AbortController/);
assert.match(postgresRuntimeTest, /sanitizeError/);
assert.match(postgresRuntimeTest, /ownVerificationBeforeMutation/);
assert.match(postgresRuntimeTest, /matchesOwnedVerification/);
assert.match(postgresRuntimeTest, /validateChallengeMutationResponse/);
assert.doesNotMatch(postgresRuntimeTest, /createdChallengeIds\.add\(row\.challenge_id\)/);
assert.match(postgresRuntimeTest, /removeOwnedChallenges\(concurrentRequestArgs/);
assert.match(postgresRuntimeTest, /removeOwnedChallenges\(sharedRequestArgs/);
assert.match(harnessSafetyTest, /HarnessTimeoutError/);
assert.match(harnessSafetyTest, /SERVICE_ROLE_SENTINEL_DO_NOT_PRINT/);
assert.match(harnessSafetyTest, /ChallengeLifecycleGuard/);
assert.match(harnessSafetyTest, /foreign-challenge/);
assert.match(harnessSafetyTest, /missing or ambiguous/);
assert.match(postgresRuntimeTest, /isDisposableAccount/);
assert.match(postgresRuntimeTest, /getUserById/);
assert.match(postgresRuntimeTest, /requireEmpty\('account_verifications'/);
assert.match(postgresRuntimeTest, /requireEmpty\('phone_verification_challenges'/);
assert.match(postgresRuntimeTest, /requireEmpty\('phone_verification_rate_events'/);
assert.match(postgresRuntimeTest, /get_my_network_onboarding_status/);
assert.match(postgresRuntimeTest, /checkAuthenticatedRpcDenials/);
assert.match(postgresRuntimeTest, /schema\.paths\?\.\[`\/rpc\/\$\{name\}`\]/);
assert.doesNotMatch(postgresRuntimeTest, /network_user_is_eligible/);
assert.doesNotMatch(postgresRuntimeTest, /originalVerifications|testStartedAt/);
assert.doesNotMatch(postgresRuntimeTest, /phone_verification_rate_events'\)\.delete/);
for (const internalRpc of [
  'create_phone_verification_challenge',
  'mark_phone_verification_delivery',
  'verify_phone_verification_challenge',
  'cancel_phone_verification_challenge',
  'cleanup_phone_verification_data',
]) assert.match(postgresRuntimeTest, new RegExp(`'${internalRpc}'`));
assert.match(harnessSafety, /new URL\(rawUrl\)/);
assert.match(harnessSafety, /REPOSITORY_DEVELOPMENT_PROJECT_REF = null/);
assert.match(harnessSafety, /safemelink_test_purpose/);
assert.match(harnessSafetyTest, /development/);
assert.match(harnessSafetyTest, /pre-existing/);
assert.match(harnessSafetyTest, /mutationCount, 0/);
assert.match(harnessSafetyTest, /Cleanup failed/);
assert.match(postgresRuntimeTest, /concurrentRequests/);
assert.match(postgresRuntimeTest, /sharedPhoneRequests/);
assert.match(postgresRuntimeTest, /concurrentVerify/);
assert.match(postgresRuntimeTest, /duplicateResults/);
assert.match(postgresRuntimeTest, /DELIVERY_PENDING/);
assert.doesNotMatch(repository, /NetworkPhoneVerificationError\('phone_unavailable'/);

assert.match(repository, /functions\.invoke<PhoneFunctionResponse>\('phone-verification'/);
assert.match(repository, /canonicalizeInternationalPhone/);
assert.match(repository, /requireChallengeOwner/);
assert.match(repository, /getPhoneVerificationStatus/);
assert.match(repository, /Promise\.race/);
assert.doesNotMatch(repository, /auth\.mfa\.|signInWithOtp|updateUser\(\{\s*phone/);
assert.doesNotMatch(repository, /phone_verified_at|account_verifications/);
assert.match(service, /recoverPhoneVerification/);
assert.doesNotMatch(models, /factorId|phoneE164|emailAddress|latitude|longitude/);

console.log('SafeMeLink dedicated phone OTP security contract checks passed.');
