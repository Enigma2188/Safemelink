const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const {
  assertNoPreexistingData,
  ChallengeLifecycleGuard,
  createRunPhone,
  isDisposableAccount,
  matchesOwnedVerification,
  parseHarnessTarget,
  runAfterPreflight,
  runCleanupSteps,
  sanitizeError,
  validateChallengeMutationResponse,
  withTimeout,
} = require('./phone-otp-harness-safety.cjs');

const ACKNOWLEDGEMENT = 'DEVELOPMENT_ONLY';
const DRY_RUN = process.env.PHONE_OTP_RUNTIME_DRY_RUN === '1';
const INTERNAL_RPCS = [
  ['create_phone_verification_challenge', {
    target_user_id: crypto.randomUUID(), target_challenge_id: crypto.randomUUID(),
    target_phone_hmac: 'p'.repeat(43), target_phone_ciphertext: 'c'.repeat(16),
    target_phone_nonce: 'n'.repeat(12), target_otp_digest: 'd'.repeat(43),
    target_idempotency_key: crypto.randomUUID(), target_ip_hmac: null,
  }],
  ['mark_phone_verification_delivery', {
    target_user_id: crypto.randomUUID(), target_challenge_id: crypto.randomUUID(),
    delivery_succeeded: false, target_provider_reference_hash: null, target_error_category: 'test',
  }],
  ['verify_phone_verification_challenge', {
    target_user_id: crypto.randomUUID(), target_challenge_id: crypto.randomUUID(),
    candidate_matches: false, target_phone_hmac: 'p'.repeat(43), target_phone_e164: '+999000000000',
  }],
  ['cancel_phone_verification_challenge', {
    target_user_id: crypto.randomUUID(), target_challenge_id: crypto.randomUUID(),
  }],
  ['cleanup_phone_verification_data', {}],
];

