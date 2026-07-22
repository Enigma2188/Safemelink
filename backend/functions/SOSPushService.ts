import { AuthService } from '@/backend/auth/AuthService';
import { BackendError } from '@/backend/errors/BackendError';
import { SOSRepository } from '@/backend/repositories/SOSRepository';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import type { SOSEvent } from '@/services/SOSService';

type SOSPushResult = {
  sent: number;
  failed: number;
  reason?: 'no_active_recipients';
};

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

export const SOSPushService = {
  async send(event: SOSEvent) {
    const session = await AuthService.getSession();

    if (!session) {
      return { sent: 0, failed: 0 } satisfies SOSPushResult;
    }

    const sos = await SOSRepository.create({
      user_id: session.user.id,
      latitude: event.location.latitude,
      longitude: event.location.longitude,
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

    const { data, error } = await client.functions.invoke<SOSPushResult>(
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
      console.error(
        '[SafeMeLink Push] Errore chiamata Edge Function.',
        await getInvokeErrorDetails(error),
      );
      throw new BackendError('Impossibile inviare la notifica SOS remota.', error);
    }

    console.log('[SafeMeLink Push] Risposta Edge Function ricevuta.', {
      sosId: sos.id,
      result: data,
    });

    return data;
  },
};
