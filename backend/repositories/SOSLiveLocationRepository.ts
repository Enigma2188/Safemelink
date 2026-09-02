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
  ) {
    const { data, error } = await requireSupabaseClient().rpc(
      'update_my_active_sos_location',
      {
        target_sos_id: sosId,
        position_latitude: position.latitude,
        position_longitude: position.longitude,
        position_accuracy: position.accuracy,
        position_observed_at: position.observedAt,
      },
    );
    if (error) {
      throw new BackendError('Posizione SOS non aggiornata.', error);
    }
    return data === true;
  },
};
