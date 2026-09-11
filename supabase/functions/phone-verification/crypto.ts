const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const importHmacKey = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

export async function hmacValue(secret: string, purpose: string, value: string) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}\u0000${value}`));
  return bytesToBase64Url(new Uint8Array(signature));
}

export function generateOtp() {
  const range = 1_000_000;
  const ceiling = Math.floor(0x1_0000_0000 / range) * range;
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= ceiling);
  return String(random[0] % range).padStart(6, '0');
}

const phoneEncryptionAad = (challengeId: string, userId: string, phoneHmac: string) =>
  encoder.encode(`phone\u0000${challengeId}\u0000${userId}\u0000${phoneHmac}`);
const otpDeliveryEncryptionAad = (operationId: string, userId: string, phoneHmac: string) =>
  encoder.encode(`otp-delivery\u0000${operationId}\u0000${userId}\u0000${phoneHmac}`);

const importEncryptionKey = async (encryptionKeyBase64Url: string, usage: KeyUsage[]) => {
  const rawKey = base64UrlToBytes(encryptionKeyBase64Url);
  if (rawKey.byteLength !== 32) throw new Error('PHONE_ENCRYPTION_KEY_INVALID');
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, usage);
};

export async function encryptPhone(
  encryptionKeyBase64Url: string,
  phone: string,
  challengeId: string,
  userId: string,
  phoneHmac: string,
) {
  const key = await importEncryptionKey(encryptionKeyBase64Url, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: phoneEncryptionAad(challengeId, userId, phoneHmac),
    },
    key,
    encoder.encode(phone),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
  };
}

export async function decryptPhone(
  encryptionKeyBase64Url: string,
  ciphertext: string,
  nonce: string,
  challengeId: string,
  userId: string,
  phoneHmac: string,
) {
  const key = await importEncryptionKey(encryptionKeyBase64Url, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(nonce),
      additionalData: phoneEncryptionAad(challengeId, userId, phoneHmac),
    },
    key,
    base64UrlToBytes(ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function encryptOtpForDelivery(
  encryptionKeyBase64Url: string,
  otp: string,
  operationId: string,
  userId: string,
  phoneHmac: string,
) {
  const key = await importEncryptionKey(encryptionKeyBase64Url, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce,
    additionalData: otpDeliveryEncryptionAad(operationId, userId, phoneHmac),
  }, key, encoder.encode(otp));
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), nonce: bytesToBase64Url(nonce) };
}

export async function decryptOtpForDelivery(
  encryptionKeyBase64Url: string,
  ciphertext: string,
  nonce: string,
  operationId: string,
  userId: string,
  phoneHmac: string,
) {
  const key = await importEncryptionKey(encryptionKeyBase64Url, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: base64UrlToBytes(nonce),
    additionalData: otpDeliveryEncryptionAad(operationId, userId, phoneHmac),
  }, key, base64UrlToBytes(ciphertext));
  return decoder.decode(plaintext);
}

export const createOtpDigest = (
  secret: string,
  challengeId: string,
  userId: string,
  phoneHmac: string,
  otp: string,
) => hmacValue(secret, 'otp', `${challengeId}|${userId}|${phoneHmac}|${otp}`);

export function constantTimeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
