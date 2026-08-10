import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

const requireResult = <T>(data: T | null, message: string) => {
  if (!data) {
    throw new BackendError(message);
  }

  return data;
};

export const SOSLifecycleRepository = {
  async getStatus(sosId: string) {
    const { data, error } = await requireSupabaseClient()
      .rpc('get_sos_status', { target_sos_id: sosId })
      .maybeSingle();

    if (error) {
      throw new BackendError('Impossibile leggere lo stato aggiornato dell’SOS.', error);
    }

    return requireResult(data, 'SOS non trovato o non autorizzato.');
  },

  async accept(sosId: string) {
    const { data, error } = await requireSupabaseClient()
      .rpc('accept_sos', { target_sos_id: sosId })
      .single();

    if (error) {
      throw new BackendError('Impossibile accettare l’SOS.', error);
    }

    return data;
  },

  async close(sosId: string) {
    const { data, error } = await requireSupabaseClient()
      .rpc('close_my_sos', { target_sos_id: sosId })
      .single();

    if (error) {
      throw new BackendError('Impossibile chiudere l’SOS.', error);
    }

    if (!data) {
      throw new BackendError(
        'La chiusura non ha restituito una risposta valida.',
        undefined,
        'unknown',
        'EMPTY_RPC_RESULT',
      );
    }

    return data;
  },

  async cancel(sosId: string) {
    const { data, error } = await requireSupabaseClient()
      .rpc('cancel_my_sos', { target_sos_id: sosId })
      .single();

    if (error) {
      throw new BackendError('Impossibile annullare l’SOS.', error);
    }

    if (!data) {
      throw new BackendError(
        'L’annullamento non ha restituito una risposta valida.',
        undefined,
        'unknown',
        'EMPTY_RPC_RESULT',
      );
    }

    return data;
  },
};
