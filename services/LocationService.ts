import * as Location from 'expo-location';

export type SOSLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export const CURRENT_LOCATION_TIMEOUT_MS = 30_000;
export const INTERACTIVE_LOCATION_TIMEOUT_MS = 15_000;

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
  }): Promise<SOSLocation> {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      throw new LocationPermissionError();
    }

    const servicesEnabled = await Location.hasServicesEnabledAsync();

    if (!servicesEnabled) {
      throw new LocationUnavailableError();
    }

    let position: Location.LocationObject;

    try {
      position = await getCurrentPositionWithTimeout(
        options?.timeoutMs ?? CURRENT_LOCATION_TIMEOUT_MS,
        options?.accuracy === 'balanced'
          ? Location.Accuracy.Balanced
          : Location.Accuracy.High,
      );
    } catch (error) {
      console.warn('[SafeMeLink Location] Acquisizione GPS non riuscita.', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      if (error instanceof LocationTimeoutError) {
        throw error;
      }
      throw new LocationUnavailableError();
    }

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  },
};
