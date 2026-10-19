import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthService } from '@/backend/auth/AuthService';
import { getAccountStorageKey } from '@/storage/AccountScopedStorage';
import { SOSStorage } from '@/storage/SOSStorage';
import { SOSLifecycleService, SOSLifecycleDiagnosticError, type SOSLifecycleState } from '@/services/SOSLifecycleService';
import type { SOSEvent, SOSTerminalStatus } from '@/services/SOSService';

type CloseIntent = {
  eventId: string;
  remoteId: string | null;
  terminalStatus: SOSTerminalStatus;
  phase: 'pending' | 'confirmed' | 'settled';
};
export class SOSClosureUncertainError extends Error {
  constructor() {
    super('Chiusura remota non verificabile: manca il riferimento SOS. La richiesta è conservata, ma l’emergenza non è confermata conclusa. Non creare un nuovo SOS per riprovare.');
    this.name = 'SOSClosureUncertainError';
  }
}
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
};
const key = (userId: string) => `${getAccountStorageKey(userId, 'sos-events')}:close-intents-v1`;
const read = async (userId: string): Promise<CloseIntent[]> => {
  const raw = await AsyncStorage.getItem(key(userId));
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value) || value.some(item => !item || typeof item.eventId !== 'string' ||
    !(item.remoteId === null || typeof item.remoteId === 'string') ||
    !['closed', 'cancelled'].includes(item.terminalStatus) || !['pending', 'confirmed', 'settled'].includes(item.phase))) {
    throw new Error('Intenzione di chiusura SOS non leggibile. Nessun dato è stato cancellato.');
  }
  return value;
};
const write = (userId: string, intents: CloseIntent[]) => AsyncStorage.setItem(key(userId), JSON.stringify(intents));
const requireOwner = async (userId: string) => {
  if ((await AuthService.getSession())?.user.id !== userId) throw new SOSLifecycleDiagnosticError('auth');
};
const verify = (state: SOSLifecycleState, id: string) => {
  if (state.sos_id !== id || state.is_owner !== true ||
    !['closed', 'cancelled'].includes(state.sos_status)) throw new SOSLifecycleDiagnosticError('unexpected_status');
};
const apply = async (userId: string, intent: CloseIntent) => {
  await requireOwner(userId);
  if (!intent.remoteId) throw new SOSClosureUncertainError();
  const state = intent.terminalStatus === 'closed'
    ? await SOSLifecycleService.close(intent.remoteId) : await SOSLifecycleService.cancel(intent.remoteId);
  await requireOwner(userId);
  verify(state, intent.remoteId);
  if (state.sos_status !== intent.terminalStatus) throw new SOSLifecycleDiagnosticError('unexpected_status');
  return state;
};

export const SOSClosureRecovery = {
  request(userId: string, event: SOSEvent, terminalStatus: SOSTerminalStatus) {
    return enqueue(async () => {
      await requireOwner(userId);
      const intents = await read(userId);
      const existing = intents.find(item => item.eventId === event.id);
      if (existing?.remoteId && event.remoteSosId && existing.remoteId !== event.remoteSosId) {
        throw new SOSLifecycleDiagnosticError('unexpected_response');
      }
      const intent: CloseIntent = { eventId: event.id, remoteId: existing?.remoteId ?? event.remoteSosId ?? null,
        terminalStatus: existing?.terminalStatus ?? terminalStatus, phase: 'pending' };
      const next = [...intents.filter(item => item.eventId !== event.id), intent];
      // Persist BEFORE the RPC: a timeout, crash or APK update cannot erase the user's request.
      await write(userId, next);
      const state = await apply(userId, intent);
      intent.phase = 'confirmed';
      await write(userId, next);
      return state;
    });
  },
  reconcile(userId: string) {
    return enqueue(async () => {
      await requireOwner(userId);
      const intents = await read(userId);
      const completed: { eventId: string; remoteId: string }[] = [];
      let unresolved = 0;
      for (const intent of intents.filter(item => item.phase !== 'settled')) {
        try {
        await requireOwner(userId);
        if (!intent.remoteId) {
          const sameEvent = (await SOSStorage.listEvents(userId)).find(event => event.id === intent.eventId);
          intent.remoteId = sameEvent?.remoteSosId ?? null;
          await write(userId, intents);
        }
        if (!intent.remoteId) throw new SOSClosureUncertainError(); // Never infer rollback from an empty read.
        await requireOwner(userId);
        let state = await SOSLifecycleService.getStatus(intent.remoteId);
        await requireOwner(userId);
        if (state.sos_id !== intent.remoteId || state.is_owner !== true) throw new SOSLifecycleDiagnosticError('unexpected_response');
        if (state.sos_status === 'open' || state.sos_status === 'accepted') state = await apply(userId, intent);
        verify(state, intent.remoteId);
        intent.phase = 'confirmed';
        await write(userId, intents);
        await requireOwner(userId);
        await SOSStorage.finalizeEvent(userId, intent.eventId, state.sos_status as SOSTerminalStatus);
        intent.phase = 'settled';
        await write(userId, intents);
        completed.push({ eventId: intent.eventId, remoteId: intent.remoteId });
        } catch {
          // One unresolved operation must not starve other explicit close requests.
          // Account changes still abort the entire reconciliation immediately.
          await requireOwner(userId);
          unresolved++;
        }
      }
      await requireOwner(userId);
      return { completed, unresolved };
    });
  },
};
