import * as Location from 'expo-location';

export type SOSLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export type LocationWatchSubscription = {
  remove: () => void;
};

export const RADAR_LOCATION_TIME_INTERVAL_MS = 15_000;
export const RADAR_LOCATION_DISTANCE_INTERVAL_METERS = 10;
export const RADAR_WATCH_STARTUP_TIMEOUT_MS = 15_000;
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

export class LocationWatchStartupTimeoutError extends Error {
  constructor() {
    super('Il monitoraggio GPS non si è avviato in tempo. Riprova.');
    this.name = 'LocationWatchStartupTimeoutError';
  }
}

const getCurrentPositionWithTimeout = async (timeoutMs: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
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
  async getCurrentLocation(options?: { timeoutMs?: number }): Promise<SOSLocation> {
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

  async watchRadarLocation(
    onLocation: (location: SOSLocation) => void,
    onError: (error: Error) => void,
  ): Promise<LocationWatchSubscription> {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      throw new LocationPermissionError();
    }

    if (!(await Location.hasServicesEnabledAsync())) {
      throw new LocationUnavailableError();
    }

    console.log('[SafeMeLink Radar] Monitoraggio posizione foreground avviato.', {
      timeIntervalMs: RADAR_LOCATION_TIME_INTERVAL_MS,
      distanceIntervalMeters: RADAR_LOCATION_DISTANCE_INTERVAL_METERS,
    });

    let startupTimedOut = false;
    let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const watchRequest = Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: RADAR_LOCATION_DISTANCE_INTERVAL_METERS,
        timeInterval: RADAR_LOCATION_TIME_INTERVAL_MS,
      },
      (position) => {
        onLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (reason) => {
        console.warn('[SafeMeLink Radar] Monitoraggio posizione interrotto.', {
          category: reason ? 'native_location_error' : 'unknown',
        });
        onError(new LocationUnavailableError());
      },
    );

    void watchRequest
      .then((subscription) => {
        if (startupTimedOut) {
          subscription.remove();
        }
      })
      .catch(() => undefined);

    try {
      return await Promise.race([
        watchRequest,
        new Promise<never>((_, reject) => {
          startupTimeoutId = setTimeout(() => {
            startupTimedOut = true;
            reject(new LocationWatchStartupTimeoutError());
          }, RADAR_WATCH_STARTUP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (startupTimeoutId) {
        clearTimeout(startupTimeoutId);
      }
    }
  },
};
