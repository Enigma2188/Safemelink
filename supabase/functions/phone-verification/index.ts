import { createClient } from 'npm:@supabase/supabase-js@2.109.0';

import {
  constantTimeEqual,
  createOtpDigest,
  decryptPhone,
  decryptOtpForDelivery,
  encryptPhone,
  encryptOtpForDelivery,
  generateOtp,
  hmacValue,
} from './crypto.ts';
import { getTrustedClientIp } from './clientIp.ts';
import { isValidE164Phone, normalizeE164Phone } from './phone.ts';
import { sendVerificationSms, SmsProviderError } from './smsProvider.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2_048;
const DATABASE_TIMEOUT_MS = 8_000;

type Action = 'request' | 'verify' | 'status' | 'cancel';
type RequestBody = {
  action?: unknown;
  phone?: unknown;
  code?: unknown;
  challengeId?: unknown;
  idempotencyKey?: unknown;
  operationId?: unknown;
  attemptId?: unknown;
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

class DatabaseTimeoutError extends Error {
  constructor() {
    super('DATABASE_TIMEOUT');
    this.name = 'DatabaseTimeoutError';
  }
}

const runDatabaseRequest = async <T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const operationPromise = Promise.resolve(operation(controller.signal));
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new DatabaseTimeoutError());
      }, DATABASE_TIMEOUT_MS);
    });
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof DatabaseTimeoutError)) {
      throw new DatabaseTimeoutError();
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const readJsonBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new TypeError('CONTENT_TYPE');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RangeError('BODY_TOO_LARGE');
  }
  if (!request.body) throw new TypeError('EMPTY_BODY');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_BODY_BYTES) throw new RangeError('BODY_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const isRequestBody = (value: unknown): value is RequestBody => {
  if (!isPlainObject(value) || !isAction(value.action)) return false;
  if (value.action === 'request') {
    return hasExactKeys(value, ['action', 'phone', 'idempotencyKey'])
      || hasExactKeys(value, ['action', 'phone', 'operationId']);
  }
  if (value.action === 'verify') {
    return hasExactKeys(value, ['action', 'challengeId', 'code'])
      || hasExactKeys(value, ['action', 'operationId', 'attemptId', 'code']);
  }
  if (value.action === 'cancel') {
    return hasExactKeys(value, ['action', 'challengeId'])
      || hasExactKeys(value, ['action', 'operationId']);
  }
  return hasExactKeys(value, ['action'])
    || hasExactKeys(value, ['action', 'operationId'])
    || hasExactKeys(value, ['action', 'operationId', 'attemptId']);
};

const isAction = (value: unknown): value is Action =>
  value === 'request' || value === 'verify' || value === 'status' || value === 'cancel';

const getRequiredSecrets = () => {
  const otpSecret = Deno.env.get('PHONE_OTP_HMAC_SECRET');
  const identitySecret = Deno.env.get('PHONE_IDENTITY_HMAC_SECRET');
  const encryptionKey = Deno.env.get('PHONE_OTP_ENCRYPTION_KEY_B64');
  if (!otpSecret || otpSecret.length < 32 || !identitySecret || identitySecret.length < 32
    || otpSecret === identitySecret || !encryptionKey) {
    return null;
  }
  return { otpSecret, identitySecret, encryptionKey };
};

