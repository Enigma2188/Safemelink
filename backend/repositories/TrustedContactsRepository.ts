import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type ContactInsert = Database['public']['Tables']['trusted_contacts']['Insert'];
type ContactUpdate = Database['public']['Tables']['trusted_contacts']['Update'];

export const TrustedContactsRepository = {
  async listOwn() {
    const { data, error } = await requireSupabaseClient()
      .from('trusted_contacts')
      .select('*')
      .order('priority');

    if (error) throw new BackendError('Impossibile caricare i contatti remoti.', error);
    return data;
  },

  async create(input: ContactInsert) {
    const { data, error } = await requireSupabaseClient()
      .from('trusted_contacts')
      .insert(input)
      .select('*')
      .single();

    if (error) throw new BackendError('Impossibile salvare il contatto remoto.', error);
    return data;
  },

  async update(id: string, changes: ContactUpdate) {
    const { data, error } = await requireSupabaseClient()
      .from('trusted_contacts')
      .update(changes)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BackendError('Impossibile aggiornare il contatto remoto.', error);
    return data;
  },

  async remove(id: string) {
    const { error } = await requireSupabaseClient().from('trusted_contacts').delete().eq('id', id);

    if (error) throw new BackendError('Impossibile eliminare il contatto remoto.', error);
  },
};
