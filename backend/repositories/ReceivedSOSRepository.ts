import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import { SOSLifecycleRepository } from '@/backend/repositories/SOSLifecycleRepository';

const RECEIVED_SOS_REQUEST_TIMEOUT_MS = 12_000;

export class ReceivedSOSRequestTimeoutError extends Error {
  constructor() {
    super('Il dettaglio SOS non risponde. Controlla la rete e riprova.');
    this.name = 'ReceivedSOSRequestTimeoutError';
  }
}

export const ReceivedSOSRepository = {
  getStatus: SOSLifecycleRepository.getStatus,
  accept: SOSLifecycleRepository.accept,

  async getById(sosId: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      RECEIVED_SOS_REQUEST_TIMEOUT_MS,
    );

    try {
      const { data, error } = await requireSupabaseClient()
        .rpc('get_received_sos', { target_sos_id: sosId })
        .abortSignal(controller.signal)
        .single();

      if (error) {
        throw new BackendError('Impossibile caricare il dettaglio SOS.', error);
      }

      return data;
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        throw new ReceivedSOSRequestTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
