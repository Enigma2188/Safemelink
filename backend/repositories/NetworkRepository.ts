import type {
  Database,
  NetworkConfirmationKind,
  NetworkContentReportReason,
  NetworkReportCategory,
} from '@/backend/database.types';
import { createBackendError } from '@/backend/errors/BackendError';
import { runRemoteRequest } from '@/backend/remoteRequest';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import { canonicalizeInternationalPhone } from '@/services/PhoneIdentity';
import { NetworkPhoneVerificationError } from '@/services/NetworkModels';
import { NetworkPhoneVerificationStorage } from '@/storage/NetworkPhoneVerificationStorage';

type FunctionRows<Name extends keyof Database['public']['Functions']> =
  Database['public']['Functions'][Name]['Returns'];

const messages = {
  backendUnavailable: 'NETWORK non è ancora disponibile su questo ambiente.',
  unauthenticated: 'Sessione scaduta. Accedi di nuovo.',
  forbidden: 'Completa i requisiti NETWORK prima di questa operazione.',
  network: 'Connessione non disponibile. Controlla la rete e riprova.',
} as const;

const request = async <T>(operation: (signal: AbortSignal) => PromiseLike<T>) =>
  runRemoteRequest(
    (signal) => Promise.resolve(operation(signal)),
    'NETWORK non risponde. Riprova tra poco.',
  );

const fail = (operation: string, fallback: string, cause: unknown) =>
  createBackendError(operation, { ...messages, fallback }, cause);

const getPhoneErrorDetails = (error: unknown) => {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown; status?: unknown }
    : null;
  return {
    code: typeof value?.code === 'string' ? value.code : '',
    message: typeof value?.message === 'string' ? value.message : '',
    status: typeof value?.status === 'number' ? value.status : null,
  };
};

const toPhoneError = (error: unknown, fallback: string, serverCode?: string) => {
  const details = getPhoneErrorDetails(error);
  if (serverCode === 'invalid_phone') {
    return new NetworkPhoneVerificationError('invalid_phone', 'Inserisci un numero internazionale valido, incluso il prefisso del Paese.');
  }
  if (serverCode === 'invalid_code') {
    return new NetworkPhoneVerificationError('invalid_code', 'Codice non valido. Controllalo e riprova.');
  }
  if (serverCode === 'expired') {
    return new NetworkPhoneVerificationError('expired', 'Il codice è scaduto. Richiedine uno nuovo.');
  }
  if (serverCode === 'provider_not_configured') {
    return new NetworkPhoneVerificationError('provider_not_configured', 'Verifica telefonica non ancora disponibile.');
  }
  if (serverCode === 'rate_limited') {
    return new NetworkPhoneVerificationError('rate_limit', 'Troppi tentativi. Attendi e riprova.');
  }
  if (details.status === 429 || /rate.?limit|too many/i.test(details.message)) {
    return new NetworkPhoneVerificationError('rate_limit', 'Troppi tentativi. Attendi e riprova.');
  }
  if (/invalid.*code|expired|otp/i.test(details.message) || details.code === 'otp_expired') {
    return new NetworkPhoneVerificationError('invalid_code', 'Codice non valido o scaduto.');
  }
  if (/timeout|abort/i.test(details.message)) {
    return new NetworkPhoneVerificationError('timeout', 'La verifica non risponde. Riprova.');
  }
  return new NetworkPhoneVerificationError('unavailable', fallback);
};

const PHONE_REQUEST_TIMEOUT_MS = 15_000;

const runPhoneRequest = async <T>(operation: PromiseLike<T>) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new NetworkPhoneVerificationError('timeout', 'La verifica non risponde. Riprova.')),
          PHONE_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
    return result;
  } catch (error) {
    if (error instanceof NetworkPhoneVerificationError) throw error;
    throw toPhoneError(error, 'Verifica telefonica temporaneamente non disponibile.');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type PhoneFunctionResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  challengeId?: string;
  operationId?: string;
  attemptResultCode?: string;
  cleanupCompleted?: boolean;
  expiresAt?: string;
  resendAvailableAt?: string;
};

