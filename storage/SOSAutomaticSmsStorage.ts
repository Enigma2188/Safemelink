import { getAccountStorageItem, setAccountStorageItem } from '@/storage/AccountScopedStorage';

const CONSENT_NAMESPACE = 'sos-sms-consent' as const;
const DISPATCH_NAMESPACE = 'sos-sms-dispatch' as const;
const MAX_DISPATCH_MARKERS = 40;
type SmsState = 'attempted' | 'handed_to_system' | 'failed' | 'unknown';
type Dispatch = { attempts: Record<string, string[]>; states: Record<string, Record<string, SmsState>> };
let queue: Promise<unknown> = Promise.resolve();
const ordered = <T>(action: () => Promise<T>) => {
  const result = queue.then(action, action);
  queue = result.then(() => undefined, () => undefined);
  return result;
};
const read = async (userId: string): Promise<Dispatch> => {
  const raw = await getAccountStorageItem(userId, DISPATCH_NAMESPACE, []);
  if (!raw) return { attempts: {}, states: {} };
  // Corruption is fail-closed: never turn an unreadable marker into a fresh send.
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SMS dispatch state unavailable.');
  const attempts = parsed.attempts ?? parsed;
  if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts) ||
      !Object.values(attempts).every((entry) => Array.isArray(entry) && entry.every((phone) => typeof phone === 'string'))) {
    throw new Error('SMS dispatch state unavailable.');
  }
  return { attempts, states: parsed.attempts ? parsed.states ?? {} : {} };
};
const write = (userId: string, data: Dispatch) => setAccountStorageItem(userId, DISPATCH_NAMESPACE, JSON.stringify(data), []);

export const SOSAutomaticSmsStorage = {
  async hasConsent(userId: string) {
    return (await getAccountStorageItem(userId, CONSENT_NAMESPACE, [])) === 'true';
  },
  setConsent(userId: string, consent: boolean) {
    return setAccountStorageItem(userId, CONSENT_NAMESPACE, String(consent), []);
  },
  getAttemptedRecipients(userId: string, eventId: string) {
    return ordered(async () => new Set((await read(userId)).attempts[eventId] ?? []));
  },
  markAttempted(userId: string, eventId: string, phone: string) {
    return ordered(async () => {
      const data = await read(userId);
      const attempted = new Set(data.attempts[eventId] ?? []);
      if (attempted.has(phone)) return false;
      attempted.add(phone);
      data.attempts[eventId] = [...attempted];
      data.states[eventId] = { ...data.states[eventId], [phone]: 'attempted' };
      // Stable escalation markers survive unrelated manual SOS.
      const manual = Object.keys(data.attempts).filter((id) => !/^[0-9a-f-]{36}$/i.test(id));
      for (const id of manual.slice(0, -MAX_DISPATCH_MARKERS)) {
        delete data.attempts[id]; delete data.states[id];
      }
      await write(userId, data);
      return true;
    });
  },
  markResult(userId: string, eventId: string, phone: string, state: SmsState) {
    return ordered(async () => {
      const data = await read(userId);
      data.states[eventId] = { ...data.states[eventId], [phone]: state };
      await write(userId, data);
    });
  },
};
