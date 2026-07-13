import * as Location from 'expo-location';

export type SOSLocation = {
  latitude: number;
  longitude: number;
};

export const LocationService = {
  async getCurrentLocation(): Promise<SOSLocation> {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      throw new Error('Autorizzazione posizione non concessa.');
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  },
};
