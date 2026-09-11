const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/phone-verification/smsProvider.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('exports', 'module', compiled)(moduleUnderTest.exports, moduleUnderTest);

const clientIpSource = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/phone-verification/clientIp.ts'),
  'utf8',
);
const compiledClientIp = ts.transpileModule(clientIpSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clientIpModule = { exports: {} };
new Function('exports', 'module', compiledClientIp)(clientIpModule.exports, clientIpModule);

const { sendVerificationSms, SmsProviderError } = moduleUnderTest.exports;
const { getTrustedClientIp } = clientIpModule.exports;
const originalFetch = global.fetch;
const originalDeno = global.Deno;
const originalSetTimeout = global.setTimeout;

const baseEnv = {
  PHONE_OTP_PROVIDER_URL: 'https://sms.provider.example/v1/messages',
  PHONE_OTP_PROVIDER_ALLOWED_HOST: 'sms.provider.example',
  PHONE_OTP_PROVIDER_TOKEN: 'provider-test-token',
  PHONE_OTP_PROVIDER_SENDER: 'SafeMeLink',
  PHONE_OTP_PROVIDER_ACCEPTED_STATUS: '202',
  PHONE_OTP_PROVIDER_ACCEPTANCE_FIELD: 'status',
  PHONE_OTP_PROVIDER_ACCEPTANCE_VALUE: 'accepted',
  PHONE_OTP_PROVIDER_MESSAGE_ID_FIELD: 'messageId',
};

const configure = (overrides = {}) => {
  const values = { ...baseEnv, ...overrides };
  global.Deno = { env: { get: (key) => values[key] } };
};

const expectCategory = async (category) => {
  await assert.rejects(
    () => sendVerificationSms('+390000000000', '123456'),
    (error) => error instanceof SmsProviderError && error.category === category,
  );
};

const main = async () => {
  const ipRequest = new Request('https://function.example', {
    headers: {
      'x-forwarded-for': '203.0.113.4, 10.0.0.1',
      'x-real-ip': '198.51.100.8',
    },
  });
  assert.equal(getTrustedClientIp(ipRequest, undefined), null);
  assert.equal(getTrustedClientIp(ipRequest, 'untrusted-header'), null);
  assert.equal(getTrustedClientIp(ipRequest, 'x-forwarded-for'), '203.0.113.4');
  assert.equal(getTrustedClientIp(ipRequest, 'x-real-ip'), '198.51.100.8');

  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not run for invalid configuration');
  };
  for (const overrides of [
    { PHONE_OTP_PROVIDER_URL: 'http://sms.provider.example/v1/messages' },
    { PHONE_OTP_PROVIDER_URL: 'not a url' },
    { PHONE_OTP_PROVIDER_URL: 'https://user:password@sms.provider.example/v1/messages' },
    { PHONE_OTP_PROVIDER_ALLOWED_HOST: 'different.provider.example' },
    {
      PHONE_OTP_PROVIDER_URL: 'https://127.0.0.1/v1/messages',
      PHONE_OTP_PROVIDER_ALLOWED_HOST: '127.0.0.1',
    },
    {
      PHONE_OTP_PROVIDER_URL: 'https://metadata.service.internal/v1/messages',
      PHONE_OTP_PROVIDER_ALLOWED_HOST: 'metadata.service.internal',
    },
  ]) {
    configure(overrides);
    await expectCategory('not_configured');
  }
  assert.equal(fetchCalls, 0);

  configure();
  let redirectMode = null;
  global.fetch = async (_url, options) => {
    redirectMode = options.redirect;
    return new Response(JSON.stringify({ status: 'unknown' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };
  await expectCategory('rejected');
  assert.equal(redirectMode, 'error');

  global.fetch = async () => new Response(
    JSON.stringify({ status: 'accepted', messageId: 'provider-reference' }),
    { status: 202, headers: { 'content-type': 'application/json' } },
  );
  assert.deepEqual(
    await sendVerificationSms('+390000000000', '123456'),
    { messageReference: 'provider-reference' },
  );

  global.fetch = async () => new Response('x'.repeat(4_097), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });
  await expectCategory('rejected');

  global.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 1, ...args);
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await expectCategory('timeout');

  console.log('SafeMeLink phone OTP provider boundary runtime checks passed.');
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Phone OTP provider runtime test failed.');
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
    global.Deno = originalDeno;
    global.setTimeout = originalSetTimeout;
  });
