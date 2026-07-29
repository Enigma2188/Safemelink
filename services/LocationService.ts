import * as Location from 'expo-location';

export type SOSLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

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
};
