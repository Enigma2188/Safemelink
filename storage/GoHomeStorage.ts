import {
  getAccountStorageItem,
  removeAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const ACTIVE_GO_HOME_STORAGE_KEY = 'safemelink.gohome.active';
const HOME_LOCATION_STORAGE_KEY = 'safemelink.gohome.homeLocation';
const GO_HOME_EVENTS_STORAGE_KEY = 'safemelink.gohome.events';
const GO_HOME_TRANSPORT_MODE_STORAGE_KEY = 'safemelink.gohome.transportMode';
const MAX_STORED_EVENTS = 20;
const homeLocationRevisions = new Map<string, number>();

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

export type ActiveGoHomeSession = Omit<GoHomeSession, 'homeLocation' | 'startLocation'> & {
  active: true;
  expiresAt: string;
  startedAt: string;
};

export type GoHomeEvent = {
  id: string;
  createdAt: string;
  session: ActiveGoHomeSession | GoHomeSession;
  status: 'completed';
};

const isActiveGoHomeSession = (value: unknown): value is ActiveGoHomeSession => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ActiveGoHomeSession>;
  const createdAtMs = Date.parse(candidate.createdAt ?? '');
  const startedAtMs = Date.parse(candidate.startedAt ?? '');
  const expiresAtMs = Date.parse(candidate.expiresAt ?? '');
  return (
    candidate.active === true &&
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    Number.isFinite(createdAtMs) &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > startedAtMs &&
    Number.isFinite(candidate.distanceKm) &&
    (candidate.distanceKm ?? -1) >= 0 &&
    Number.isInteger(candidate.estimatedMinutes) &&
    (candidate.estimatedMinutes ?? 0) > 0 &&
    typeof candidate.transportMode === 'string' &&
    isGoHomeTransportMode(candidate.transportMode)
  );
};

export const GoHomeStorage = {
  getHomeLocationRevision(userId: string) { return homeLocationRevisions.get(userId) ?? 0; },
  async getActive(userId: string): Promise<ActiveGoHomeSession | null> {
    const storedSession = await getAccountStorageItem(
      userId,
      'go-home-active',
      [ACTIVE_GO_HOME_STORAGE_KEY],
    );

    if (!storedSession) {
      return null;
    }

    try {
      const parsedSession: unknown = JSON.parse(storedSession);
      return isActiveGoHomeSession(parsedSession) ? parsedSession : null;
    } catch {
      return null;
    }
  },

  async saveActive(userId: string, session: ActiveGoHomeSession) {
    await setAccountStorageItem(
      userId,
      'go-home-active',
      JSON.stringify(session),
      [ACTIVE_GO_HOME_STORAGE_KEY],
    );
  },

  async clearActive(userId: string) {
    await removeAccountStorageItem(userId, 'go-home-active');
  },

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

    try {
      const value: unknown = JSON.parse(storedLocation);
      if (!value || typeof value !== 'object') return null;
      const candidate = value as Partial<HomeLocation>;
      if (typeof candidate.latitude !== 'number' || !Number.isFinite(candidate.latitude) || Math.abs(candidate.latitude) > 90 ||
          typeof candidate.longitude !== 'number' || !Number.isFinite(candidate.longitude) || Math.abs(candidate.longitude) > 180 ||
          typeof candidate.savedAt !== 'string' || !Number.isFinite(Date.parse(candidate.savedAt))) return null;
      return candidate as HomeLocation;
    } catch {
      // Preserve malformed data; never substitute another account's Casa.
      return null;
    }
  },

  async saveHomeLocation(
    userId: string,
    location: Pick<HomeLocation, 'latitude' | 'longitude'>,
  ) {
    // Invalidate pending hydration before the first storage await, for this account only.
    homeLocationRevisions.set(userId, GoHomeStorage.getHomeLocationRevision(userId) + 1);
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
    // Also invalidate reads begun while this write was in flight.
    homeLocationRevisions.set(userId, GoHomeStorage.getHomeLocationRevision(userId) + 1);
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

  async saveCompleted(userId: string, session: ActiveGoHomeSession | GoHomeSession) {
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
