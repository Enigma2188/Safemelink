import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type SOSInsert = Database['public']['Tables']['sos']['Insert'];

export const SOSRepository = {
  async create(input: SOSInsert, signal: AbortSignal) {
    if (input.id) {
      const { data, error } = await requireSupabaseClient()
        .rpc('create_my_safety_sos', {
          operation_id: input.id,
          expected_user_id: input.user_id,
          position_latitude: input.latitude,
          position_longitude: input.longitude,
          position_accuracy: input.accuracy ?? null,
          event_time: input.device_time ?? null,
          position_observed_at: input.location_updated_at ?? null,
        }).abortSignal(signal).single();
      if (error) throw new BackendError('Impossibile salvare il SOS remoto.', error);
      return data;
    }
    const { data, error } = await requireSupabaseClient()
      .from('sos')
      .insert(input)
      .select('*')
      .abortSignal(signal)
      .single();

    if (error) {
      throw new BackendError('Impossibile salvare il SOS remoto.', error);
    }

    return data;
  },

  async listOwn() {
    const { data, error } = await requireSupabaseClient()
      .from('sos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new BackendError('Impossibile caricare i SOS remoti.', error);
    }

    return data;
  },
};
