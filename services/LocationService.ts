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

export const LocationService = {
  async getCurrentLocation(): Promise<SOSLocation> {
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
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch (error) {
      console.warn('[SafeMeLink Location] Acquisizione GPS non riuscita.', error);
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

    return Location.watchPositionAsync(
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
        console.warn('[SafeMeLink Radar] Monitoraggio posizione interrotto.', reason);
        onError(new LocationUnavailableError());
      },
    );
  },
};
