const { randomInt } = require('node:crypto');

const REMOTE_SUPABASE_HOST = /^([a-z0-9]{20})\.supabase\.co$/;
const DISPOSABLE_PURPOSE = 'phone_otp_runtime_disposable';
const DEFAULT_REMOTE_TIMEOUT_MS = 15_000;

// Intentionally unset until the Development project reference is reviewed and
// committed independently of the environment used to launch the harness.
const REPOSITORY_DEVELOPMENT_PROJECT_REF = null;

const parseHarnessTarget = (rawUrl, expectedProjectRef = REPOSITORY_DEVELOPMENT_PROJECT_REF) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid Supabase test URL.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Supabase test URL must contain only an origin.');
  }

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    if (url.protocol !== 'http:' || url.port !== '54321') {
      throw new Error('Only the standard local Supabase API origin is allowed.');
    }
    return { kind: 'local', projectRef: null, origin: url.origin };
  }

  if (url.protocol !== 'https:' || url.port) {
    throw new Error('Remote Supabase tests require the canonical HTTPS origin.');
  }
  const match = url.hostname.match(REMOTE_SUPABASE_HOST);
  if (!match) throw new Error('Remote host is not a canonical Supabase project origin.');
  if (!expectedProjectRef) {
    throw new Error('Remote execution is blocked until a Development project ref is committed.');
  }
  if (match[1] !== expectedProjectRef) throw new Error('Supabase project ref is not Development.');
  return { kind: 'development', projectRef: match[1], origin: url.origin };
};

const isDisposableAccount = (user) => user?.app_metadata?.safemelink_test_purpose === DISPOSABLE_PURPOSE
  && user?.app_metadata?.safemelink_disposable === true;

const assertNoPreexistingData = (counts) => {
  for (const [label, count] of Object.entries(counts)) {
    if (count !== 0) throw new Error(`${label} contains pre-existing account data.`);
  }
};

const runAfterPreflight = async ({ dryRun, mutate }) => {
  if (dryRun) return 'dry-run';
  await mutate();
  return 'executed';
};

const runCleanupSteps = async (steps) => {
  const failures = [];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch {
      failures.push(label);
    }
  }
  if (failures.length) throw new Error(`Cleanup failed (${failures.join(', ')}).`);
};

class HarnessTimeoutError extends Error {
  constructor(label) {
    super(`${label} timed out.`);
    this.name = 'HarnessTimeoutError';
  }
}

const withTimeout = (label, operation, timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS, onTimeout = () => {}) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timerId);
    callback(value);
  };
  const timerId = setTimeout(() => {
    try {
      onTimeout();
    } finally {
      finish(reject, new HarnessTimeoutError(label));
    }
  }, timeoutMs);
  Promise.resolve().then(operation).then(
    (value) => finish(resolve, value),
    (error) => finish(reject, error),
  );
});

const sanitizeError = (error) => {
  if (error instanceof HarnessTimeoutError) return error.message;
  return 'Harness operation failed.';
};

const createRunPhone = () => `+999${randomInt(100_000_000_000, 999_999_999_999)}`;
const matchesOwnedVerification = (row, phoneE164) => row?.phone_e164 === phoneE164
  && row?.verification_source === 'safemelink_phone_otp';

const validateChallengeMutationResponse = (result, expectedChallengeId) => {
  const rows = Array.isArray(result?.data) ? result.data : [];
  if (result?.error) {
    if (rows.length) throw new Error('Failed challenge mutation returned ambiguous data.');
    return 'failed';
  }
  if (rows.length !== 1 || typeof rows[0]?.challenge_id !== 'string') {
    throw new Error('Challenge mutation returned a missing or ambiguous identifier.');
  }
  if (rows[0].challenge_id !== expectedChallengeId) {
    throw new Error('Challenge mutation returned an identifier not owned by this run.');
  }
  return 'created';
};

class ChallengeLifecycleGuard {
  constructor() {
    this.pendingByUser = new Map();
  }

  assertCanCreate(userId) {
    if (this.pendingByUser.has(userId)) throw new Error('A pending challenge already exists for this account.');
  }

  markPending(userId, challengeId) {
    this.assertCanCreate(userId);
    this.pendingByUser.set(userId, challengeId);
  }

  markTerminal(userId, challengeId) {
    if (this.pendingByUser.get(userId) === challengeId) this.pendingByUser.delete(userId);
  }
}

module.exports = {
  DISPOSABLE_PURPOSE,
  ChallengeLifecycleGuard,
  HarnessTimeoutError,
  REPOSITORY_DEVELOPMENT_PROJECT_REF,
  assertNoPreexistingData,
  isDisposableAccount,
  matchesOwnedVerification,
  parseHarnessTarget,
  createRunPhone,
  runAfterPreflight,
  runCleanupSteps,
  sanitizeError,
  validateChallengeMutationResponse,
  withTimeout,
};
