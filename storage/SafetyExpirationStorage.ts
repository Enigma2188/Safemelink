import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccountStorageKey } from '@/storage/AccountScopedStorage';

// Keep native operations ordered even when a caller times out. A late write
// cannot overtake a later rollback/cancellation and resurrect an old schedule.
let nativeQueue: Promise<unknown> = Promise.resolve();
const ordered = <T>(operation: () => Promise<T>) => {
  const result = nativeQueue.then(operation, operation);
  nativeQueue = result.then(() => undefined, () => undefined);
  return result;
};

export type SafetyExpirationKind = 'checkpoint' | 'go_home' | 'manual_sos';
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
    (candidate.kind === 'checkpoint' || candidate.kind === 'go_home' || candidate.kind === 'manual_sos') &&
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.length > 0 &&
    ['waiting', 'confirming', 'executing', 'failed'].includes(candidate.phase ?? '') &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(confirmationExpiresAt) &&
    confirmationExpiresAt >= expiresAt
  );
};

export const SafetyExpirationStorage = {
  async get(userId: string): Promise<SafetyExpirationSchedule | null> {
    const raw = await ordered(() => AsyncStorage.getItem(getAccountStorageKey(userId, 'safety-expiration')));
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSchedule(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  save(userId: string, schedule: SafetyExpirationSchedule) {
    return ordered(() => AsyncStorage.setItem(getAccountStorageKey(userId, 'safety-expiration'), JSON.stringify(schedule)));
  },

  clear(userId: string) {
    return ordered(() => AsyncStorage.removeItem(getAccountStorageKey(userId, 'safety-expiration')));
  },
};
