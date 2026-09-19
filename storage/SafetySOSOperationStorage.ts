import type { ActiveSOSEvent, SOSCompletionResult } from '@/services/SOSService';
import { getAccountStorageItem, setAccountStorageItem } from '@/storage/AccountScopedStorage';

type Operation = { event: ActiveSOSEvent; result?: SOSCompletionResult };
let queue: Promise<unknown> = Promise.resolve();
const ordered = <T>(action: () => Promise<T>) => {
  const result = queue.then(action, action);
  queue = result.then(() => undefined, () => undefined);
  return result;
};
// No automatic eviction: an old recovery must never lose its idempotency marker.
export const SafetySOSOperationStorage = {
  get(userId: string, operationId: string): Promise<Operation | null> {
    return ordered(async () => {
      const raw = await getAccountStorageItem(userId, 'safety-sos-operations', []);
      const entries = raw ? JSON.parse(raw) as Record<string, Operation> : {};
      return entries[operationId] ?? null;
    });
  },
  save(userId: string, operationId: string, operation: Operation) {
    return ordered(async () => {
      const raw = await getAccountStorageItem(userId, 'safety-sos-operations', []);
      const entries = raw ? JSON.parse(raw) as Record<string, Operation> : {};
      entries[operationId] = operation;
      await setAccountStorageItem(userId, 'safety-sos-operations', JSON.stringify(entries), []);
    });
  },
};
