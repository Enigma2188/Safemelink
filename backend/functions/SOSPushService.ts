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
  errors: string[];
  reason?:
    | 'not_authenticated'
    | 'no_linked_recipients'
    | 'recipients_without_active_tokens';
};

type SOSPushResponse = {
  sent: number;
  failed: number;
  recipientCount?: number;
  tokenCount?: number;
  errors?: { code?: string; message: string }[];
  reason?: 'no_linked_recipients' | 'recipients_without_active_tokens';
};

const inFlightSOS = new Map<string, Promise<SOSDeliveryResult>>();
const EDGE_FUNCTION_TIMEOUT_MS = 20_000;
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

    let invokeResult: Awaited<ReturnType<typeof client.functions.invoke<SOSPushResponse>>>;

    try {
      invokeResult = await invokeWithTimeout(
        client.functions.invoke<SOSPushResponse>(
          'send-sos-push',
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            body: {
              sosId: sos.id,
              senderUserId: session.user.id,
              latitude: sos.latitude,
              longitude: sos.longitude,
            },
          },
        ),
      );
    } catch (invokeError) {
      console.error('[SafeMeLink Push] Edge Function senza risposta.', {
        category: invokeError instanceof Error ? invokeError.name : 'UnknownError',
      });
      return {
        sosCreated: true,
        sosId: sos.id,
        recipientCount: 0,
        tokenCount: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        errors: [
          invokeError instanceof Error
            ? invokeError.message
            : 'Edge Function send-sos-push senza risposta.',
        ],
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
      };
    }

    console.log('[SafeMeLink Push] Risposta Edge Function ricevuta.', {
      httpStatus: 200,
      recipientCount: data?.recipientCount ?? 0,
      tokenCount: data?.tokenCount ?? 0,
      sent: data?.sent ?? 0,
      failed: data?.failed ?? 0,
      reason: data?.reason,
      errorCount: data?.errors?.length ?? 0,
    });

    return {
      sosCreated: true,
      sosId: sos.id,
      recipientCount: data?.recipientCount ?? 0,
      tokenCount: data?.tokenCount ?? 0,
      notificationsSent: data?.sent ?? 0,
      notificationsFailed: data?.failed ?? 0,
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
