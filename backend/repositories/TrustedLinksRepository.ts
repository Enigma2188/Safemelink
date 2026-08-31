import { BackendError } from '@/backend/errors/BackendError';
import { runRemoteRequest } from '@/backend/remoteRequest';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export const TrustedLinksRepository = {
  async getMyPublicCode() {
    const client = requireSupabaseClient();
    const { data, error } = await runRemoteRequest(
      async (signal) => await client.rpc('get_my_public_code').abortSignal(signal),
      'Il caricamento del codice sta impiegando troppo tempo. Riprova.',
    );

    if (error || !data) {
      throw new BackendError('Impossibile caricare il codice SafeMeLink.', error);
    }

    return data;
  },

  async listRequests() {
    const client = requireSupabaseClient();
    const { data, error } = await runRemoteRequest(
      async (signal) => await client
        .rpc('list_my_trusted_contact_requests')
        .abortSignal(signal),
      'Il caricamento delle richieste sta impiegando troppo tempo. Riprova.',
    );

    if (error) {
      throw new BackendError('Impossibile caricare le richieste SafeMeLink.', error);
    }

    return data;
  },

  async createRequest(publicCode: string) {
    const client = requireSupabaseClient();
    const { data, error } = await runRemoteRequest(
      async (signal) => await client.rpc('create_trusted_contact_request', {
        target_public_code: publicCode,
      }).abortSignal(signal),
      'L’invio sta impiegando troppo tempo. L’esito remoto non è certo: aggiorna le richieste prima di riprovare.',
    );

    if (error || !data) {
      throw new BackendError('Impossibile inviare la richiesta SafeMeLink.', error);
    }

    return data;
  },

  async respond(requestId: string, accept: boolean) {
    const client = requireSupabaseClient();
    const { error } = await runRemoteRequest(
      async (signal) => await client.rpc('respond_to_trusted_contact_request', {
        target_request_id: requestId,
        accept_request: accept,
      }).abortSignal(signal),
      'La risposta sta impiegando troppo tempo. L’esito remoto non è certo: aggiorna le richieste prima di riprovare.',
    );

    if (error) {
      throw new BackendError('Impossibile aggiornare la richiesta SafeMeLink.', error);
    }
  },

  async cancel(requestId: string) {
    const client = requireSupabaseClient();
    const { error } = await runRemoteRequest(
      async (signal) => await client.rpc('cancel_trusted_contact_request', {
        target_request_id: requestId,
      }).abortSignal(signal),
      'L’annullamento sta impiegando troppo tempo. L’esito remoto non è certo: aggiorna le richieste prima di riprovare.',
    );

    if (error) {
      throw new BackendError('Impossibile annullare la richiesta SafeMeLink.', error);
    }
  },
};
