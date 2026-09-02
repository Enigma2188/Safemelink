import {
  getAccountStorageItem,
  removeAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

export type ActiveSOSLiveLocationSession = {
  sosId: string;
  startedAt: string;
};

export const SOSLiveLocationStorage = {
  async get(userId: string): Promise<ActiveSOSLiveLocationSession | null> {
    const raw = await getAccountStorageItem(userId, 'sos-live-location', []);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<ActiveSOSLiveLocationSession>;
      return typeof value.sosId === 'string' && typeof value.startedAt === 'string'
        ? { sosId: value.sosId, startedAt: value.startedAt }
        : null;
    } catch {
      return null;
    }
  },

  save(userId: string, session: ActiveSOSLiveLocationSession) {
    return setAccountStorageItem(userId, 'sos-live-location', JSON.stringify(session), []);
  },

  clear(userId: string) {
    return removeAccountStorageItem(userId, 'sos-live-location');
  },
};
