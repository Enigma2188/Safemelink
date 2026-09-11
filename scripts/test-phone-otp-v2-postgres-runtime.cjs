const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const {
  isDisposableAccount,
  parseHarnessTarget,
  REPOSITORY_DEVELOPMENT_PROJECT_REF,
  runAfterPreflight,
  sanitizeError,
  withTimeout,
} = require('./phone-otp-harness-safety.cjs');

const ACKNOWLEDGEMENT = 'DEVELOPMENT_ONLY';
const DRY_RUN = process.env.PHONE_OTP_RUNTIME_DRY_RUN === '1';
const required = (value, name) => {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

if (process.env.PHONE_OTP_RUNTIME_TEST_ACK !== ACKNOWLEDGEMENT) {
  throw new Error(`Refusing to run without PHONE_OTP_RUNTIME_TEST_ACK=${ACKNOWLEDGEMENT}.`);
}
assert.equal(REPOSITORY_DEVELOPMENT_PROJECT_REF, null,
  'Remote runtime remains fail-closed until a Development project ref is reviewed.');

const target = parseHarnessTarget(required(process.env.PHONE_OTP_TEST_SUPABASE_URL,
  'PHONE_OTP_TEST_SUPABASE_URL'));
const serviceRoleKey = required(process.env.PHONE_OTP_TEST_SERVICE_ROLE_KEY,
  'PHONE_OTP_TEST_SERVICE_ROLE_KEY');
const anonKey = required(process.env.PHONE_OTP_TEST_ANON_KEY, 'PHONE_OTP_TEST_ANON_KEY');
const userToken = required(process.env.PHONE_OTP_TEST_USER_A_TOKEN,
  'PHONE_OTP_TEST_USER_A_TOKEN');
const admin = createClient(target.origin, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const userClient = createClient(target.origin, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { authorization: `Bearer ${userToken}` } },
});
const operationIds = new Set();

