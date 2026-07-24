import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import { SOSLifecycleRepository } from '@/backend/repositories/SOSLifecycleRepository';

export const ReceivedSOSRepository = {
  getStatus: SOSLifecycleRepository.getStatus,
  accept: SOSLifecycleRepository.accept,

  async getById(sosId: string) {
    const { data, error } = await requireSupabaseClient()
      .rpc('get_received_sos', { target_sos_id: sosId })
      .single();

    if (error) {
      throw new BackendError('Impossibile caricare il dettaglio SOS.', error);
    }

    return data;
  },
};
