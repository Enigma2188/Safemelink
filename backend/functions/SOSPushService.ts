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
    const { data, error } = await requireSupabaseClient().functions.invoke<SOSPushResult>(
      'send-sos-push',
      {
        body: {
          sosId: sos.id,
        },
      },
    );

    if (error) {
      throw new BackendError('Impossibile inviare la notifica SOS remota.', error);
    }

    return data;
  },
};
