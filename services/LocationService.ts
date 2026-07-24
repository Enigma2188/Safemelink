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

export const LocationService = {
  async getCurrentLocation(): Promise<SOSLocation> {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      throw new LocationPermissionError();
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  },
};
