import {
  getAccountStorageItem,
  removeAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const NAMESPACE = 'network-phone-verification' as const;
const LEGACY_KEYS: readonly string[] = [];

export type PendingPhoneVerification = {
  operationId: string;
  expiresAt?: string;
  resendAvailableAt?: string;
  pendingAttemptId?: string;
};

const isUuid = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const NetworkPhoneVerificationStorage = {
  async load(userId: string): Promise<PendingPhoneVerification | null> {
    const raw = await getAccountStorageItem(userId, NAMESPACE, LEGACY_KEYS);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<PendingPhoneVerification>;
      if (!isUuid(value.operationId)
        || (value.pendingAttemptId !== undefined && !isUuid(value.pendingAttemptId))) return null;
      return {
        operationId: value.operationId,
        expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
        resendAvailableAt: typeof value.resendAvailableAt === 'string' ? value.resendAvailableAt : undefined,
        pendingAttemptId: value.pendingAttemptId,
      };
    } catch {
      return null;
    }
  },

  save(userId: string, value: PendingPhoneVerification) {
    return setAccountStorageItem(userId, NAMESPACE, JSON.stringify(value), LEGACY_KEYS);
  },

  clear(userId: string) {
    return removeAccountStorageItem(userId, NAMESPACE);
  },
};
