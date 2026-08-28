import { SOSRepository } from '@/backend/repositories/SOSRepository';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import type { ActiveSOSEvent } from '@/services/SOSService';
import { getSOSSessionWithTimeout } from '@/services/SOSSessionTimeout';

export type SOSDeliveryResult = {
  sosCreated: boolean;
  sosId: string | null;
  recipientCount: number;
  tokenCount: number;
  notificationsSent: number;
  notificationsFailed: number;
  trustedRecipientCount?: number;
  nearbyRecipientCount?: number;
  errors: string[];
  expoTicketOkCount?: number;
  expoTicketErrorCount?: number;
  reason?:
    | 'not_authenticated'
    | 'no_eligible_recipients'
    | 'no_linked_recipients'
    | 'recipients_without_active_tokens'
    | 'already_dispatched'
    | 'attempt_in_progress'
    | 'in_progress'
    | 'rate_limited'
    | 'unavailable'
    | 'edge_function_timeout'
    | 'edge_function_unauthorized'
    | 'edge_function_unavailable'
    | 'edge_function_error'
    | 'remote_creation_timeout'
    | 'remote_creation_error';
};

type SOSPushResponse = {
  sent: number;
  failed: number;
  recipientCount?: number;
  tokenCount?: number;
  trustedRecipientCount?: number;
  nearbyRecipientCount?: number;
  errors?: { code?: string; message: string }[];
  expoTicketOkCount?: number;
  expoTicketErrorCount?: number;
  reason?:
    | 'no_eligible_recipients'
    | 'no_linked_recipients'
    | 'recipients_without_active_tokens'
    | 'already_dispatched'
    | 'attempt_in_progress'
    | 'in_progress'
    | 'rate_limited'
    | 'unavailable';
};

const inFlightSOS = new Map<string, Promise<SOSDeliveryResult>>();
const EDGE_FUNCTION_TIMEOUT_MS = 20_000;
const EDGE_FUNCTION_MAX_ATTEMPTS = 2;
const SOS_CREATION_TIMEOUT_MS = 20_000;

export class SOSRemoteCreationTimeoutError extends Error {
  constructor() {
    super('Timeout durante la creazione remota dell\'SOS.');
    this.name = 'SOSRemoteCreationTimeoutError';
  }
}

async function createRemoteSOSWithTimeout(
  input: Parameters<typeof SOSRepository.create>[0],
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      SOSRepository.create(input, controller.signal),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new SOSRemoteCreationTimeoutError());
          controller.abort();
        }, SOS_CREATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function invokeWithTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Timeout chiamata Edge Function send-sos-push.')),
          EDGE_FUNCTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function getInvokeErrorDetails(error: unknown) {
  const details: { category: string; status?: number } = {
    category:
      error instanceof TypeError ? 'network' : error instanceof Error ? error.name : 'unknown',
  };
  const context =
    error && typeof error === 'object' && 'context' in error
      ? (error as { context?: unknown }).context
      : null;

  if (context instanceof Response) {
    details.status = context.status;
  }

  return details;
}

