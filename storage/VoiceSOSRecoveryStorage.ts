import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccountStorageKey } from '@/storage/AccountScopedStorage';

export type VoiceSOSAttempt = {
  attemptId: string;
  eventId: string | null;
  remoteId: string | null;
  phase: 'pending' | 'active' | 'unknown';
};
let queue: Promise<unknown> = Promise.resolve();
const key = (userId: string) => `${getAccountStorageKey(userId, 'voice-protection')}:sos-recovery-v1`;
export const VoiceSOSRecoveryStorage = {
  async get(userId: string): Promise<VoiceSOSAttempt | null> {
    await queue.catch(() => undefined);
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as VoiceSOSAttempt;
    if (value === null) return null;
    if (!value || typeof value.attemptId !== 'string' ||
      !['pending', 'active', 'unknown'].includes(value.phase) ||
      !(value.eventId === null || typeof value.eventId === 'string') ||
      !(value.remoteId === null || typeof value.remoteId === 'string')) throw new Error('Invalid recovery journal');
    return value;
  },
  save(userId: string, attempt: VoiceSOSAttempt | null) {
    const operation = queue.then(() => AsyncStorage.setItem(key(userId), JSON.stringify(attempt)));
    queue = operation.catch(() => undefined);
    return operation;
  },
};
