import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { runRemoteRequest } from '@/backend/remoteRequest';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type ContactInsert = Database['public']['Tables']['trusted_contacts']['Insert'];
type ContactUpdate = Database['public']['Tables']['trusted_contacts']['Update'];

export const TrustedContactsRepository = {
  async listOwn() {
    const client = requireSupabaseClient();
    const { data, error } = await runRemoteRequest(
      async (signal) => await client
        .from('trusted_contacts')
        .select('*')
        .abortSignal(signal)
        .order('priority'),
      'Il caricamento dei contatti sta impiegando troppo tempo. Controlla la connessione e riprova.',
    );

    if (error) throw new BackendError('Impossibile caricare i contatti remoti.', error);
    return data;
  },

  async create(input: ContactInsert) {
    const client = requireSupabaseClient();
    const { data, error } = await runRemoteRequest(
      async (signal) => await client
        .from('trusted_contacts')
        .insert(input)
        .select('*')
        .abortSignal(signal)
        .single(),
      'Il salvataggio sta impiegando troppo tempo. L’esito remoto non è certo: aggiorna i contatti prima di riprovare.',
    );

    if (error) throw new BackendError('Impossibile salvare il contatto remoto.', error);
    return data;
  },

  async update(id: string, changes: ContactUpdate) {
    const client = requireSupabaseClient();
    const { data, error } = await runRemoteRequest(
      async (signal) => await client
        .from('trusted_contacts')
        .update(changes)
        .eq('id', id)
        .select('*')
        .abortSignal(signal)
        .single(),
      'La modifica sta impiegando troppo tempo. L’esito remoto non è certo: aggiorna i contatti prima di riprovare.',
    );

    if (error) throw new BackendError('Impossibile aggiornare il contatto remoto.', error);
    return data;
  },

  async remove(id: string) {
    const client = requireSupabaseClient();
    const { error } = await runRemoteRequest(
      async (signal) => await client
        .from('trusted_contacts')
        .delete()
        .eq('id', id)
        .abortSignal(signal),
      'L’eliminazione sta impiegando troppo tempo. L’esito remoto non è certo: aggiorna i contatti prima di riprovare.',
    );

    if (error) throw new BackendError('Impossibile eliminare il contatto remoto.', error);
  },
};
