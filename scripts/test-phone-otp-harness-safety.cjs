const assert = require('node:assert/strict');
const {
  assertNoPreexistingData,
  ChallengeLifecycleGuard,
  createRunPhone,
  HarnessTimeoutError,
  isDisposableAccount,
  matchesOwnedVerification,
  parseHarnessTarget,
  REPOSITORY_DEVELOPMENT_PROJECT_REF,
  runAfterPreflight,
  runCleanupSteps,
  sanitizeError,
  validateChallengeMutationResponse,
  withTimeout,
} = require('./phone-otp-harness-safety.cjs');

const developmentRef = 'abcdefghijklmnopqrst';
const productionRef = 'zyxwvutsrqponmlkjihg';
const accept = (url, expected = developmentRef) => parseHarnessTarget(url, expected);
const reject = (url, expected = developmentRef) => assert.throws(() => accept(url, expected));

reject(`https://${productionRef}.supabase.co/development`);
reject(`https://${productionRef}.supabase.co/?environment=development`);
reject(`https://${productionRef}.supabase.co/`, developmentRef);
assert.equal(accept(`https://${developmentRef}.supabase.co/`).projectRef, developmentRef);
assert.throws(() => parseHarnessTarget(`https://${developmentRef}.supabase.co/`, null));
reject('not-a-url');
reject(`http://${developmentRef}.supabase.co/`);
assert.equal(accept('http://127.0.0.1:54321/').kind, 'local');
assert.equal(accept('http://localhost:54321/').kind, 'local');
reject('http://localhost:8000/');
reject(`https://user:password@${developmentRef}.supabase.co/`);
assert.equal(REPOSITORY_DEVELOPMENT_PROJECT_REF, null);

assert.equal(isDisposableAccount({ app_metadata: {} }), false);
assert.equal(isDisposableAccount({
  app_metadata: {
    safemelink_test_purpose: 'phone_otp_runtime_disposable',
    safemelink_disposable: true,
  },
}), true);

assert.doesNotThrow(() => assertNoPreexistingData({ verifications: 0, challenges: 0 }));
assert.throws(() => assertNoPreexistingData({ verifications: 1 }), /pre-existing/);

const main = async () => {
  let mutationCount = 0;
  const result = await runAfterPreflight({
    dryRun: true,
    mutate: async () => { mutationCount += 1; },
  });
  assert.equal(result, 'dry-run');
  assert.equal(mutationCount, 0);

  await assert.rejects(
    runCleanupSteps([
      ['owned challenges', async () => { throw new Error('simulated'); }],
      ['owned verification', async () => {}],
    ]),
    /Cleanup failed \(owned challenges\)/,
  );

  let timeoutCleanupCalled = false;
  await assert.rejects(
    withTimeout('simulated operation', () => new Promise(() => {}), 5, () => {
      timeoutCleanupCalled = true;
    }),
    HarnessTimeoutError,
  );
  assert.equal(timeoutCleanupCalled, true);

  const sentinel = 'SERVICE_ROLE_SENTINEL_DO_NOT_PRINT';
  const sanitized = sanitizeError({
    message: `request failed Authorization: Bearer ${sentinel}`,
    token: sentinel,
    code: 'PGRST001',
  });
  assert.equal(sanitized.includes(sentinel), false);
  assert.equal(sanitizeError(new Error(sentinel)).includes(sentinel), false);
  assert.match(createRunPhone(), /^\+999[1-9][0-9]{11}$/);
  assert.equal(matchesOwnedVerification({
    phone_e164: '+999123456789012', verification_source: 'safemelink_phone_otp',
  }, '+999123456789012'), true);
  assert.equal(matchesOwnedVerification({
    phone_e164: '+999123456789013', verification_source: 'safemelink_phone_otp',
  }, '+999123456789012'), false);
  assert.equal(matchesOwnedVerification({
    phone_e164: '+999123456789012', verification_source: 'legacy',
  }, '+999123456789012'), false);

  const lifecycle = new ChallengeLifecycleGuard();
  lifecycle.markPending('account-a', 'challenge-1');
  assert.throws(() => lifecycle.assertCanCreate('account-a'), /pending challenge/);
  lifecycle.markTerminal('account-a', 'challenge-1');
  assert.doesNotThrow(() => lifecycle.assertCanCreate('account-a'));

  const ownedIds = new Set(['owned-challenge']);
  assert.equal(validateChallengeMutationResponse({
    data: [{ challenge_id: 'owned-challenge' }], error: null,
  }, 'owned-challenge'), 'created');
  assert.throws(() => validateChallengeMutationResponse({
    data: [{ challenge_id: 'foreign-challenge' }], error: null,
  }, 'owned-challenge'), /not owned/);
  assert.equal(ownedIds.has('foreign-challenge'), false);
  assert.throws(() => validateChallengeMutationResponse({ data: [], error: null }, 'owned-challenge'),
    /missing or ambiguous/);
  assert.throws(() => validateChallengeMutationResponse({
    data: [{ challenge_id: 'owned-challenge' }, { challenge_id: 'foreign-challenge' }], error: null,
  }, 'owned-challenge'), /missing or ambiguous/);
  assert.equal(validateChallengeMutationResponse({ data: null, error: new Error('simulated') },
    'owned-challenge'), 'failed');
  console.log('SafeMeLink phone OTP harness safety checks passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Harness safety checks failed.');
  process.exitCode = 1;
});
