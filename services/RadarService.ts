import type { SOSLocation } from '@/services/LocationService';
import {
  RadarRepository,
  type NearbyUserRow,
  type RadarPreferencesRow,
  type RadarPreferencesUpdate,
} from '@/backend/repositories/RadarRepository';

export const RADAR_REFRESH_INTERVAL_MS = 30_000;
export const RADAR_PRESENCE_UPDATE_INTERVAL_MS = 60_000;
export const RADAR_MIN_MOVEMENT_METERS = 50;
export const RADAR_MAX_ACCURACY_METERS = 100;
export const RADAR_SEARCH_RADIUS_METERS = 1_000;
export const RADAR_RESULT_LIMIT = 25;
export const RADAR_NICKNAME_MIN_LENGTH = 3;
export const RADAR_NICKNAME_MAX_LENGTH = 20;

const RADAR_NICKNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;
const RESERVED_RADAR_NICKNAMES = new Set([
  'admin',
  'administrator',
  'emergenza',
  'guardian',
  'moderator',
  'safemelink',
  'sicurezza',
  'sos',
  'support',
  'system',
]);

export type RadarPresenceSnapshot = {
  location: SOSLocation;
  publishedAt: number;
};

export type NearbyUser = {
  anonymousId: string;
  publicNickname: string | null;
  distanceMeters: number;
  category: 'user' | 'guardian';
  recentlyActive: boolean;
};

export type RadarPreferences = {
  radarEnabled: boolean;
  visibleToNearby: boolean;
  showNickname: boolean;
  publicNickname: string | null;
  updatedAt: string;
};

export type RadarNicknameValidation =
  | { valid: true; normalized: string | null }
  | { valid: false; message: string };

export function canParticipateInRadar(preferences: RadarPreferences | null) {
  return Boolean(preferences?.radarEnabled && preferences.visibleToNearby);
}

export function validateRadarNickname(value: string): RadarNicknameValidation {
  const normalized = value.trim();

  if (!normalized) {
    return { valid: true, normalized: null };
  }

  if (!RADAR_NICKNAME_PATTERN.test(normalized)) {
    return {
      valid: false,
      message: 'Usa da 3 a 20 caratteri: lettere, numeri, trattino o underscore.',
    };
  }

  if (RESERVED_RADAR_NICKNAMES.has(normalized.toLowerCase())) {
    return { valid: false, message: 'Questo nickname è riservato.' };
  }

  return { valid: true, normalized };
}

const normalizePreferences = (row: RadarPreferencesRow): RadarPreferences => ({
  radarEnabled: row.radar_enabled,
  visibleToNearby: row.visible_to_nearby,
  showNickname: row.show_nickname,
  publicNickname: row.public_nickname,
  updatedAt: row.preferences_updated_at,
});

const toRadians = (value: number) => (value * Math.PI) / 180;

export function calculateRadarDistanceMeters(first: SOSLocation, second: SOSLocation) {
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

export function shouldPublishRadarPresence(
  previous: RadarPresenceSnapshot | null,
  current: SOSLocation,
  now = Date.now(),
) {
  if (!previous) {
    return true;
  }

  return (
    now - previous.publishedAt >= RADAR_PRESENCE_UPDATE_INTERVAL_MS ||
    calculateRadarDistanceMeters(previous.location, current) >= RADAR_MIN_MOVEMENT_METERS
  );
}

const normalizeNearbyUsers = (rows: NearbyUserRow[]): NearbyUser[] => {
  const uniqueUsers = new Map<string, NearbyUser>();

  for (const row of rows) {
    if (!row.anonymous_id || uniqueUsers.has(row.anonymous_id)) {
      continue;
    }

    uniqueUsers.set(row.anonymous_id, {
      anonymousId: row.anonymous_id,
      publicNickname:
        typeof row.public_nickname === 'string' && row.public_nickname.length > 0
          ? row.public_nickname
          : null,
      distanceMeters: Math.max(0, Math.round(row.distance_meters)),
      category: row.category === 'guardian' ? 'guardian' : 'user',
      recentlyActive: row.recently_active === true,
    });
  }

  return [...uniqueUsers.values()].sort(
    (first, second) => first.distanceMeters - second.distanceMeters,
  );
};

export const RadarService = {
  async getPreferences() {
    return normalizePreferences(await RadarRepository.getPreferences());
  },

  async updatePreferences(changes: Omit<RadarPreferences, 'updatedAt'>) {
    const nicknameValidation = validateRadarNickname(changes.publicNickname ?? '');

    if (!nicknameValidation.valid) {
      throw new Error(nicknameValidation.message);
    }

    const update: RadarPreferencesUpdate = {
      radarEnabled: changes.radarEnabled,
      visibleToNearby: changes.visibleToNearby,
      showNickname: changes.showNickname,
      publicNickname: nicknameValidation.normalized,
    };

    return normalizePreferences(await RadarRepository.updatePreferences(update));
  },

  isLocationAccurateEnough(location: SOSLocation) {
    return (
      typeof location.accuracy === 'number' &&
      Number.isFinite(location.accuracy) &&
      location.accuracy >= 0 &&
      location.accuracy <= RADAR_MAX_ACCURACY_METERS
    );
  },

  async publishPresence(location: SOSLocation) {
    if (
      !RadarService.isLocationAccurateEnough(location) ||
      typeof location.accuracy !== 'number'
    ) {
      throw new Error('Accuratezza GPS insufficiente per il Radar.');
    }

    return RadarRepository.updatePresence(
      location.latitude,
      location.longitude,
      location.accuracy,
    );
  },

  async findNearbyUsers() {
    const rows = await RadarRepository.findNearby(
      RADAR_SEARCH_RADIUS_METERS,
      RADAR_RESULT_LIMIT,
    );

    return normalizeNearbyUsers(rows);
  },

  async deactivatePresence() {
    await RadarRepository.deactivatePresence();
  },
};