Deno.serve(async (request) => {
  console.info('[phone-verification] REQUEST_RECEIVED');
  if (request.method !== 'POST') return response({ ok: false, code: 'method_not_allowed' }, 405);
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return response({ ok: false, code: 'invalid_request' }, 415);
  }

  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return response({ ok: false, code: 'authentication_required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secrets = getRequiredSecrets();
  if (!supabaseUrl || !serviceRoleKey || !secrets) {
    console.error('[phone-verification] CONFIGURATION_MISSING');
    return response({ ok: false, code: 'unavailable' }, 503);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let authResult: Awaited<ReturnType<typeof adminClient.auth.getUser>>;
  try {
    authResult = await runDatabaseRequest(() => adminClient.auth.getUser(accessToken));
  } catch {
    console.warn('[phone-verification] AUTHENTICATION_UNAVAILABLE');
    return response({ ok: false, code: 'unavailable' }, 503);
  }
  const { data: authData, error: authError } = authResult;
  if (authError || !authData.user) {
    console.warn('[phone-verification] AUTHENTICATION_FAILED');
    return response({ ok: false, code: 'authentication_required' }, 401);
  }
  const user = authData.user;

  let body: RequestBody;
  try {
    const candidate = await readJsonBody(request);
    if (!isRequestBody(candidate)) return response({ ok: false, code: 'invalid_request' }, 400);
    body = candidate;
  } catch (error) {
    return response(
      { ok: false, code: 'invalid_request' },
      error instanceof RangeError ? 413 : 400,
    );
  }

  try {
    if (body.action === 'request') {
      if (!user.email_confirmed_at) return response({ ok: false, code: 'email_not_verified' }, 403);
      const phone = normalizeE164Phone(body.phone);
      if (!phone) return response({ ok: false, code: 'invalid_phone' }, 400);
      const isV2 = typeof body.operationId === 'string';
      const requestId = isV2 ? body.operationId : body.idempotencyKey;
      if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
        return response({ ok: false, code: 'invalid_request' }, 400);
      }

      const challengeId = isV2 ? requestId : crypto.randomUUID();
      const otp = generateOtp();
      const phoneHmac = await hmacValue(secrets.identitySecret, 'phone', phone);
      const encrypted = await encryptPhone(
        secrets.encryptionKey,
        phone,
        challengeId,
        user.id,
        phoneHmac,
      );
      const otpDigest = await createOtpDigest(
        secrets.otpSecret,
        challengeId,
        user.id,
        phoneHmac,
        otp,
      );
      const encryptedOtp = isV2
        ? await encryptOtpForDelivery(secrets.encryptionKey, otp, challengeId, user.id, phoneHmac)
        : null;
      // IP limiting is supplementary. Enable it only after Development confirms
      // which gateway header cannot be supplied directly by the caller.
      const clientIp = getTrustedClientIp(
        request,
        Deno.env.get('PHONE_OTP_TRUSTED_IP_HEADER'),
      );
      const ipHmac = clientIp
        ? await hmacValue(secrets.identitySecret, 'ip', clientIp)
        : null;
      const createRpc = isV2 ? 'create_phone_verification_challenge_v2' : 'create_phone_verification_challenge';
      const createArgs = isV2 ? {
        target_user_id: user.id,
        target_operation_id: challengeId,
        target_phone_hmac: phoneHmac,
        target_phone_ciphertext: encrypted.ciphertext,
        target_phone_nonce: encrypted.nonce,
        target_otp_digest: otpDigest,
        target_otp_ciphertext: encryptedOtp?.ciphertext,
        target_otp_nonce: encryptedOtp?.nonce,
        target_ip_hmac: ipHmac,
      } : {
          target_user_id: user.id,
          target_challenge_id: challengeId,
          target_phone_hmac: phoneHmac,
          target_phone_ciphertext: encrypted.ciphertext,
          target_phone_nonce: encrypted.nonce,
          target_otp_digest: otpDigest,
          target_idempotency_key: requestId,
          target_ip_hmac: ipHmac,
        };
      const { data: challengeRows, error: challengeError } = await runDatabaseRequest((signal) =>
        adminClient.rpc(createRpc, createArgs).abortSignal(signal));
      if (challengeError) {
        const category = /RATE_LIMITED|COOLDOWN/.test(challengeError.message)
          ? 'rate_limited'
          : 'unavailable';
        console.warn('[phone-verification] REQUEST_REJECTED', { category });
        return response({ ok: false, code: category }, category === 'rate_limited' ? 429 : 503);
      }
      const challenge = Array.isArray(challengeRows) ? challengeRows[0] : null;
      if (!challenge) return response({ ok: false, code: 'unavailable' }, 503);
      const challengeStatus = isV2 ? challenge.operation_status : challenge.challenge_status;
      const returnedChallengeId = isV2 ? challenge.operation_id : challenge.challenge_id;
      const deliveryAttemptId = isV2 ? challenge.delivery_attempt_id : null;
      if (challenge.should_send === true && challengeStatus !== 'DELIVERY_PENDING') {
        return response({ ok: false, code: 'unavailable' }, 503);
      }
      if (challenge.should_send !== true && challengeStatus === 'DELIVERY_PENDING') {
        return response({ ok: true, status: 'delivery_pending', operationId: isV2 ? returnedChallengeId : undefined });
      }
      if (challenge.should_send !== true && challengeStatus !== 'PENDING') {
        return response({ ok: false, code: 'unavailable' }, 503);
      }

      if (challenge.should_send === true) {
        try {
          let deliveryPhone = phone;
          let deliveryOtp = otp;
          if (isV2) {
            if (typeof deliveryAttemptId !== 'string' || !UUID_PATTERN.test(deliveryAttemptId)
              || typeof challenge.persisted_phone_ciphertext !== 'string'
              || typeof challenge.persisted_phone_nonce !== 'string'
              || typeof challenge.persisted_otp_ciphertext !== 'string'
              || typeof challenge.persisted_otp_nonce !== 'string') {
              throw new SmsProviderError('network');
            }
            deliveryPhone = await decryptPhone(
              secrets.encryptionKey, challenge.persisted_phone_ciphertext,
              challenge.persisted_phone_nonce, returnedChallengeId, user.id, phoneHmac,
            );
            deliveryOtp = await decryptOtpForDelivery(
              secrets.encryptionKey, challenge.persisted_otp_ciphertext,
              challenge.persisted_otp_nonce, returnedChallengeId, user.id, phoneHmac,
            );
            if (!isValidE164Phone(deliveryPhone) || !/^\d{6}$/.test(deliveryOtp)) {
              throw new SmsProviderError('network');
            }
          }
          const providerResult = await sendVerificationSms(deliveryPhone, deliveryOtp);
          const providerHash = providerResult.messageReference
            ? await hmacValue(secrets.identitySecret, 'provider-reference', providerResult.messageReference)
            : null;
          const deliveryRpc = isV2 ? 'mark_phone_verification_delivery_v2' : 'mark_phone_verification_delivery';
          const deliveryArgs = isV2 ? {
            target_user_id: user.id,
            target_operation_id: returnedChallengeId,
            target_delivery_attempt_id: deliveryAttemptId,
            delivery_succeeded: true,
            target_provider_reference_hash: providerHash,
            target_error_category: null,
          } : {
              target_user_id: user.id,
              target_challenge_id: returnedChallengeId,
              delivery_succeeded: true,
              target_provider_reference_hash: providerHash,
              target_error_category: null,
            };
          const { data: marked, error: markError } = await runDatabaseRequest((signal) =>
            adminClient.rpc(deliveryRpc, deliveryArgs).abortSignal(signal));
          if (markError || (!isV2 && marked !== true)) throw new SmsProviderError('network');
        } catch (error) {
          const category = error instanceof SmsProviderError ? error.category : 'network';
          await runDatabaseRequest((signal) =>
            adminClient.rpc(isV2 ? 'mark_phone_verification_delivery_v2' : 'mark_phone_verification_delivery', isV2 ? {
              target_user_id: user.id,
              target_operation_id: returnedChallengeId,
              target_delivery_attempt_id: deliveryAttemptId,
              delivery_succeeded: false,
              target_provider_reference_hash: null,
              target_error_category: category,
            } : {
              target_user_id: user.id,
              target_challenge_id: returnedChallengeId,
              delivery_succeeded: false,
              target_provider_reference_hash: null,
              target_error_category: category,
            }).abortSignal(signal)).catch(() => undefined);
          console.warn('[phone-verification] DELIVERY_FAILED', { category });
          return response({ ok: false, code: category === 'not_configured' ? 'provider_not_configured' : 'unavailable' }, 503);
        }
      }

      console.info('[phone-verification] CODE_REQUESTED', { idempotent: challenge.should_send !== true });
      return response({
        ok: true,
        status: 'code_requested',
        challengeId: returnedChallengeId,
        operationId: isV2 ? returnedChallengeId : undefined,
        expiresAt: challenge.challenge_expires_at,
        resendAvailableAt: challenge.challenge_resend_available_at,
      });
    }

    if (body.action === 'verify') {
      const isV2 = typeof body.operationId === 'string';
      const challengeId = isV2 ? body.operationId : body.challengeId;
      if (typeof challengeId !== 'string' || !UUID_PATTERN.test(challengeId)
        || (isV2 && (typeof body.attemptId !== 'string' || !UUID_PATTERN.test(body.attemptId)))
        || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
        return response({ ok: false, code: 'invalid_code' }, 400);
      }
      const { data: challenge, error: challengeError } = await runDatabaseRequest((signal) =>
        adminClient.from('phone_verification_challenges')
          .select('phone_hmac,phone_ciphertext,phone_nonce,otp_digest,status')
          .eq('id', challengeId)
          .eq('user_id', user.id)
          .abortSignal(signal)
          .maybeSingle());
      if (challengeError || !challenge) return response({ ok: false, code: 'invalid_code' }, 400);
      if (!isV2) {
        const { data: v2Operation, error: v2LookupError } = await runDatabaseRequest((signal) =>
          adminClient.from('phone_verification_operations').select('id')
            .eq('id', challengeId).eq('user_id', user.id).abortSignal(signal).maybeSingle());
        if (v2LookupError) return response({ ok: false, code: 'unavailable' }, 503);
        if (v2Operation) return response({ ok: false, code: 'upgrade_required' }, 409);
      }
      if (challenge.status !== 'PENDING') return response({ ok: false, code: 'invalid_code' }, 400);

      const phone = await decryptPhone(
        secrets.encryptionKey,
        challenge.phone_ciphertext,
        challenge.phone_nonce,
        challengeId,
        user.id,
        challenge.phone_hmac,
      );
      if (!isValidE164Phone(phone)) return response({ ok: false, code: 'unavailable' }, 503);
      const candidateDigest = await createOtpDigest(
        secrets.otpSecret,
        challengeId,
        user.id,
        challenge.phone_hmac,
        body.code,
      );
      const verifyRpc = isV2 ? 'verify_phone_verification_challenge_v2' : 'verify_phone_verification_challenge';
      const verifyArgs = isV2 ? {
        target_user_id: user.id,
        target_operation_id: challengeId,
        target_attempt_id: body.attemptId,
        target_candidate_fingerprint: candidateDigest,
        target_phone_hmac: challenge.phone_hmac,
        target_phone_e164: phone,
      } : {
          target_user_id: user.id,
          target_challenge_id: challengeId,
          candidate_matches: constantTimeEqual(candidateDigest, challenge.otp_digest),
          target_phone_hmac: challenge.phone_hmac,
          target_phone_e164: phone,
        };
      const { data: rawVerifyResult, error: verifyError } = await runDatabaseRequest((signal) =>
        adminClient.rpc(verifyRpc, verifyArgs).abortSignal(signal));
      if (verifyError) return response({ ok: false, code: 'unavailable' }, 503);
      const verifyResult = isV2
        ? (Array.isArray(rawVerifyResult) ? rawVerifyResult[0]?.result_code : null)
        : rawVerifyResult;
      if (verifyResult === 'verified' || verifyResult === 'already_verified') {
        console.info('[phone-verification] VERIFICATION_COMPLETED', { idempotent: verifyResult === 'already_verified' });
        return response({ ok: true, status: verifyResult });
      }
      const publicCode = verifyResult === 'locked'
        ? 'invalid_code'
        : verifyResult === 'rate_limited'
          ? 'rate_limited'
          : verifyResult === 'expired'
            ? 'expired'
            : verifyResult === 'phone_unavailable'
              ? 'unavailable'
            : 'invalid_code';
      return response(
        { ok: false, code: publicCode },
        publicCode === 'unavailable' ? 503 : publicCode === 'rate_limited' ? 429 : 400,
      );
    }

    if (body.action === 'cancel') {
      const isV2 = typeof body.operationId === 'string';
      const challengeId = isV2 ? body.operationId : body.challengeId;
      if (typeof challengeId !== 'string' || !UUID_PATTERN.test(challengeId)) {
        return response({ ok: false, code: 'invalid_request' }, 400);
      }
      if (!isV2) {
        const { data: v2Operation, error: v2LookupError } = await runDatabaseRequest((signal) =>
          adminClient.from('phone_verification_operations').select('id')
            .eq('id', challengeId).eq('user_id', user.id).abortSignal(signal).maybeSingle());
        if (v2LookupError) return response({ ok: false, code: 'unavailable' }, 503);
        if (v2Operation) return response({ ok: false, code: 'upgrade_required' }, 409);
      }
      const { error: cancelError } = await runDatabaseRequest((signal) =>
        adminClient.rpc(isV2 ? 'cancel_phone_verification_operation_v2' : 'cancel_phone_verification_challenge', isV2 ? {
          target_user_id: user.id,
          target_operation_id: challengeId,
        } : {
          target_user_id: user.id,
          target_challenge_id: challengeId,
        }).abortSignal(signal));
      if (cancelError) return response({ ok: false, code: 'unavailable' }, 503);
      return response({ ok: true, status: 'not_verified' });
    }

    if (typeof body.operationId === 'string') {
      if (!UUID_PATTERN.test(body.operationId)
        || (body.attemptId !== undefined
          && (typeof body.attemptId !== 'string' || !UUID_PATTERN.test(body.attemptId)))) {
        return response({ ok: false, code: 'invalid_request' }, 400);
      }
      const { data: statusRows, error: statusError } = await runDatabaseRequest((signal) =>
        adminClient.rpc('get_phone_verification_operation_status_v2', {
          target_user_id: user.id,
          target_operation_id: body.operationId,
          target_attempt_id: body.attemptId ?? null,
        }).abortSignal(signal));
      if (statusError) return response({ ok: false, code: 'unavailable' }, 503);
      const status = Array.isArray(statusRows) ? statusRows[0] : null;
      if (!status) return response({ ok: false, code: 'unavailable' }, 503);
      return response({
        ok: true,
        operationId: status.operation_id,
        status: String(status.operation_status).toLowerCase(),
        resultCode: status.result_code,
        attemptResultCode: status.attempt_result_code,
        cleanupCompleted: status.cleanup_completed,
        expiresAt: status.challenge_expires_at,
        resendAvailableAt: status.challenge_resend_available_at,
      });
    }

    const { data: verification, error: verificationError } = await runDatabaseRequest((signal) =>
      adminClient.from('account_verifications')
        .select('phone_verified_at,verification_source')
        .eq('user_id', user.id)
        .abortSignal(signal)
        .maybeSingle());
    if (verificationError) return response({ ok: false, code: 'unavailable' }, 503);
    if (verification?.phone_verified_at && verification.verification_source === 'safemelink_phone_otp') {
      return response({ ok: true, status: 'verified' });
    }
    const { data: latestChallenge, error: latestChallengeError } = await runDatabaseRequest((signal) =>
      adminClient.from('phone_verification_challenges')
        .select('id,status,expires_at,resend_available_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .abortSignal(signal)
        .maybeSingle());
    if (latestChallengeError) return response({ ok: false, code: 'unavailable' }, 503);
    if (latestChallenge?.status === 'PENDING' || latestChallenge?.status === 'DELIVERY_PENDING') {
      if (Date.parse(latestChallenge.expires_at) <= Date.now()) {
        return response({ ok: true, status: 'expired' });
      }
    }
    if (latestChallenge?.status === 'PENDING') {
      return response({
        ok: true,
        status: 'code_requested',
        challengeId: latestChallenge.id,
        expiresAt: latestChallenge.expires_at,
        resendAvailableAt: latestChallenge.resend_available_at,
      });
    }
    if (latestChallenge?.status === 'DELIVERY_PENDING') {
      return response({ ok: true, status: 'delivery_pending' });
    }
    return response({ ok: true, status: latestChallenge?.status === 'EXPIRED' ? 'expired' : 'not_verified' });
  } catch {
    console.error('[phone-verification] REQUEST_FAILED', { category: 'unavailable' });
    return response({ ok: false, code: 'unavailable' }, 503);
  }
});
