const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/phone-verification/crypto.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('exports', 'module', compiled)(moduleUnderTest.exports, moduleUnderTest);

const phoneSource = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/phone-verification/phone.ts'),
  'utf8',
);
const compiledPhone = ts.transpileModule(phoneSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const phoneModuleUnderTest = { exports: {} };
new Function('exports', 'module', compiledPhone)(phoneModuleUnderTest.exports, phoneModuleUnderTest);

const {
  constantTimeEqual,
  createOtpDigest,
  decryptPhone,
  decryptOtpForDelivery,
  encryptPhone,
  encryptOtpForDelivery,
  generateOtp,
  hmacValue,
} = moduleUnderTest.exports;
const { isValidE164Phone, normalizeE164Phone } = phoneModuleUnderTest.exports;

const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64url');

const main = async () => {
  const key = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challengeId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const phoneHmac = await hmacValue(
    'identity-secret-with-at-least-32-bytes',
    'phone',
    '+39000000000',
  );
  const encrypted = await encryptPhone(
    key,
    '+39000000000',
    challengeId,
    userId,
    phoneHmac,
  );

  assert.equal(
    await decryptPhone(key, encrypted.ciphertext, encrypted.nonce, challengeId, userId, phoneHmac),
    '+39000000000',
  );
  const encryptedOtp = await encryptOtpForDelivery(key, '123456', challengeId, userId, phoneHmac);
  assert.equal(await decryptOtpForDelivery(
    key, encryptedOtp.ciphertext, encryptedOtp.nonce, challengeId, userId, phoneHmac,
  ), '123456');
  await assert.rejects(() => decryptOtpForDelivery(
    key, encryptedOtp.ciphertext, encryptedOtp.nonce, crypto.randomUUID(), userId, phoneHmac,
  ));

  for (const [changedChallenge, changedUser, changedPhoneHmac] of [
    [crypto.randomUUID(), userId, phoneHmac],
    [challengeId, crypto.randomUUID(), phoneHmac],
    [challengeId, userId, `${phoneHmac}tampered`],
  ]) {
    await assert.rejects(() => decryptPhone(
      key,
      encrypted.ciphertext,
      encrypted.nonce,
      changedChallenge,
      changedUser,
      changedPhoneHmac,
    ));
  }

  for (let index = 0; index < 1_000; index += 1) {
    assert.match(generateOtp(), /^\d{6}$/);
  }
  const digest = await createOtpDigest(
    'otp-secret-with-at-least-thirty-two-bytes',
    challengeId,
    userId,
    phoneHmac,
    '123456',
  );
  assert.equal(constantTimeEqual(digest, digest), true);
  assert.equal(constantTimeEqual(digest, `${digest}x`), false);
  assert.equal(normalizeE164Phone('+39 000 000 0000'), '+390000000000');
  assert.equal(normalizeE164Phone('0039-000-000-0000'), '+390000000000');
  assert.equal(normalizeE164Phone('390000000000'), null);
  assert.equal(normalizeE164Phone('+01234567890'), null);
  assert.equal(normalizeE164Phone('+39123'), null);
  assert.equal(normalizeE164Phone({}), null);
  assert.equal(isValidE164Phone('+390000000000'), true);
  assert.equal(isValidE164Phone('390000000000'), false);
  console.log('SafeMeLink phone OTP cryptography runtime checks passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Phone OTP crypto runtime test failed.');
  process.exitCode = 1;
});
