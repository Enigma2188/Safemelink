import { createBackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export type SOSNetworkPresenceSource = 'foreground' | 'background';

export type SOSNetworkPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  observedAt: string;
  source: SOSNetworkPresenceSource;
};

const REQUEST_TIMEOUT_MS = 12_000;

export class SOSNetworkPresenceTimeoutError extends Error {
  constructor() {
    super('La rete SOS non risponde. Riprova tra poco.');
    this.name = 'SOSNetworkPresenceTimeoutError';
  }
}

const runRequest = async <T,>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SOSNetworkPresenceTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const messages = {
  backendUnavailable: 'La disponibilità alla rete SOS richiede un aggiornamento del servizio.',
  unauthenticated: 'Sessione non disponibile. Accedi di nuovo.',
  forbidden: 'Operazione rete SOS non autorizzata.',
  network: 'Connessione non disponibile. Riprova quando torni online.',
} as const;

export const SOSNetworkPresenceRepository = {
  async getPreference() {
    const client = requireSupabaseClient();
    const { data, error } = await runRequest((signal) =>
      client.rpc('get_my_sos_network_preference').abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'sos_network.load_preference',
        { ...messages, fallback: 'Impossibile caricare la disponibilità alla rete SOS.' },
        error,
      );
    }

    return data === true;
  },

  async updatePreference(enabled: boolean) {
    const client = requireSupabaseClient();
    const { data, error } = await runRequest((signal) =>
      client
        .rpc('update_my_sos_network_preference', { next_enabled: enabled })
        .abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'sos_network.save_preference',
        { ...messages, fallback: 'Impossibile aggiornare la disponibilità alla rete SOS.' },
        error,
      );
    }

    return data === true;
  },

  async updatePresence(position: SOSNetworkPosition) {
    const client = requireSupabaseClient();
    const { data, error } = await runRequest((signal) =>
      client
        .rpc('update_my_sos_network_presence', {
          position_latitude: position.latitude,
          position_longitude: position.longitude,
          position_accuracy: position.accuracy,
          position_observed_at: position.observedAt,
          update_source: position.source,
        })
        .abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'sos_network.publish_presence',
        { ...messages, fallback: 'Impossibile aggiornare la presenza nella rete SOS.' },
        error,
      );
    }

    return data;
  },

  async deactivatePresence() {
    const client = requireSupabaseClient();
    const { error } = await runRequest((signal) =>
      client.rpc('deactivate_my_sos_network_presence').abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'sos_network.deactivate_presence',
        { ...messages, fallback: 'Impossibile disattivare la presenza nella rete SOS.' },
        error,
      );
    }
  },
};
