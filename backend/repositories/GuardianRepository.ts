import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export const GuardianRepository = {
  async listRelations() {
    const { data, error } = await requireSupabaseClient()
      .from('guardian')
      .select('*');

    if (error) {
      throw new BackendError('Impossibile caricare le relazioni Guardian.', error);
    }

    return data;
  },
};
