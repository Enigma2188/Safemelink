import type { Database } from '@/backend/database.types';
import { BackendError, classifyBackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type SOSInsert = Database['public']['Tables']['sos']['Insert'];

export const SOSRepository = {
  async findOwnActiveForVoiceRecovery(userId: string) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const query = requireSupabaseClient().from('sos')
        .select('id,user_id,status').eq('user_id', userId).in('status', ['open','accepted'])
        .limit(2).abortSignal(controller.signal);
      const {data, error} = await Promise.race([query, new Promise<never>((_,reject) => {
        timer = setTimeout(() => {controller.abort();reject(new BackendError('Verifica SOS scaduta.'));},5_000);
      })]);
      if (error) throw new BackendError('Stato SOS non verificabile.', error, classifyBackendError(error));
      if (!Array.isArray(data) || data.some(row => row.user_id !== userId || !row.id || !['open','accepted'].includes(row.status))) {
        throw new BackendError('Stato SOS non verificabile.');
      }
      return data;
    } finally { clearTimeout(timer); }
  },
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
