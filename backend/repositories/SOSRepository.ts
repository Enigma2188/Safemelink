import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type SOSInsert = Database['public']['Tables']['sos']['Insert'];

export const SOSRepository = {
  async create(input: SOSInsert) {
    const { data, error } = await requireSupabaseClient()
      .from('sos')
      .insert(input)
      .select('*')
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
