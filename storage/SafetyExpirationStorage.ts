import {
  getAccountStorageItem,
  removeAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

export type SafetyExpirationKind = 'checkpoint' | 'go_home';
export type SafetyExpirationPhase = 'waiting' | 'confirming' | 'executing' | 'failed';

export type SafetyExpirationSchedule = {
  confirmationExpiresAt: string;
  expiresAt: string;
  kind: SafetyExpirationKind;
  phase: SafetyExpirationPhase;
  sessionId: string;
};

const isSchedule = (value: unknown): value is SafetyExpirationSchedule => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SafetyExpirationSchedule>;
  const expiresAt = Date.parse(candidate.expiresAt ?? '');
  const confirmationExpiresAt = Date.parse(candidate.confirmationExpiresAt ?? '');
  return (
    (candidate.kind === 'checkpoint' || candidate.kind === 'go_home') &&
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.length > 0 &&
    ['waiting', 'confirming', 'executing', 'failed'].includes(candidate.phase ?? '') &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(confirmationExpiresAt) &&
    confirmationExpiresAt > expiresAt
  );
};

export const SafetyExpirationStorage = {
  async get(userId: string): Promise<SafetyExpirationSchedule | null> {
    const raw = await getAccountStorageItem(userId, 'safety-expiration', []);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSchedule(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  save(userId: string, schedule: SafetyExpirationSchedule) {
    return setAccountStorageItem(userId, 'safety-expiration', JSON.stringify(schedule), []);
  },

  clear(userId: string) {
    return removeAccountStorageItem(userId, 'safety-expiration');
  },
};