const required = (value, name) => {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
if (process.env.PHONE_OTP_RUNTIME_TEST_ACK !== ACKNOWLEDGEMENT) {
  throw new Error(`Refusing to run without PHONE_OTP_RUNTIME_TEST_ACK=${ACKNOWLEDGEMENT}.`);
}

const target = parseHarnessTarget(required(
  process.env.PHONE_OTP_TEST_SUPABASE_URL, 'PHONE_OTP_TEST_SUPABASE_URL',
));
const anonKey = required(process.env.PHONE_OTP_TEST_ANON_KEY, 'PHONE_OTP_TEST_ANON_KEY');
const serviceRoleKey = required(process.env.PHONE_OTP_TEST_SERVICE_ROLE_KEY, 'PHONE_OTP_TEST_SERVICE_ROLE_KEY');
const tokenA = required(process.env.PHONE_OTP_TEST_USER_A_TOKEN, 'PHONE_OTP_TEST_USER_A_TOKEN');
const tokenB = required(process.env.PHONE_OTP_TEST_USER_B_TOKEN, 'PHONE_OTP_TEST_USER_B_TOKEN');
const options = (token) => ({
  auth: { autoRefreshToken: false, persistSession: false },
  ...(token ? { global: { headers: { authorization: `Bearer ${token}` } } } : {}),
});
const anon = createClient(target.origin, anonKey, options(''));
const userA = createClient(target.origin, anonKey, options(tokenA));
const userB = createClient(target.origin, anonKey, options(tokenB));
const admin = createClient(target.origin, serviceRoleKey, options(''));
const createdChallengeIds = new Set();
const ownedVerifications = new Map();
const challengeLifecycle = new ChallengeLifecycleGuard();
const primaryPhone = createRunPhone();
const duplicatePhone = createRunPhone();
const phoneHmac = 'p'.repeat(43);
const ciphertext = 'c'.repeat(16);
const nonce = 'n'.repeat(12);
const digest = 'd'.repeat(43);

const getAuthenticatedUser = async (client, token) => {
  const { data, error } = await withTimeout('authenticated user lookup', () => client.auth.getUser(token));
  assert.ifError(error);
  assert.ok(data.user, 'Authenticated user is unavailable.');
  return data.user;
};
const runPostgrest = (label, queryFactory) => {
  const controller = new AbortController();
  return withTimeout(label, () => queryFactory(controller.signal), undefined, () => controller.abort());
};
const expectDenied = (result, label) => {
  assert.ok(result.error, `${label} unexpectedly succeeded`);
  assert.match(`${result.error.code ?? ''} ${result.error.message ?? ''}`,
    /42501|permission denied|not allowed|unauthorized/i,
    `${label} failed for a reason other than authorization`);
};
const requireEmpty = async (table, userIds) => {
  const result = await runPostgrest(`${table} preflight`, (signal) => admin.from(table)
    .select('user_id').in('user_id', userIds).limit(1).abortSignal(signal));
  assert.ifError(result.error);
  assertNoPreexistingData({ [table]: result.data?.length ?? 0 });
};
const readRpcCatalog = async (apiKey, bearerToken) => {
  const controller = new AbortController();
  return withTimeout('PostgREST catalog inspection', async () => {
    const response = await fetch(`${target.origin}/rest/v1/`, {
      headers: { apikey: apiKey, authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });
    assert.equal(response.ok, true, 'PostgREST schema preflight failed.');
    return response.json();
  }, undefined, () => controller.abort());
};
const checkRpcCatalog = async () => {
  const schema = await readRpcCatalog(serviceRoleKey, serviceRoleKey);
  for (const [name] of INTERNAL_RPCS) {
    assert.ok(schema.paths?.[`/rpc/${name}`], `Required RPC ${name} is unavailable.`);
  }
  assert.ok(schema.paths?.['/rpc/get_my_network_onboarding_status'], 'Onboarding RPC is unavailable.');
};
const checkAuthenticatedRpcDenials = async (token, label) => {
  const schema = await readRpcCatalog(anonKey, token);
  for (const [name] of INTERNAL_RPCS) {
    assert.equal(schema.paths?.[`/rpc/${name}`], undefined,
      `authenticated ${label} can discover internal RPC ${name}`);
  }
};

const preflight = async () => {
  const accountA = await getAuthenticatedUser(userA, tokenA);
  const accountB = await getAuthenticatedUser(userB, tokenB);
  assert.notEqual(accountA.id, accountB.id, 'Two distinct test accounts are required.');
  for (const account of [accountA, accountB]) {
    const result = await withTimeout('authoritative account lookup', () => admin.auth.admin.getUserById(account.id));
    assert.ifError(result.error);
    assert.equal(result.data.user?.id, account.id, 'JWT account does not match the authoritative account.');
    assert.equal(isDisposableAccount(result.data.user), true, 'Account is not authoritatively marked disposable.');
  }
  const userIds = [accountA.id, accountB.id];
  await checkRpcCatalog();
  await requireEmpty('account_verifications', userIds);
  await requireEmpty('phone_verification_challenges', userIds);
  await requireEmpty('phone_verification_rate_events', userIds);
  for (const [client, label] of [[userA, 'A'], [userB, 'B']]) {
    const onboarding = await runPostgrest('onboarding preflight', (signal) => client
      .rpc('get_my_network_onboarding_status').abortSignal(signal));
    assert.ifError(onboarding.error);
    const state = onboarding.data?.[0];
    assert.ok(state?.email_verified, `Disposable account ${label} email is not verified.`);
    assert.ok(state?.nickname_present, `Disposable account ${label} nickname is missing.`);
    assert.ok(state?.terms_accepted, `Disposable account ${label} has not accepted current terms.`);
    assert.equal(state?.restriction_status, 'NONE', `Disposable account ${label} is restricted.`);
    assert.equal(state?.phone_verified, false, `Disposable account ${label} is already phone verified.`);
    await checkAuthenticatedRpcDenials(label === 'A' ? tokenA : tokenB, label);
  }
  expectDenied(await runPostgrest('anonymous table grant check', (signal) => anon
    .from('phone_verification_challenges').select('id').limit(1).abortSignal(signal)), 'anon challenge read');
  expectDenied(await runPostgrest('authenticated table grant check', (signal) => userA
    .from('phone_verification_challenges').select('id').limit(1).abortSignal(signal)), 'authenticated challenge read');
  return { accountA, accountB };
};

const rpc = (name, args) => runPostgrest(`RPC ${name}`, (signal) => admin.rpc(name, args).abortSignal(signal));
const insertChallenge = async (userId, status = 'PENDING', overrides = {}) => {
  if (status === 'PENDING' || status === 'DELIVERY_PENDING') challengeLifecycle.assertCanCreate(userId);
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, user_id: userId,
    phone_hmac: overrides.phone_hmac ?? `${phoneHmac.slice(0, -1)}${createdChallengeIds.size % 10}`,
    phone_ciphertext: ciphertext, phone_nonce: nonce, otp_digest: digest,
    idempotency_key: crypto.randomUUID(), status, attempt_count: 0, max_attempts: 5,
    created_at: new Date(now).toISOString(), expires_at: new Date(now + 600_000).toISOString(),
    resend_available_at: new Date(now + 60_000).toISOString(), ...overrides,
  };
  createdChallengeIds.add(id);
  const result = await runPostgrest('challenge insert', (signal) => admin
    .from('phone_verification_challenges').insert(row).abortSignal(signal));
  assert.ifError(result.error);
  if (status === 'PENDING' || status === 'DELIVERY_PENDING') challengeLifecycle.markPending(userId, id);
  return { id, phoneHmac: row.phone_hmac };
};

const removeOwnedChallenges = async (owned) => {
  const ids = owned.map(({ id }) => id);
  if (!ids.length) return;
  const result = await runPostgrest('terminal challenge cleanup', (signal) => admin
    .from('phone_verification_challenges').delete().in('id', ids).abortSignal(signal));
  assert.ifError(result.error);
  for (const { id, userId } of owned) {
    createdChallengeIds.delete(id);
    challengeLifecycle.markTerminal(userId, id);
  }
};

const ownVerificationBeforeMutation = (userId, phoneE164) => {
  const existing = ownedVerifications.get(userId);
  assert.ok(!existing || existing === phoneE164, 'Conflicting verification ownership in one run.');
  ownedVerifications.set(userId, phoneE164);
};

const removeOwnedVerification = async (userId, phoneE164) => {
  const current = await runPostgrest('verification ownership check', (signal) => admin
    .from('account_verifications').select('phone_e164, verification_source')
    .eq('user_id', userId).maybeSingle().abortSignal(signal));
  assert.ifError(current.error);
  if (!current.data) {
    ownedVerifications.delete(userId);
    return;
  }
  if (!matchesOwnedVerification(current.data, phoneE164)) {
    throw new Error('Verification cleanup ownership could not be proven.');
  }
  const removed = await runPostgrest('owned verification cleanup', (signal) => admin
    .from('account_verifications').delete({ count: 'exact' })
    .eq('user_id', userId).eq('phone_e164', phoneE164)
    .eq('verification_source', 'safemelink_phone_otp').abortSignal(signal));
  assert.ifError(removed.error);
  assert.equal(removed.count, 1, 'Owned verification changed before cleanup.');
  ownedVerifications.delete(userId);
};

const runRuntimeChecks = async ({ accountA, accountB }) => {
  const requestArgs = (userId = accountA.id, targetPhoneHmac = phoneHmac) => ({
    target_user_id: userId, target_challenge_id: (() => {
      const id = crypto.randomUUID();
      createdChallengeIds.add(id);
      return id;
    })(),
    target_phone_hmac: targetPhoneHmac, target_phone_ciphertext: ciphertext,
    target_phone_nonce: nonce, target_otp_digest: digest,
    target_idempotency_key: crypto.randomUUID(), target_ip_hmac: null,
  });
  const concurrentRequestArgs = [requestArgs(), requestArgs()];
  const concurrentRequests = await Promise.all(concurrentRequestArgs.map(
    (args) => rpc('create_phone_verification_challenge', args),
  ));
  for (const [index, result] of concurrentRequests.entries()) {
    if (validateChallengeMutationResponse(result, concurrentRequestArgs[index].target_challenge_id) === 'created') {
      challengeLifecycle.markPending(accountA.id, concurrentRequestArgs[index].target_challenge_id);
    }
  }
  assert.equal(concurrentRequests.filter((result) => !result.error).length, 1);
  await removeOwnedChallenges(concurrentRequestArgs.map((args) => ({
    id: args.target_challenge_id, userId: accountA.id,
  })));

  const sharedRequestArgs = [
    requestArgs(accountA.id, 's'.repeat(43)),
    requestArgs(accountB.id, 's'.repeat(43)),
  ];
  const sharedPhoneRequests = await Promise.all(sharedRequestArgs.map(
    (args) => rpc('create_phone_verification_challenge', args),
  ));
  for (const [index, result] of sharedPhoneRequests.entries()) {
    const expected = sharedRequestArgs[index];
    if (validateChallengeMutationResponse(result, expected.target_challenge_id) === 'created') {
      challengeLifecycle.markPending(expected.target_user_id, expected.target_challenge_id);
    }
  }
  assert.equal(sharedPhoneRequests.filter((result) => !result.error).length, 1);
  await removeOwnedChallenges(sharedRequestArgs.map((args) => ({
    id: args.target_challenge_id, userId: args.target_user_id,
  })));

  const replay = await insertChallenge(accountA.id);
  const verifyArgs = {
    target_user_id: accountA.id, target_challenge_id: replay.id, candidate_matches: true,
    target_phone_hmac: replay.phoneHmac, target_phone_e164: primaryPhone,
  };
  ownVerificationBeforeMutation(accountA.id, primaryPhone);
  const concurrentVerify = await Promise.all([
    rpc('verify_phone_verification_challenge', verifyArgs), rpc('verify_phone_verification_challenge', verifyArgs),
  ]);
  assert.deepEqual(new Set(concurrentVerify.map((result) => result.data)), new Set(['verified', 'already_verified']));
  challengeLifecycle.markTerminal(accountA.id, replay.id);

  const expired = await insertChallenge(accountA.id, 'PENDING', {
    created_at: new Date(Date.now() - 700_000).toISOString(),
    expires_at: new Date(Date.now() - 100_000).toISOString(),
    resend_available_at: new Date(Date.now() - 640_000).toISOString(),
  });
  assert.equal((await rpc('verify_phone_verification_challenge', {
    ...verifyArgs, target_challenge_id: expired.id, target_phone_hmac: expired.phoneHmac,
  })).data, 'expired');
  challengeLifecycle.markTerminal(accountA.id, expired.id);
  const cancelled = await insertChallenge(accountA.id);
  assert.equal((await rpc('cancel_phone_verification_challenge', {
    target_user_id: accountA.id, target_challenge_id: cancelled.id,
  })).data, true);
  challengeLifecycle.markTerminal(accountA.id, cancelled.id);
  const deliveryFailed = await insertChallenge(accountA.id, 'DELIVERY_PENDING');
  assert.equal((await rpc('mark_phone_verification_delivery', {
    target_user_id: accountA.id, target_challenge_id: deliveryFailed.id,
    delivery_succeeded: false, target_provider_reference_hash: null, target_error_category: 'provider',
  })).data, true);
  challengeLifecycle.markTerminal(accountA.id, deliveryFailed.id);
  const locked = await insertChallenge(accountA.id);
  const wrongArgs = { ...verifyArgs, target_challenge_id: locked.id,
    target_phone_hmac: locked.phoneHmac, candidate_matches: false };
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await rpc('verify_phone_verification_challenge', wrongArgs)).data,
      attempt === 5 ? 'locked' : 'invalid_code');
  }
  challengeLifecycle.markTerminal(accountA.id, locked.id);

  const onboarding = await runPostgrest('eligibility verification', (signal) => userA
    .rpc('get_my_network_onboarding_status').abortSignal(signal));
  assert.ifError(onboarding.error);
  assert.equal(onboarding.data?.[0]?.phone_verified, true);
  assert.equal(onboarding.data?.[0]?.eligible, true);
  await removeOwnedVerification(accountA.id, primaryPhone);

  const duplicatePhoneHmac = 'z'.repeat(43);
  const challengeA = await insertChallenge(accountA.id, 'PENDING', { phone_hmac: duplicatePhoneHmac });
  const challengeB = await insertChallenge(accountB.id, 'PENDING', { phone_hmac: duplicatePhoneHmac });
  ownVerificationBeforeMutation(accountA.id, duplicatePhone);
  ownVerificationBeforeMutation(accountB.id, duplicatePhone);
  const duplicateResults = await Promise.all([
    rpc('verify_phone_verification_challenge', { ...verifyArgs, target_challenge_id: challengeA.id,
      target_user_id: accountA.id, target_phone_hmac: duplicatePhoneHmac, target_phone_e164: duplicatePhone }),
    rpc('verify_phone_verification_challenge', { ...verifyArgs, target_challenge_id: challengeB.id,
      target_user_id: accountB.id, target_phone_hmac: duplicatePhoneHmac, target_phone_e164: duplicatePhone }),
  ]);
  assert.equal(duplicateResults.filter((result) => result.data === 'verified').length, 1);
  assert.equal(duplicateResults.filter((result) => result.data === 'phone_unavailable').length, 1);
  challengeLifecycle.markTerminal(accountA.id, challengeA.id);
  challengeLifecycle.markTerminal(accountB.id, challengeB.id);
};

const cleanup = async () => {
  const steps = [];
  if (createdChallengeIds.size) {
    steps.push(['owned challenges', async () => {
      const result = await runPostgrest('owned challenge cleanup', (signal) => admin
        .from('phone_verification_challenges').delete().in('id', [...createdChallengeIds])
        .abortSignal(signal));
      if (result.error) throw new Error('challenge cleanup failed');
    }]);
  }
  for (const [userId, phoneE164] of ownedVerifications) {
    steps.push([`owned verification ${steps.length + 1}`, async () => {
      await removeOwnedVerification(userId, phoneE164);
    }]);
  }
  await runCleanupSteps(steps);
};

const main = async () => {
  const context = await preflight();
  const outcome = await runAfterPreflight({ dryRun: DRY_RUN, mutate: async () => runRuntimeChecks(context) });
  if (outcome === 'dry-run') {
    console.log('SafeMeLink phone OTP PostgreSQL preflight passed; dry run made zero mutations.');
    return;
  }
  console.log('SafeMeLink phone OTP PostgreSQL runtime checks passed.');
};

main().catch((error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
}).finally(async () => {
  try {
    await cleanup();
  } catch (error) {
    console.error(sanitizeError(error));
    process.exitCode = 1;
  }
});
