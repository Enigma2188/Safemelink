import AsyncStorage from '@react-native-async-storage/async-storage';

const HOME_LOCATION_STORAGE_KEY = 'safemelink.gohome.homeLocation';
const GO_HOME_EVENTS_STORAGE_KEY = 'safemelink.gohome.events';
const MAX_STORED_EVENTS = 20;

export type HomeLocation = {
  latitude: number;
  longitude: number;
  savedAt: string;
};

export type GoHomeSession = {
  id: string;
  createdAt: string;
  startLocation: {
    latitude: number;
    longitude: number;
  };
  homeLocation: HomeLocation;
  distanceKm: number;
  estimatedMinutes: number;
};

export type GoHomeEvent = {
  id: string;
  createdAt: string;
  session: GoHomeSession;
  status: 'completed';
};

export const GoHomeStorage = {
  async getHomeLocation(): Promise<HomeLocation | null> {
    const storedLocation = await AsyncStorage.getItem(HOME_LOCATION_STORAGE_KEY);

    if (!storedLocation) {
      return null;
    }

    return JSON.parse(storedLocation) as HomeLocation;
  },

  async saveHomeLocation(location: Pick<HomeLocation, 'latitude' | 'longitude'>) {
    const homeLocation: HomeLocation = {
      ...location,
      savedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(HOME_LOCATION_STORAGE_KEY, JSON.stringify(homeLocation));
    return homeLocation;
  },

  async listEvents(): Promise<GoHomeEvent[]> {
    const storedEvents = await AsyncStorage.getItem(GO_HOME_EVENTS_STORAGE_KEY);

    if (!storedEvents) {
      return [];
    }

    return JSON.parse(storedEvents) as GoHomeEvent[];
  },

  async saveCompleted(session: GoHomeSession) {
    const events = await GoHomeStorage.listEvents();
    const event: GoHomeEvent = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      session,
      status: 'completed',
    };
    const nextEvents = [event, ...events].slice(0, MAX_STORED_EVENTS);

    await AsyncStorage.setItem(GO_HOME_EVENTS_STORAGE_KEY, JSON.stringify(nextEvents));
    return nextEvents;
  },
};
