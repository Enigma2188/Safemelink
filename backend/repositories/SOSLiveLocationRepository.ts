import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export const SOSLiveLocationRepository = {
  async update(
    sosId: string,
    position: {
      latitude: number;
      longitude: number;
      accuracy: number;
      observedAt: string;
    },
    signal?: AbortSignal,
  ) {
    let query = requireSupabaseClient().rpc(
      'update_my_active_sos_location_result',
      {
        target_sos_id: sosId,
        position_latitude: position.latitude,
        position_longitude: position.longitude,
        position_accuracy: position.accuracy,
        position_observed_at: position.observedAt,
      },
    );
    if (signal) query = query.abortSignal(signal);
    const { data, error, status } = await query;
    if (error) {
      throw new BackendError('Posizione SOS non aggiornata.', { ...error, status });
    }
    if (data !== 'updated' && data !== 'stale' && data !== 'inactive') {
      throw new BackendError('Esito aggiornamento posizione SOS non verificato.');
    }
    return data;
  },
};
