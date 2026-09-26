import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const KEY = 'safemelink.safety-notifications.enabled';

export const SafetyNotificationPreferenceStorage = {
  async get(userId: string): Promise<boolean> {
    const value = await getAccountStorageItem(userId, 'safety-notification-preference', [KEY]);
    return value !== 'false';
  },

  async set(userId: string, enabled: boolean) {
    await setAccountStorageItem(userId, 'safety-notification-preference', String(enabled), [KEY]);
  },
};
