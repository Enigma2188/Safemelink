import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const HOME_LOCATION_STORAGE_KEY = 'safemelink.gohome.homeLocation';
const GO_HOME_EVENTS_STORAGE_KEY = 'safemelink.gohome.events';
const GO_HOME_TRANSPORT_MODE_STORAGE_KEY = 'safemelink.gohome.transportMode';
const MAX_STORED_EVENTS = 20;

export type HomeLocation = {
  latitude: number;
  longitude: number;
  savedAt: string;
};

export type GoHomeTransportMode = 'walking' | 'cycling' | 'driving';

const isGoHomeTransportMode = (value: string): value is GoHomeTransportMode =>
  value === 'walking' || value === 'cycling' || value === 'driving';

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
  transportMode: GoHomeTransportMode;
};

export type GoHomeEvent = {
  id: string;
  createdAt: string;
  session: GoHomeSession;
  status: 'completed';
};

export const GoHomeStorage = {
  async getTransportMode(userId: string): Promise<GoHomeTransportMode> {
    const storedMode = await getAccountStorageItem(
      userId,
      'go-home-transport-mode',
      [GO_HOME_TRANSPORT_MODE_STORAGE_KEY],
    );

    return storedMode && isGoHomeTransportMode(storedMode) ? storedMode : 'walking';
  },

  async saveTransportMode(userId: string, mode: GoHomeTransportMode) {
    await setAccountStorageItem(
      userId,
      'go-home-transport-mode',
      mode,
      [GO_HOME_TRANSPORT_MODE_STORAGE_KEY],
    );
  },

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

    const events = JSON.parse(storedEvents) as GoHomeEvent[];
    return events.map((event) => ({
      ...event,
      session: {
        ...event.session,
        transportMode: isGoHomeTransportMode(event.session.transportMode)
          ? event.session.transportMode
          : 'walking',
      },
    }));
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
