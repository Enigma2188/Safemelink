import {
  getAccountStorageItem,
  removeAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const NAMESPACE = 'sos-network-location' as const;

export type CachedSOSNetworkLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  observedAt: string;
};

export const SOSNetworkLocationStorage = {
  async get(userId: string): Promise<CachedSOSNetworkLocation | null> {
    const raw = await getAccountStorageItem(userId, NAMESPACE, []);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<CachedSOSNetworkLocation>;
      if (
        !Number.isFinite(value.latitude) ||
        value.latitude! < -90 ||
        value.latitude! > 90 ||
        !Number.isFinite(value.longitude) ||
        value.longitude! < -180 ||
        value.longitude! > 180 ||
        !Number.isFinite(value.accuracy) ||
        value.accuracy! < 0 ||
        typeof value.observedAt !== 'string'
      ) {
        return null;
      }
      return value as CachedSOSNetworkLocation;
    } catch {
      return null;
    }
  },

  save(userId: string, location: CachedSOSNetworkLocation) {
    return setAccountStorageItem(userId, NAMESPACE, JSON.stringify(location), []);
  },

  clear(userId: string) {
    return removeAccountStorageItem(userId, NAMESPACE);
  },
};