const rpc = (name, args) => withTimeout(`RPC ${name}`, () => admin.rpc(name, args));
const status = (userId, operationId, attemptId = null) => rpc('get_phone_verification_operation_status_v2', {
  target_user_id: userId, target_operation_id: operationId, target_attempt_id: attemptId,
});
const assertOtpCleared = async (operationId, label) => {
  const observed = await admin.from('phone_verification_challenges')
    .select('otp_ciphertext,otp_nonce').eq('id', operationId).maybeSingle();
  assert.ifError(observed.error);
  assert.equal(observed.data?.otp_ciphertext ?? null, null, `${label} retained OTP ciphertext.`);
  assert.equal(observed.data?.otp_nonce ?? null, null, `${label} retained OTP nonce.`);
};
const ageRequestEvents = async (userId) => {
  const aged = await admin.from('phone_verification_rate_events')
    .update({ created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString() })
    .eq('user_id', userId).eq('action', 'REQUEST');
  assert.ifError(aged.error);
};
const expireLease = async (operationId) => {
  const aged = await admin.from('phone_verification_operations')
    .update({ delivery_lease_expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('id', operationId);
  assert.ifError(aged.error);
};

const preflight = async () => {
  const auth = await withTimeout('authenticated user lookup', () => admin.auth.getUser(userToken));
  assert.ifError(auth.error);
  assert.ok(auth.data.user);
  const authoritative = await withTimeout('authoritative user lookup', () =>
    admin.auth.admin.getUserById(auth.data.user.id));
  assert.ifError(authoritative.error);
  assert.equal(isDisposableAccount(authoritative.data.user), true,
    'Runtime account is not authoritatively disposable.');
  const initialOperationId = crypto.randomUUID();
  const initial = await status(auth.data.user.id, initialOperationId);
  assert.ifError(initial.error);
  assert.equal(initial.data?.[0]?.operation_status, 'NOT_STARTED');
  const directTable = await userClient.from('phone_verification_operations').select('id').limit(1);
  assert.ok(directTable.error, 'Authenticated direct operation table access unexpectedly succeeded.');
  const directRpc = await userClient.rpc('get_phone_verification_operation_status_v2', {
    target_user_id: auth.data.user.id,
    target_operation_id: initialOperationId,
    target_attempt_id: null,
  });
  assert.ok(directRpc.error, 'Authenticated direct V2 RPC unexpectedly succeeded.');
  const nonDisposable = await rpc('finalize_phone_verification_test_operation_v2', {
    target_user_id: crypto.randomUUID(), target_operation_id: crypto.randomUUID(),
  });
  assert.ok(nonDisposable.error, 'Finalizer accepted a non-disposable identity.');
  return auth.data.user.id;
};

const reconcileCleanup = async (userId, operationId) => {
  const finalized = await rpc('finalize_phone_verification_test_operation_v2', {
    target_user_id: userId, target_operation_id: operationId,
  });
  assert.ifError(finalized.error);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = await status(userId, operationId);
    assert.ifError(observed.error);
    const row = observed.data?.[0];
    if (row?.operation_status === 'CANCELLED' && row.cleanup_completed === true) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('V2 cleanup reconciliation did not reach its terminal tombstone.');
};

const createOperation = async (userId, operationId, phoneHmac, digest) => {
  operationIds.add(operationId);
  const args = {
    target_user_id: userId,
    target_operation_id: operationId, target_phone_hmac: phoneHmac,
    target_phone_ciphertext: 'c'.repeat(16),
    target_phone_nonce: 'n'.repeat(12),
    target_otp_digest: digest, target_otp_ciphertext: 'o'.repeat(16),
    target_otp_nonce: 'q'.repeat(12),
    target_ip_hmac: null,
  };
  const created = await rpc('create_phone_verification_challenge_v2', args);
  assert.ifError(created.error);
  assert.equal(created.data?.[0]?.should_send, true);
  return { args, row: created.data[0] };
};

const exerciseV2 = async (userId) => {
  const operationA = crypto.randomUUID();
  const operationB = crypto.randomUUID();
  const phoneHmac = 'h'.repeat(43);
  const digestA = 'a'.repeat(43);
  const digestB = 'b'.repeat(43);
  const createdA = await createOperation(userId, operationA, phoneHmac, digestA);
  const replay = await rpc('create_phone_verification_challenge_v2', createdA.args);
  assert.ifError(replay.error);
  assert.equal(replay.data?.[0]?.should_send, false);
  const deliveredA = await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationA,
    target_delivery_attempt_id: createdA.row.delivery_attempt_id,
    delivery_succeeded: true, target_provider_reference_hash: null, target_error_category: null,
  });
  assert.ifError(deliveredA.error);
  const agedChallenge = await admin.from('phone_verification_challenges')
    .update({ created_at: new Date(Date.now() - 61_000).toISOString() }).eq('id', operationA);
  assert.ifError(agedChallenge.error);
  const createdB = await createOperation(userId, operationB, phoneHmac, digestB);
  const superseded = await status(userId, operationA);
  assert.equal(superseded.data?.[0]?.operation_status, 'FAILED');
  assert.equal(superseded.data?.[0]?.result_code, 'superseded');
  await assertOtpCleared(operationA, 'Superseded operation');
  const lateAttempt = crypto.randomUUID();
  const lateVerify = await rpc('verify_phone_verification_challenge_v2', {
    target_user_id: userId, target_operation_id: operationA, target_attempt_id: lateAttempt,
    target_candidate_fingerprint: digestA, target_phone_hmac: phoneHmac,
    target_phone_e164: '+999123456789012',
  });
  assert.ifError(lateVerify.error);
  assert.notEqual(lateVerify.data?.[0]?.result_code, 'verified');

  const oldLease = createdB.row.delivery_attempt_id;
  const expiredLease = await admin.from('phone_verification_operations')
    .update({ delivery_lease_expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('id', operationB);
  assert.ifError(expiredLease.error);
  const takeover = await rpc('create_phone_verification_challenge_v2', createdB.args);
  assert.ifError(takeover.error);
  assert.equal(takeover.data?.[0]?.should_send, true);
  assert.notEqual(takeover.data?.[0]?.delivery_attempt_id, oldLease);
  const staleDelivery = await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationB,
    target_delivery_attempt_id: oldLease, delivery_succeeded: true,
    target_provider_reference_hash: null, target_error_category: null,
  });
  assert.ok(staleDelivery.error, 'A stale delivery lease unexpectedly completed.');
  const deliveredB = await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationB,
    target_delivery_attempt_id: takeover.data[0].delivery_attempt_id,
    delivery_succeeded: true, target_provider_reference_hash: null, target_error_category: null,
  });
  assert.ifError(deliveredB.error);
  const attemptB = crypto.randomUUID();
  const verifiedB = await rpc('verify_phone_verification_challenge_v2', {
    target_user_id: userId, target_operation_id: operationB, target_attempt_id: attemptB,
    target_candidate_fingerprint: digestB, target_phone_hmac: phoneHmac,
    target_phone_e164: '+999123456789012',
  });
  assert.ifError(verifiedB.error);
  assert.equal(verifiedB.data?.[0]?.result_code, 'verified');
  await assertOtpCleared(operationB, 'Completed operation');
  const verifyReplay = await rpc('verify_phone_verification_challenge_v2', {
    target_user_id: userId, target_operation_id: operationB, target_attempt_id: attemptB,
    target_candidate_fingerprint: digestB, target_phone_hmac: phoneHmac,
    target_phone_e164: '+999123456789012',
  });
  assert.equal(verifyReplay.data?.[0]?.result_code, 'verified');
  const collision = await rpc('verify_phone_verification_challenge_v2', {
    target_user_id: userId, target_operation_id: operationB, target_attempt_id: attemptB,
    target_candidate_fingerprint: 'z'.repeat(43), target_phone_hmac: phoneHmac,
    target_phone_e164: '+999123456789012',
  });
  assert.ok(collision.error, 'Attempt fingerprint collision unexpectedly succeeded.');
  await reconcileCleanup(userId, operationA);
  const ownershipAfterA = await admin.from('account_verifications')
    .select('verification_operation_id').eq('user_id', userId).maybeSingle();
  assert.equal(ownershipAfterA.data?.verification_operation_id, operationB,
    'Finalizer A removed or replaced verification B.');
  await reconcileCleanup(userId, operationB);

  await ageRequestEvents(userId);
  const operationC = crypto.randomUUID();
  const createdC = await createOperation(userId, operationC, 'c'.repeat(43), 'd'.repeat(43));
  const cancelled = await rpc('cancel_phone_verification_operation_v2', {
    target_user_id: userId, target_operation_id: operationC,
  });
  assert.ifError(cancelled.error);
  await assertOtpCleared(operationC, 'Cancelled operation');
  const lateDelivery = await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationC,
    target_delivery_attempt_id: createdC.row.delivery_attempt_id,
    delivery_succeeded: true, target_provider_reference_hash: null, target_error_category: null,
  });
  assert.ok(lateDelivery.error, 'Cancelled operation accepted a late delivery.');
  await reconcileCleanup(userId, operationC);

  await ageRequestEvents(userId);
  const operationD = crypto.randomUUID();
  const createdD = await createOperation(userId, operationD, 'e'.repeat(43), 'f'.repeat(43));
  const failedDelivery = await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationD,
    target_delivery_attempt_id: createdD.row.delivery_attempt_id,
    delivery_succeeded: false, target_provider_reference_hash: null,
    target_error_category: 'provider',
  });
  assert.ifError(failedDelivery.error);
  await assertOtpCleared(operationD, 'Delivery-failed operation');
  await reconcileCleanup(userId, operationD);

  await ageRequestEvents(userId);
  const operationE = crypto.randomUUID();
  const createdE = await createOperation(userId, operationE, 'g'.repeat(43), 'i'.repeat(43));
  const missingChallenge = await admin.from('phone_verification_challenges').delete().eq('id', operationE);
  assert.ifError(missingChallenge.error);
  const missingDelivery = await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationE,
    target_delivery_attempt_id: createdE.row.delivery_attempt_id,
    delivery_succeeded: true, target_provider_reference_hash: null, target_error_category: null,
  });
  assert.ok(missingDelivery.error, 'Delivery advanced an operation without updating its challenge.');
  assert.equal((await status(userId, operationE)).data?.[0]?.operation_status, 'DELIVERY_PENDING');
  await expireLease(operationE);
  const missingTakeover = await rpc('create_phone_verification_challenge_v2', createdE.args);
  assert.ifError(missingTakeover.error);
  assert.equal(missingTakeover.data?.[0]?.should_send, false);
  assert.equal(missingTakeover.data?.[0]?.result_code, 'challenge_missing');
  await reconcileCleanup(userId, operationE);

  await ageRequestEvents(userId);
  const operationF = crypto.randomUUID();
  const createdF = await createOperation(userId, operationF, 'j'.repeat(43), 'k'.repeat(43));
  const expiredChallenge = await admin.from('phone_verification_challenges').update({
    created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    resend_available_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq('id', operationF);
  assert.ifError(expiredChallenge.error);
  await expireLease(operationF);
  const expiredTakeover = await rpc('create_phone_verification_challenge_v2', createdF.args);
  assert.ifError(expiredTakeover.error);
  assert.equal(expiredTakeover.data?.[0]?.should_send, false);
  assert.equal(expiredTakeover.data?.[0]?.result_code, 'expired');
  await assertOtpCleared(operationF, 'Expired takeover');
  await reconcileCleanup(userId, operationF);

  await ageRequestEvents(userId);
  const operationG = crypto.randomUUID();
  const createdG = await createOperation(userId, operationG, 'l'.repeat(43), 'm'.repeat(43));
  const invalidatedChallenge = await admin.from('phone_verification_challenges').update({
    status: 'INVALIDATED', invalidated_at: new Date().toISOString(), last_error_category: 'test',
  }).eq('id', operationG);
  assert.ifError(invalidatedChallenge.error);
  await expireLease(operationG);
  const invalidatedTakeover = await rpc('create_phone_verification_challenge_v2', createdG.args);
  assert.ifError(invalidatedTakeover.error);
  assert.equal(invalidatedTakeover.data?.[0]?.should_send, false);
  await assertOtpCleared(operationG, 'Invalidated takeover');
  await reconcileCleanup(userId, operationG);

  await ageRequestEvents(userId);
  const operationH = crypto.randomUUID();
  const createdH = await createOperation(userId, operationH, 'p'.repeat(43), 'r'.repeat(43));
  const missingSecret = await admin.from('phone_verification_challenges')
    .update({ otp_ciphertext: null, otp_nonce: null }).eq('id', operationH);
  assert.ifError(missingSecret.error);
  await expireLease(operationH);
  const secretlessTakeover = await rpc('create_phone_verification_challenge_v2', createdH.args);
  assert.ifError(secretlessTakeover.error);
  assert.equal(secretlessTakeover.data?.[0]?.should_send, false);
  assert.equal(secretlessTakeover.data?.[0]?.result_code, 'challenge_invalid');
  await reconcileCleanup(userId, operationH);

  await ageRequestEvents(userId);
  const operationI = crypto.randomUUID();
  const createdI = await createOperation(userId, operationI, 's'.repeat(43), 't'.repeat(43));
  assert.ifError((await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationI,
    target_delivery_attempt_id: createdI.row.delivery_attempt_id,
    delivery_succeeded: true, target_provider_reference_hash: null, target_error_category: null,
  })).error);
  assert.ifError((await admin.from('phone_verification_challenges').update({
    created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    resend_available_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq('id', operationI)).error);
  const expiredVerify = await rpc('verify_phone_verification_challenge_v2', {
    target_user_id: userId, target_operation_id: operationI, target_attempt_id: crypto.randomUUID(),
    target_candidate_fingerprint: 't'.repeat(43), target_phone_hmac: 's'.repeat(43),
    target_phone_e164: '+999123456789012',
  });
  assert.equal(expiredVerify.data?.[0]?.result_code, 'expired');
  await assertOtpCleared(operationI, 'Expired verification');
  await reconcileCleanup(userId, operationI);

  await ageRequestEvents(userId);
  const operationJ = crypto.randomUUID();
  const createdJ = await createOperation(userId, operationJ, 'u'.repeat(43), 'v'.repeat(43));
  assert.ifError((await rpc('mark_phone_verification_delivery_v2', {
    target_user_id: userId, target_operation_id: operationJ,
    target_delivery_attempt_id: createdJ.row.delivery_attempt_id,
    delivery_succeeded: true, target_provider_reference_hash: null, target_error_category: null,
  })).error);
  let lockedVerify;
  for (let index = 0; index < 5; index += 1) {
    lockedVerify = await rpc('verify_phone_verification_challenge_v2', {
      target_user_id: userId, target_operation_id: operationJ, target_attempt_id: crypto.randomUUID(),
      target_candidate_fingerprint: `${index}`.repeat(43), target_phone_hmac: 'u'.repeat(43),
      target_phone_e164: '+999123456789012',
    });
    assert.ifError(lockedVerify.error);
  }
  assert.equal(lockedVerify.data?.[0]?.result_code, 'locked');
  await assertOtpCleared(operationJ, 'Locked verification');
  const rateEventsBeforeCleanup = await admin.from('phone_verification_rate_events')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  assert.ifError(rateEventsBeforeCleanup.error);
  await reconcileCleanup(userId, operationJ);
  const rateEventsAfterCleanup = await admin.from('phone_verification_rate_events')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  assert.equal(rateEventsAfterCleanup.count, rateEventsBeforeCleanup.count,
    'Finalizer removed Phone OTP rate events.');
};

const main = async () => {
  const userId = await preflight();
  let mutated = false;
  const outcome = await runAfterPreflight({
    dryRun: DRY_RUN,
    mutate: async () => {
      mutated = true;
      try {
        await withTimeout('V2 operation', () => exerciseV2(userId));
      } finally {
        for (const operationId of operationIds) await reconcileCleanup(userId, operationId);
      }
    },
  });
  assert.equal(DRY_RUN ? mutated : true, mutated);
  console.log(outcome === 'dry-run'
    ? 'SafeMeLink Phone OTP V2 preflight passed; dry run made zero mutations.'
    : 'SafeMeLink Phone OTP V2 runtime contract checks passed.');
};

main().catch(async (error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
});
