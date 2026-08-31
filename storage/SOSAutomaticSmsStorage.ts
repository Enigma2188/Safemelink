import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const CONSENT_NAMESPACE = 'sos-sms-consent' as const;
const DISPATCH_NAMESPACE = 'sos-sms-dispatch' as const;
const MAX_DISPATCH_MARKERS = 40;

export const SOSAutomaticSmsStorage = {
  async hasConsent(userId: string) {
    return (await getAccountStorageItem(userId, CONSENT_NAMESPACE, [])) === 'true';
  },

  setConsent(userId: string, consent: boolean) {
    return setAccountStorageItem(userId, CONSENT_NAMESPACE, String(consent), []);
  },

  async getAttemptedRecipients(userId: string, eventId: string) {
    const raw = await getAccountStorageItem(userId, DISPATCH_NAMESPACE, []);
    if (!raw) return new Set<string>();
    try {
      const entries = JSON.parse(raw) as Record<string, string[]>;
      return new Set(entries[eventId] ?? []);
    } catch {
      return new Set<string>();
    }
  },

  async markAttempted(userId: string, eventId: string, phone: string) {
    const raw = await getAccountStorageItem(userId, DISPATCH_NAMESPACE, []);
    let entries: Record<string, string[]> = {};
    try {
      entries = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    } catch {}
    const attempted = new Set(entries[eventId] ?? []);
    attempted.add(phone);
    entries[eventId] = [...attempted];
    const recentEntries = Object.fromEntries(
      Object.entries(entries).slice(-MAX_DISPATCH_MARKERS),
    );
    await setAccountStorageItem(userId, DISPATCH_NAMESPACE, JSON.stringify(recentEntries), []);
  },
};
