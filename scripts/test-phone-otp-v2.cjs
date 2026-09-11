const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260910120000_phone_otp_operation_v2.sql');
const edge = read('supabase/functions/phone-verification/index.ts');
const repository = read('backend/repositories/NetworkRepository.ts');
const storage = read('storage/NetworkPhoneVerificationStorage.ts');
const harness = read('scripts/test-phone-otp-v2-postgres-runtime.cjs');
const functionBody = (name, nextName) => migration.slice(
  migration.indexOf(`function public.${name}`),
  nextName ? migration.indexOf(`function public.${nextName}`) : migration.length,
);

for (const required of [
  'phone_verification_operations', 'phone_verification_attempts',
  'verification_operation_id', 'create_phone_verification_challenge_v2',
  'mark_phone_verification_delivery_v2', 'verify_phone_verification_challenge_v2',
  'cancel_phone_verification_operation_v2',
  'finalize_phone_verification_test_operation_v2',
  'get_phone_verification_operation_status_v2',
]) assert.match(migration, new RegExp(required));

assert.match(migration, /primary key \(operation_id, attempt_id\)/);
assert.match(migration, /on delete restrict/);
assert.match(migration, /account_verifications_operation_owner_fk/);
assert.match(migration, /enable row level security/g);
assert.doesNotMatch(migration, /grant execute[\s\S]{0,200}to authenticated/i);
assert.match(migration, /grant execute[\s\S]{0,200}to service_role/gi);
assert.match(migration, /raw_app_meta_data[\s\S]*safemelink_disposable/);
assert.match(migration, /safemelink_test_purpose[\s\S]*phone_otp_runtime_disposable/);
assert.doesNotMatch(migration.match(/finalize_phone_verification_test_operation_v2[\s\S]*?end; \$\$/)?.[0] ?? '', /phone_verification_rate_events/);
assert.match(migration, /candidate_fingerprint <> target_candidate_fingerprint/);
assert.match(migration, /challenge\.otp_digest <> target_candidate_fingerprint/);
assert.doesNotMatch(migration, /candidate_matches/);
assert.match(migration, /status = 'CANCELLED'/);
assert.match(migration, /verification_operation_id = target_operation_id/);
assert.match(migration, /delivery_lease_expires_at = now_at \+ interval '2 minutes'/);
assert.match(migration, /PHONE_VERIFICATION_DELIVERY_STALE/);
assert.match(migration, /challenge\.status <> 'PENDING'/);
assert.match(migration, /result_code = 'superseded'/);
assert.match(migration, /order by previous\.id for update/);
assert.match(migration, /where id = target_operation_id and user_id = target_user_id for update/);
assert.match(migration, /challenge\.status <> 'DELIVERY_PENDING'/);
assert.match(migration, /challenge\.expires_at <= now_at/);
assert.match(migration, /challenge\.otp_ciphertext is null or challenge\.otp_nonce is null/);
assert.match(migration, /result_code = 'challenge_missing'/);
assert.match(migration, /PHONE_VERIFICATION_DELIVERY_CHALLENGE_CONFLICT/);
assert.match(migration, /get diagnostics affected = row_count;[\s\S]{0,100}affected <> 1/);
for (const terminalCategory of ['superseded', 'cancelled']) {
  assert.match(migration, new RegExp(`last_error_category = '${terminalCategory}'[\\s\\S]{0,100}otp_ciphertext = null, otp_nonce = null`));
}
assert.match(migration, /status = 'CONSUMED'[\s\S]{0,120}otp_ciphertext = null, otp_nonce = null/);
assert.match(migration, /last_error_category = outcome, otp_ciphertext = null, otp_nonce = null/);
for (const [name, next] of [
  ['create_phone_verification_challenge_v2', 'mark_phone_verification_delivery_v2'],
  ['mark_phone_verification_delivery_v2', 'verify_phone_verification_challenge_v2'],
  ['verify_phone_verification_challenge_v2', 'cancel_phone_verification_operation_v2'],
  ['cancel_phone_verification_operation_v2', 'finalize_phone_verification_test_operation_v2'],
  ['finalize_phone_verification_test_operation_v2', 'get_phone_verification_operation_status_v2'],
]) {
  const body = functionBody(name, next);
  assert.ok(body.indexOf('phone-otp-user:') < body.indexOf('for update'),
    `${name} must acquire the account lock before its operation row lock`);
}

assert.match(edge, /auth\.getUser\(accessToken\)/);
assert.match(edge, /create_phone_verification_challenge_v2/);
assert.match(edge, /verify_phone_verification_challenge_v2/);
assert.match(edge, /target_candidate_fingerprint: candidateDigest/);
assert.match(edge, /decryptOtpForDelivery/);
assert.match(edge, /target_delivery_attempt_id: deliveryAttemptId/);
assert.match(edge, /create_phone_verification_challenge'/); // V1 coexistence
assert.match(repository, /operationId/);
assert.match(repository, /attemptId/);
assert.match(repository, /NetworkPhoneVerificationStorage/);
assert.doesNotMatch(storage, /phoneE164|phone_hmac|otpDigest|ciphertext|nonce|\bcode\s*:/i);
assert.match(harness, /REPOSITORY_DEVELOPMENT_PROJECT_REF, null/);
assert.match(harness, /PHONE_OTP_RUNTIME_TEST_ACK/);
assert.match(harness, /isDisposableAccount/);
assert.match(harness, /get_phone_verification_operation_status_v2/);
assert.match(harness, /finalize_phone_verification_test_operation_v2/);
assert.match(harness, /operation_status === 'CANCELLED'/);
assert.match(harness, /cleanup_completed === true/);
assert.match(harness, /PHONE_VERIFICATION_DELIVERY_STALE|stale delivery lease/i);
assert.match(harness, /assertOtpCleared\(operationA, 'Superseded operation'\)/);
assert.match(harness, /assertOtpCleared\(operationB, 'Completed operation'\)/);
assert.match(harness, /assertOtpCleared\(operationC, 'Cancelled operation'\)/);
assert.match(harness, /assertOtpCleared\(operationD, 'Delivery-failed operation'\)/);
assert.match(harness, /Delivery advanced an operation without updating its challenge/);
assert.match(harness, /result_code, 'challenge_missing'/);
assert.match(harness, /assertOtpCleared\(operationF, 'Expired takeover'\)/);
assert.match(harness, /assertOtpCleared\(operationG, 'Invalidated takeover'\)/);
assert.match(harness, /result_code, 'challenge_invalid'/);
assert.match(harness, /assertOtpCleared\(operationI, 'Expired verification'\)/);
assert.match(harness, /assertOtpCleared\(operationJ, 'Locked verification'\)/);
assert.match(harness, /Finalizer removed Phone OTP rate events/);
assert.match(harness, /Finalizer accepted a non-disposable identity/);
assert.match(harness, /Authenticated direct V2 RPC unexpectedly succeeded/);
assert.doesNotMatch(harness, /delete\(\)[\s\S]{0,100}phone_verification_rate_events/);

console.log('SafeMeLink Phone OTP V2 static contract checks passed.');
