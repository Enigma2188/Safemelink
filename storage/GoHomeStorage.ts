import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

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
  async getHomeLocation(userId: string): Promise<HomeLocation | null> {
    const storedLocation = await getAccountStorageItem(
      userId,
      'go-home-location',
      [HOME_LOCATION_STORAGE_KEY],
    );

    if (!storedLocation) {
      return null;
    }

    return JSON.parse(storedLocation) as HomeLocation;
  },

  async saveHomeLocation(
    userId: string,
    location: Pick<HomeLocation, 'latitude' | 'longitude'>,
  ) {
    const homeLocation: HomeLocation = {
      ...location,
      savedAt: new Date().toISOString(),
    };

    await setAccountStorageItem(
      userId,
      'go-home-location',
      JSON.stringify(homeLocation),
      [HOME_LOCATION_STORAGE_KEY],
    );
    return homeLocation;
  },

  async listEvents(userId: string): Promise<GoHomeEvent[]> {
    const storedEvents = await getAccountStorageItem(
      userId,
      'go-home-events',
      [GO_HOME_EVENTS_STORAGE_KEY],
    );

    if (!storedEvents) {
      return [];
    }

    return JSON.parse(storedEvents) as GoHomeEvent[];
  },

  async saveCompleted(userId: string, session: GoHomeSession) {
    const events = await GoHomeStorage.listEvents(userId);
    const event: GoHomeEvent = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      session,
      status: 'completed',
    };
    const nextEvents = [event, ...events].slice(0, MAX_STORED_EVENTS);

    await setAccountStorageItem(
      userId,
      'go-home-events',
      JSON.stringify(nextEvents),
      [GO_HOME_EVENTS_STORAGE_KEY],
    );
    return nextEvents;
  },
};
