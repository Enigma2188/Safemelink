import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export const TrustedLinksRepository = {
  async getMyPublicCode() {
    const { data, error } = await requireSupabaseClient().rpc('get_my_public_code');

    if (error || !data) {
      throw new BackendError('Impossibile caricare il codice SafeMeLink.', error);
    }

    return data;
  },

  async listRequests() {
    const { data, error } = await requireSupabaseClient().rpc(
      'list_my_trusted_contact_requests',
    );

    if (error) {
      throw new BackendError('Impossibile caricare le richieste SafeMeLink.', error);
    }

    return data;
  },

  async createRequest(publicCode: string) {
    const { data, error } = await requireSupabaseClient().rpc(
      'create_trusted_contact_request',
      { target_public_code: publicCode },
    );

    if (error || !data) {
      throw new BackendError('Impossibile inviare la richiesta SafeMeLink.', error);
    }

    return data;
  },

  async respond(requestId: string, accept: boolean) {
    const { error } = await requireSupabaseClient().rpc(
      'respond_to_trusted_contact_request',
      {
        target_request_id: requestId,
        accept_request: accept,
      },
    );

    if (error) {
      throw new BackendError('Impossibile aggiornare la richiesta SafeMeLink.', error);
    }
  },

  async cancel(requestId: string) {
    const { error } = await requireSupabaseClient().rpc('cancel_trusted_contact_request', {
      target_request_id: requestId,
    });

    if (error) {
      throw new BackendError('Impossibile annullare la richiesta SafeMeLink.', error);
    }
  },
};