async function sendSOSPush(
  event: ActiveSOSEvent,
  expectedUserId: string,
): Promise<SOSDeliveryResult> {
    const session = await getSOSSessionWithTimeout();

    if (!session || session.user.id !== expectedUserId) {
      return {
        sosCreated: false,
        sosId: null,
        recipientCount: 0,
        tokenCount: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        errors: ['Utente non autenticato: invio push non eseguito.'],
        reason: 'not_authenticated',
      };
    }

    const sos = await createRemoteSOSWithTimeout({
      user_id: session.user.id,
      latitude: event.location.latitude,
      longitude: event.location.longitude,
      accuracy: event.location.accuracy,
      device_time: event.createdAt,
    });

    console.log('[SafeMeLink Push] SOS remoto creato.', {
      outcome: 'success',
    });

    const client = requireSupabaseClient();

    console.log('[SafeMeLink Push] Chiamata Edge Function avviata.', {
      functionName: 'send-sos-push',
      authenticated: true,
    });

    let invokeResult: Awaited<ReturnType<typeof client.functions.invoke<SOSPushResponse>>> | null =
      null;
    let lastInvokeError: unknown = null;

    for (let attempt = 1; attempt <= EDGE_FUNCTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await invokeWithTimeout(
          client.functions.invoke<SOSPushResponse>(
            'send-sos-push',
            {
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
              body: {
                sosId: sos.id,
              },
            },
          ),
        );
        invokeResult = result;
        if (!result.error || attempt === EDGE_FUNCTION_MAX_ATTEMPTS) {
          break;
        }
        console.warn('[SafeMeLink Push] Retry Edge Function programmato.', { attempt });
      } catch (invokeError: unknown) {
        lastInvokeError = invokeError;
        if (attempt < EDGE_FUNCTION_MAX_ATTEMPTS) {
          console.warn('[SafeMeLink Push] Retry Edge Function programmato.', { attempt });
          continue;
        }
      }
    }

    if (!invokeResult) {
      console.error('[SafeMeLink Push] Edge Function senza risposta.', {
        category: lastInvokeError instanceof Error ? lastInvokeError.name : 'UnknownError',
      });
      return {
        sosCreated: true,
        sosId: sos.id,
        recipientCount: 0,
        tokenCount: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        errors: ['Edge Function send-sos-push senza risposta.'],
        reason:
          lastInvokeError instanceof Error && /timeout/i.test(lastInvokeError.message)
            ? 'edge_function_timeout'
            : 'edge_function_unavailable',
      };
    }

    const { data, error } = invokeResult;

    if (error) {
      const errorDetails = getInvokeErrorDetails(error);
      console.error(
        '[SafeMeLink Push] Errore chiamata Edge Function.',
        errorDetails,
      );
      return {
        sosCreated: true,
        sosId: sos.id,
        recipientCount: 0,
        tokenCount: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        errors: ['Errore Edge Function.'],
        reason:
          errorDetails.status === 401
            ? 'edge_function_unauthorized'
            : errorDetails.status === 404
              ? 'edge_function_unavailable'
              : 'edge_function_error',
      };
    }

    console.log('[SafeMeLink Push] Risposta Edge Function ricevuta.', {
      httpStatus: 200,
      recipientCount: data?.recipientCount ?? 0,
      tokenCount: data?.tokenCount ?? 0,
      trustedRecipientCount: data?.trustedRecipientCount ?? 0,
      nearbyRecipientCount: data?.nearbyRecipientCount ?? 0,
      sent: data?.sent ?? 0,
      failed: data?.failed ?? 0,
      reason: data?.reason,
      errorCount: data?.errors?.length ?? 0,
    });
    console.info('[SafeMeLink SOS] SOS_NEARBY_RECIPIENT_COUNT', {
      count: data?.nearbyRecipientCount ?? 0,
    });
    console.info('[SafeMeLink SOS] SOS_DELIVERY_NEARBY_COUNT', {
      count: data?.nearbyRecipientCount ?? 0,
    });
    const recipientSelectionSkipped =
      data?.reason === 'already_dispatched' ||
      data?.reason === 'attempt_in_progress' ||
      data?.reason === 'in_progress' ||
      data?.reason === 'rate_limited' ||
      data?.reason === 'unavailable';
    if (!recipientSelectionSkipped && (data?.nearbyRecipientCount ?? 0) === 0) {
      console.info('[SafeMeLink SOS] SOS_NEARBY_NO_ELIGIBLE_USERS');
    }
    console.info('[SafeMeLink Push] PUSH_TOKEN_COUNT', {
      count: data?.tokenCount ?? 0,
    });
    console.info('[SafeMeLink Push] SOS_DELIVERY_TOKEN_COUNT', {
      count: data?.tokenCount ?? 0,
    });
    console.info('[SafeMeLink Push] PUSH_SENT_COUNT', {
      count: data?.sent ?? 0,
    });
    console.info('[SafeMeLink Push] PUSH_FAILED_COUNT', {
      count: data?.failed ?? 0,
    });
    console.info('[SafeMeLink Push] EXPO_TICKET_OK_COUNT', {
      count: data?.expoTicketOkCount ?? data?.sent ?? 0,
    });
    console.info('[SafeMeLink Push] EXPO_TICKET_ERROR_COUNT', {
      count: data?.expoTicketErrorCount ?? data?.failed ?? 0,
    });
    console.info('[SafeMeLink Push] SOS_DELIVERY_EXPO_ACCEPTED', {
      count: data?.expoTicketOkCount ?? data?.sent ?? 0,
    });
    console.info('[SafeMeLink Push] SOS_DELIVERY_EXPO_REJECTED', {
      count: data?.expoTicketErrorCount ?? data?.failed ?? 0,
    });

    return {
      sosCreated: true,
      sosId: sos.id,
      recipientCount: data?.recipientCount ?? 0,
      tokenCount: data?.tokenCount ?? 0,
      notificationsSent: data?.sent ?? 0,
      notificationsFailed: data?.failed ?? 0,
      expoTicketOkCount: data?.expoTicketOkCount ?? data?.sent ?? 0,
      expoTicketErrorCount: data?.expoTicketErrorCount ?? data?.failed ?? 0,
      trustedRecipientCount: data?.trustedRecipientCount ?? 0,
      nearbyRecipientCount: data?.nearbyRecipientCount ?? 0,
      errors: data?.errors?.map((item) => item.message) ?? [],
      ...(data?.reason ? { reason: data.reason } : {}),
    };
}

export const SOSPushService = {
  async send(event: ActiveSOSEvent, expectedUserId: string) {
    const requestKey = `${expectedUserId}:${event.id}`;
    const existingRequest = inFlightSOS.get(requestKey);

    if (existingRequest) {
      console.log('[SafeMeLink Push] Invocazione duplicata riutilizzata.');
      return existingRequest;
    }

    const request = sendSOSPush(event, expectedUserId).finally(() => {
      inFlightSOS.delete(requestKey);
    });

    inFlightSOS.set(requestKey, request);
    return request;
  },
};
