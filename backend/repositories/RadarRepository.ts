import { createBackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export type NearbyUserRow = {
  anonymous_id: string;
  public_nickname: string | null;
  distance_meters: number;
  category: 'user' | 'guardian';
  recently_active: boolean;
};

export type RadarPreferencesRow = {
  radar_enabled: boolean;
  visible_to_nearby: boolean;
  show_nickname: boolean;
  public_nickname: string | null;
  preferences_updated_at: string;
};

export type RadarPreferencesUpdate = {
  radarEnabled: boolean;
  visibleToNearby: boolean;
  showNickname: boolean;
  publicNickname: string | null;
};

const radarErrorMessages = {
  backendUnavailable:
    'Il Radar non è ancora disponibile. È necessario aggiornare il servizio SafeMeLink.',
  unauthenticated: 'Sessione scaduta. Accedi di nuovo.',
  forbidden: 'Operazione Radar non autorizzata.',
  network: 'Connessione non disponibile. Controlla la rete e riprova.',
} as const;

const RADAR_REQUEST_TIMEOUT_MS = 12_000;

const runRadarRequest = async <T,>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RADAR_REQUEST_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('La richiesta Radar non risponde. Riprova tra poco.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const RadarRepository = {
  async getPreferences(): Promise<RadarPreferencesRow | null> {
    const client = requireSupabaseClient();
    const { data, error } = await runRadarRequest((signal) =>
      client.rpc('get_my_radar_preferences').abortSignal(signal).maybeSingle(),
    );

    if (error) {
      throw createBackendError(
        'radar.load_preferences',
        {
          ...radarErrorMessages,
          fallback: 'Impossibile caricare le preferenze Radar.',
        },
        error,
      );
    }

    return data;
  },

  async updatePreferences(changes: RadarPreferencesUpdate): Promise<RadarPreferencesRow> {
    const client = requireSupabaseClient();
    const { data, error } = await runRadarRequest((signal) =>
      client.rpc('update_my_radar_preferences', {
        next_radar_enabled: changes.radarEnabled,
        next_visible_to_nearby: changes.visibleToNearby,
        next_show_nickname: changes.showNickname,
        next_public_nickname: changes.publicNickname,
      })
        .abortSignal(signal)
        .single(),
    );

    if (error) {
      throw createBackendError(
        'radar.save_preferences',
        {
          ...radarErrorMessages,
          conflict: 'Questo nickname pubblico è già utilizzato.',
          fallback: 'Impossibile salvare le preferenze Radar.',
        },
        error,
      );
    }

    return data;
  },

  async updatePresence(latitude: number, longitude: number, accuracy: number) {
    const client = requireSupabaseClient();
    const { data, error } = await runRadarRequest((signal) =>
      client
        .rpc('update_my_radar_presence', {
          position_latitude: latitude,
          position_longitude: longitude,
          position_accuracy: accuracy,
        })
        .abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'radar.publish_presence',
        {
          ...radarErrorMessages,
          fallback: 'Impossibile aggiornare la presenza Radar.',
        },
        error,
      );
    }

    return data;
  },

  async findNearby(radiusMeters: number, limit: number): Promise<NearbyUserRow[]> {
    const client = requireSupabaseClient();
    const { data, error } = await runRadarRequest((signal) =>
      client
        .rpc('find_nearby_users', {
          search_radius_meters: radiusMeters,
          result_limit: limit,
        })
        .abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'radar.find_nearby',
        {
          ...radarErrorMessages,
          fallback: 'Impossibile cercare utenti nelle vicinanze.',
        },
        error,
      );
    }

    return data ?? [];
  },

  async deactivatePresence() {
    const client = requireSupabaseClient();
    const { error } = await runRadarRequest((signal) =>
      client.rpc('deactivate_my_radar_presence').abortSignal(signal),
    );

    if (error) {
      throw createBackendError(
        'radar.deactivate_presence',
        {
          ...radarErrorMessages,
          fallback: 'Impossibile disattivare la presenza Radar.',
        },
        error,
      );
    }
  },
};