const getFunctionErrorCode = async (error: unknown) => {
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : null;
  if (!(context instanceof Response)) return undefined;
  try {
    const body = await context.clone().json() as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
};

const invokePhoneVerification = async (body: Record<string, unknown>, accessToken: string) => {
  const client = requireSupabaseClient();
  const { data, error } = await runPhoneRequest(
    client.functions.invoke<PhoneFunctionResponse>('phone-verification', {
      body,
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
  if (error) {
    throw toPhoneError(
      error,
      'Verifica telefonica temporaneamente non disponibile.',
      await getFunctionErrorCode(error),
    );
  }
  if (!data?.ok) {
    throw toPhoneError(null, 'Verifica telefonica temporaneamente non disponibile.', data?.code);
  }
  return data;
};

const createIdempotencyKey = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const getCurrentAuthContext = async () => {
  const client = requireSupabaseClient();
  const { data: sessionData, error: sessionError } = await runPhoneRequest(client.auth.getSession());
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new NetworkPhoneVerificationError('unavailable', 'Sessione scaduta. Accedi di nuovo.');
  }
  const { data, error } = await runPhoneRequest(client.auth.getUser(accessToken));
  if (error || !data.user) {
    throw new NetworkPhoneVerificationError('unavailable', 'Sessione scaduta. Accedi di nuovo.');
  }
  return { userId: data.user.id, accessToken };
};

const requireChallengeOwner = async (expectedUserId: string) => {
  if ((await getCurrentAuthContext()).userId !== expectedUserId) {
    throw new NetworkPhoneVerificationError(
      'account_changed',
      'L’account è cambiato durante la verifica. Avvia una nuova verifica.',
    );
  }
};

export const NetworkRepository = {
  async getOnboardingStatus(): Promise<FunctionRows<'get_my_network_onboarding_status'>[number]> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('get_my_network_onboarding_status').abortSignal(signal).single(),
    );
    if (error) throw fail('network.onboarding_status', 'Impossibile verificare i requisiti NETWORK.', error);
    return data;
  },

  async updateIdentity(input: { firstName: string; lastName: string; nickname: string; phone: string }) {
    const client = requireSupabaseClient();
    const { error } = await request((signal) => client.rpc('update_my_network_identity', {
      target_first_name: input.firstName,
      target_last_name: input.lastName,
      target_nickname: input.nickname,
      target_phone: input.phone,
    }).abortSignal(signal));
    if (error) throw fail('network.update_identity', 'Impossibile aggiornare i requisiti NETWORK.', error);
  },

  async startPhoneVerification(phone: string) {
    const normalizedPhone = canonicalizeInternationalPhone(phone);
    if (!normalizedPhone || !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      throw new NetworkPhoneVerificationError(
        'invalid_phone',
        'Inserisci un numero internazionale valido, incluso il prefisso del Paese.',
      );
    }
    const { userId, accessToken } = await getCurrentAuthContext();
    const stored = await NetworkPhoneVerificationStorage.load(userId);
    const pending = stored?.expiresAt && Date.parse(stored.expiresAt) <= Date.now() ? null : stored;
    if (stored && !pending) await NetworkPhoneVerificationStorage.clear(userId);
    const operationId = pending?.operationId ?? createIdempotencyKey();
    await NetworkPhoneVerificationStorage.save(userId, { operationId });
    let result: PhoneFunctionResponse;
    try {
      result = await invokePhoneVerification({
        action: 'request', phone: normalizedPhone, operationId,
      }, accessToken);
    } catch (error) {
      if (!(error instanceof NetworkPhoneVerificationError) || error.code !== 'timeout') {
        await NetworkPhoneVerificationStorage.clear(userId);
      }
      throw error;
    }
    try {
      await requireChallengeOwner(userId);
    } catch (error) {
      if (result.challengeId) {
        await invokePhoneVerification(
          { action: 'cancel', operationId: result.challengeId },
          accessToken,
        ).catch(() => undefined);
      }
      await NetworkPhoneVerificationStorage.clear(userId);
      throw error;
    }
    if (result.status !== 'code_requested' || !result.challengeId
      || !result.expiresAt || !result.resendAvailableAt) {
      throw new NetworkPhoneVerificationError('unavailable', 'Impossibile avviare la verifica telefonica.');
    }
    await NetworkPhoneVerificationStorage.save(userId, {
      operationId,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
    return {
      userId,
      challengeId: result.challengeId,
      operationId,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    };
  },

  async completePhoneVerification(input: {
    userId: string;
    challengeId: string;
    code: string;
  }) {
    const auth = await getCurrentAuthContext();
    if (auth.userId !== input.userId) {
      throw new NetworkPhoneVerificationError('account_changed', 'L’account è cambiato durante la verifica. Avvia una nuova verifica.');
    }
    const pending = await NetworkPhoneVerificationStorage.load(input.userId);
    const operationId = pending?.operationId ?? input.challengeId;
    const attemptId = pending?.pendingAttemptId ?? createIdempotencyKey();
    await NetworkPhoneVerificationStorage.save(input.userId, {
      operationId,
      expiresAt: pending?.expiresAt,
      resendAvailableAt: pending?.resendAvailableAt,
      pendingAttemptId: attemptId,
    });
    let result: PhoneFunctionResponse;
    try {
      result = await invokePhoneVerification({
        action: 'verify', operationId, attemptId, code: input.code,
      }, auth.accessToken);
    } catch (error) {
      if (!(error instanceof NetworkPhoneVerificationError) || error.code !== 'timeout') {
        await NetworkPhoneVerificationStorage.save(input.userId, {
          operationId,
          expiresAt: pending?.expiresAt,
          resendAvailableAt: pending?.resendAvailableAt,
        });
      }
      throw error;
    }
    await requireChallengeOwner(input.userId);
    if (result.status !== 'verified' && result.status !== 'already_verified') {
      throw new NetworkPhoneVerificationError('unavailable', 'Verifica telefonica non confermata.');
    }
    await NetworkPhoneVerificationStorage.clear(input.userId);
    return result.status;
  },

  async getPhoneVerificationStatus() {
    const { userId, accessToken } = await getCurrentAuthContext();
    const pending = await NetworkPhoneVerificationStorage.load(userId);
    const result = await invokePhoneVerification(pending ? {
      action: 'status',
      operationId: pending.operationId,
      ...(pending.pendingAttemptId ? { attemptId: pending.pendingAttemptId } : {}),
    } : { action: 'status' }, accessToken);
    await requireChallengeOwner(userId);
    const recoveredExpiresAt = result.expiresAt ?? pending?.expiresAt;
    const recoveredResendAt = result.resendAvailableAt ?? pending?.resendAvailableAt;
    if (pending && result.status === 'pending' && recoveredExpiresAt && recoveredResendAt) {
      await NetworkPhoneVerificationStorage.save(userId, {
        operationId: pending.operationId,
        expiresAt: recoveredExpiresAt,
        resendAvailableAt: recoveredResendAt,
        pendingAttemptId: pending.pendingAttemptId,
      });
      return {
        status: 'code_requested', userId, challengeId: pending.operationId,
        operationId: pending.operationId, expiresAt: recoveredExpiresAt,
        resendAvailableAt: recoveredResendAt,
      } as const;
    }
    if (result.status === 'code_requested' && result.challengeId
      && result.expiresAt && result.resendAvailableAt) {
      return {
        status: result.status,
        userId,
        challengeId: result.challengeId,
        expiresAt: result.expiresAt,
        resendAvailableAt: result.resendAvailableAt,
      } as const;
    }
    if (pending && (result.status === 'completed' || result.status === 'cancelled'
      || result.status === 'failed' || result.status === 'delivery_failed')) {
      await NetworkPhoneVerificationStorage.clear(userId);
      return { status: result.status === 'completed' ? 'verified' : 'not_verified' } as const;
    }
    if (result.status === 'verified' || result.status === 'already_verified'
      || result.status === 'delivery_pending' || result.status === 'expired'
      || result.status === 'not_verified') {
      return { status: result.status } as const;
    }
    throw new NetworkPhoneVerificationError('unavailable', 'Impossibile recuperare la verifica telefonica.');
  },

  async cancelPhoneVerification(userId: string, challengeId: string) {
    const auth = await getCurrentAuthContext();
    if (auth.userId !== userId) {
      throw new NetworkPhoneVerificationError('account_changed', 'L’account è cambiato durante la verifica. Avvia una nuova verifica.');
    }
    const pending = await NetworkPhoneVerificationStorage.load(userId);
    await invokePhoneVerification({
      action: 'cancel', operationId: pending?.operationId ?? challengeId,
    }, auth.accessToken);
    await NetworkPhoneVerificationStorage.clear(userId);
    await requireChallengeOwner(userId);
  },

  async acceptTerms(termsVersion: string, feedRadiusMeters: number) {
    const client = requireSupabaseClient();
    const { error } = await request((signal) =>
      client.rpc('accept_network_terms', {
        target_terms_version: termsVersion,
        target_feed_radius_meters: feedRadiusMeters,
      }).abortSignal(signal),
    );
    if (error) throw fail('network.accept_terms', 'Impossibile accettare ora le regole NETWORK.', error);
  },

  async getFeedRadius() {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('get_my_network_feed_radius').abortSignal(signal),
    );
    if (error) throw fail('network.get_feed_radius', 'Impossibile caricare il raggio NETWORK.', error);
    return data;
  },

  async setFeedRadius(feedRadiusMeters: number) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('set_my_network_feed_radius', {
        target_feed_radius_meters: feedRadiusMeters,
      }).abortSignal(signal),
    );
    if (error) throw fail('network.set_feed_radius', 'Impossibile aggiornare il raggio NETWORK.', error);
    return data;
  },

  async listFeed(input: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    pageSize: number;
    cursor?: { statusBucket: 0 | 1; createdAt: string; reportId: string } | null;
  }): Promise<FunctionRows<'list_nearby_network_reports'>> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('list_nearby_network_reports', {
        viewer_latitude: input.latitude,
        viewer_longitude: input.longitude,
        radius_meters: input.radiusMeters,
        requested_page_size: input.pageSize,
        cursor_status_bucket: input.cursor?.statusBucket ?? null,
        cursor_created_at: input.cursor?.createdAt ?? null,
        cursor_report_id: input.cursor?.reportId ?? null,
      }).abortSignal(signal),
    );
    if (error) throw fail('network.list_feed', 'Impossibile caricare le segnalazioni vicine.', error);
    return data ?? [];
  },

  async createReport(input: {
    category: NetworkReportCategory;
    description: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
  }): Promise<FunctionRows<'create_network_report'>[number]> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('create_network_report', {
        target_category: input.category,
        target_description: input.description,
        target_latitude: input.latitude,
        target_longitude: input.longitude,
        target_accuracy: input.accuracy,
      }).abortSignal(signal).single(),
    );
    if (error) throw fail('network.create_report', 'Impossibile pubblicare la segnalazione.', error);
    return data;
  },

  async getReport(reportId: string): Promise<FunctionRows<'get_network_report'>[number] | null> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('get_network_report', { target_report_id: reportId }).abortSignal(signal).maybeSingle(),
    );
    if (error) throw fail('network.get_report', 'Segnalazione non disponibile.', error);
    return data;
  },

  async respond(reportId: string, kind: NetworkConfirmationKind) {
    const client = requireSupabaseClient();
    const { error } = await request((signal) =>
      client.rpc('respond_to_network_report', {
        target_report_id: reportId,
        target_kind: kind,
      }).abortSignal(signal),
    );
    if (error) throw fail('network.respond', 'Impossibile registrare la risposta.', error);
  },

  async addUpdate(reportId: string, body: string) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('add_network_report_update', {
        target_report_id: reportId,
        target_body: body,
      }).abortSignal(signal),
    );
    if (error) throw fail('network.add_update', 'Impossibile pubblicare l’aggiornamento.', error);
    return data;
  },

  async resolve(reportId: string) {
    const client = requireSupabaseClient();
    const { error } = await request((signal) =>
      client.rpc('resolve_my_network_report', { target_report_id: reportId }).abortSignal(signal),
    );
    if (error) throw fail('network.resolve', 'Impossibile risolvere la segnalazione.', error);
  },

  async reportContent(input: {
    reportId?: string | null;
    updateId?: string | null;
    reason: NetworkContentReportReason;
    details?: string | null;
  }) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('report_network_content', {
        target_report_id: input.reportId ?? null,
        target_update_id: input.updateId ?? null,
        target_reason: input.reason,
        target_details: input.details ?? null,
      }).abortSignal(signal),
    );
    if (error) throw fail('network.report_content', 'Impossibile inviare la segnalazione.', error);
    return data;
  },
};
