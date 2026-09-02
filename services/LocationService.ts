import * as Location from 'expo-location';
import { SOSNetworkLocationStorage } from '@/storage/SOSNetworkLocationStorage';

export type SOSLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export const CURRENT_LOCATION_TIMEOUT_MS = 30_000;
export const INTERACTIVE_LOCATION_TIMEOUT_MS = 15_000;
const SOS_NETWORK_CACHED_LOCATION_MAX_AGE_MS = 10 * 60 * 1_000;
const SOS_NETWORK_CACHED_LOCATION_MAX_ACCURACY_METERS = 100;

export class LocationPermissionError extends Error {
  constructor() {
    super('Autorizzazione posizione non concessa.');
    this.name = 'LocationPermissionError';
  }
}

export class LocationUnavailableError extends Error {
  constructor() {
    super('GPS non disponibile o disattivato. Attivalo e riprova.');
    this.name = 'LocationUnavailableError';
  }
}

export class LocationTimeoutError extends Error {
  constructor() {
    super('La posizione non è arrivata in tempo. Controlla il GPS e riprova.');
    this.name = 'LocationTimeoutError';
  }
}

const getCurrentPositionWithTimeout = async (
  timeoutMs: number,
  accuracy: Location.LocationAccuracy,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy,
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new LocationTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const LocationService = {
  async getCurrentLocation(options?: {
    timeoutMs?: number;
    accuracy?: 'balanced' | 'high';
    allowRecentNetworkLocationForUserId?: string;
  }): Promise<SOSLocation> {
    try {
      const permission = options?.allowRecentNetworkLocationForUserId
        ? await Location.getForegroundPermissionsAsync()
        : await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new LocationPermissionError();
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        throw new LocationUnavailableError();
      }

      const position = await getCurrentPositionWithTimeout(
        options?.timeoutMs ?? CURRENT_LOCATION_TIMEOUT_MS,
        options?.accuracy === 'balanced'
          ? Location.Accuracy.Balanced
          : Location.Accuracy.High,
      );

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
    } catch (error) {
      console.warn('[SafeMeLink Location] Acquisizione GPS non riuscita.', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      const fallbackUserId = options?.allowRecentNetworkLocationForUserId;
      if (fallbackUserId) {
        const cached = await SOSNetworkLocationStorage.get(fallbackUserId).catch(() => null);
        const observedAtMs = cached ? Date.parse(cached.observedAt) : Number.NaN;
        const cachedAgeMs = Date.now() - observedAtMs;
        if (
          cached &&
          Number.isFinite(observedAtMs) &&
          cachedAgeMs >= 0 &&
          cachedAgeMs <= SOS_NETWORK_CACHED_LOCATION_MAX_AGE_MS &&
          cached.accuracy >= 0 &&
          cached.accuracy <= SOS_NETWORK_CACHED_LOCATION_MAX_ACCURACY_METERS
        ) {
          console.info('[SafeMeLink Location] Posizione recente Rete SOS utilizzata.', {
            category: 'recent_network_location',
          });
          return {
            latitude: cached.latitude,
            longitude: cached.longitude,
            accuracy: cached.accuracy,
          };
        }
      }
      if (
        error instanceof LocationTimeoutError ||
        error instanceof LocationPermissionError ||
        error instanceof LocationUnavailableError
      ) {
        throw error;
      }
      throw new LocationUnavailableError();
    }
  },
};
