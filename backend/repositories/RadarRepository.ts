import { BackendError } from '@/backend/errors/BackendError';
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

export const RadarRepository = {
  async getPreferences(): Promise<RadarPreferencesRow> {
    const client = requireSupabaseClient();
    const { data, error } = await client.rpc('get_my_radar_preferences').single();

    if (error) {
      throw new BackendError('Impossibile caricare le preferenze Radar.', error);
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
      const message = error.code === '23505'
        ? 'Questo nickname pubblico è già utilizzato.'
        : 'Impossibile salvare le preferenze Radar.';
      throw new BackendError(message, error);
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
      throw new BackendError('Impossibile aggiornare la presenza Radar.', error);
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
      throw new BackendError('Impossibile cercare utenti nelle vicinanze.', error);
    }

    return data ?? [];
  },

  async deactivatePresence() {
    const client = requireSupabaseClient();
    const { error } = await client.rpc('deactivate_my_radar_presence');

    if (error) {
      throw new BackendError('Impossibile disattivare la presenza Radar.', error);
    }
  },
};
