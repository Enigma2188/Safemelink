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

export const RadarRepository = {
  async getPreferences(): Promise<RadarPreferencesRow | null> {
    const client = requireSupabaseClient();
    const { data, error } = await client
      .rpc('get_my_radar_preferences')
      .maybeSingle();

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
    const { data, error } = await client
      .rpc('update_my_radar_preferences', {
        next_radar_enabled: changes.radarEnabled,
        next_visible_to_nearby: changes.visibleToNearby,
        next_show_nickname: changes.showNickname,
        next_public_nickname: changes.publicNickname,
      })
      .single();

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
    const { data, error } = await client.rpc('update_my_radar_presence', {
      position_latitude: latitude,
      position_longitude: longitude,
      position_accuracy: accuracy,
    });

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
    const { data, error } = await client.rpc('find_nearby_users', {
      search_radius_meters: radiusMeters,
      result_limit: limit,
    });

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
    const { error } = await client.rpc('deactivate_my_radar_presence');

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
