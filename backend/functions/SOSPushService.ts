import { AuthService } from '@/backend/auth/AuthService';
import { SOSRepository } from '@/backend/repositories/SOSRepository';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import type { ActiveSOSEvent } from '@/services/SOSService';

export type SOSDeliveryResult = {
  sosCreated: boolean;
  sosId: string | null;
  recipientCount: number;
  tokenCount: number;
  notificationsSent: number;
  notificationsFailed: number;
  errors: string[];
  reason?: 'not_authenticated' | 'no_active_recipients';
};

type SOSPushResponse = {
  sent: number;
  failed: number;
  recipientCount?: number;
  tokenCount?: number;
  errors?: { code?: string; message: string }[];
  reason?: 'no_active_recipients';
};

const inFlightSOS = new Map<string, Promise<SOSDeliveryResult>>();

async function getInvokeErrorDetails(error: unknown) {
  const details: Record<string, unknown> = {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  };
  const context =
    error && typeof error === 'object' && 'context' in error
      ? (error as { context?: unknown }).context
      : null;

  if (context instanceof Response) {
    details.status = context.status;
    details.statusText = context.statusText;

    try {
      details.body = await context.clone().text();
    } catch {
      details.body = 'Risposta non leggibile.';
    }
  }

  return details;
}

async function sendSOSPush(
  event: ActiveSOSEvent,
  expectedUserId: string,
): Promise<SOSDeliveryResult> {
    const session = await AuthService.getSession();

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

    const sos = await SOSRepository.create({
      user_id: session.user.id,
      latitude: event.location.latitude,
      longitude: event.location.longitude,
      accuracy: event.location.accuracy,
      device_time: event.createdAt,
    });

    console.log('[SafeMeLink Push] SOS remoto creato.', {
      sosId: sos.id,
      senderUserId: session.user.id,
    });

    const client = requireSupabaseClient();

    console.log('[SafeMeLink Push] Chiamata Edge Function avviata.', {
      functionName: 'send-sos-push',
      sosId: sos.id,
      hasAccessToken: session.access_token.length > 0,
    });

    const { data, error } = await client.functions.invoke<SOSPushResponse>(
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
    );

    if (error) {
      const errorDetails = await getInvokeErrorDetails(error);
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
        errors: [String(errorDetails.message ?? 'Errore Edge Function.')],
      };
    }

    console.log('[SafeMeLink Push] Risposta Edge Function ricevuta.', {
      sosId: sos.id,
      result: data,
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
      console.log('[SafeMeLink Push] Invocazione duplicata riutilizzata.', {
        eventId: event.id,
      });
      return existingRequest;
    }

    const request = sendSOSPush(event, expectedUserId).finally(() => {
      inFlightSOS.delete(requestKey);
    });

    inFlightSOS.set(requestKey, request);
    return request;
  },
};
