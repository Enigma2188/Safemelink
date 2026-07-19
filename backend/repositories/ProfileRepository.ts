import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export const ProfileRepository = {
  async getCurrent() {
    const client = requireSupabaseClient();
    const { data: authData, error: authError } = await client.auth.getUser();

    if (authError || !authData.user) {
      throw new BackendError('Utente non autenticato.', authError);
    }

    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (error) {
      throw new BackendError('Impossibile caricare il profilo.', error);
    }

    return data;
  },

  async updateCurrent(changes: ProfileUpdate) {
    const client = requireSupabaseClient();
    const { data: authData, error: authError } = await client.auth.getUser();

    if (authError || !authData.user) {
      throw new BackendError('Utente non autenticato.', authError);
    }

    const { data, error } = await client
      .from('profiles')
      .update(changes)
      .eq('id', authData.user.id)
      .select('*')
      .single();

    if (error) {
      throw new BackendError('Impossibile aggiornare il profilo.', error);
    }

    return data;
  },
};
