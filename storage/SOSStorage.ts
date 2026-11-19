import type { SOSEvent, SOSTerminalStatus } from '@/services/SOSService';
import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const SOS_EVENTS_STORAGE_KEY = 'safemelink.sos.events';
const MAX_STORED_EVENTS = 20;

const queues = new Map<string, Promise<unknown>>();
const serialize = <T>(userId: string, operation: () => Promise<T>): Promise<T> => {
  const next = (queues.get(userId) ?? Promise.resolve()).then(operation, operation);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(userId, settled);
  void settled.then(() => { if (queues.get(userId) === settled) queues.delete(userId); });
  return next;
};
async function readEvents(userId: string): Promise<SOSEvent[]> {
    const storedEvents = await getAccountStorageItem(
      userId,
      'sos-events',
      [SOS_EVENTS_STORAGE_KEY],
    );

    if (!storedEvents) {
      return [];
    }

    const events: unknown = JSON.parse(storedEvents);
    if (!Array.isArray(events) || events.some(event => !event || typeof event.id !== 'string')) {
      throw new Error('Registro SOS non leggibile. I dati sono conservati.');
    }
    return events;
}
export const SOSStorage = {
  async listEvents(userId: string): Promise<SOSEvent[]> {
    await queues.get(userId);
    return readEvents(userId);
  },

  async saveEvent(userId: string, event: SOSEvent) {
    return serialize(userId, async () => {
    const events = await readEvents(userId);
    const nextEvents = [event, ...events.filter((existing) => existing.id !== event.id)].slice(0, MAX_STORED_EVENTS);

    await setAccountStorageItem(
      userId,
      'sos-events',
      JSON.stringify(nextEvents),
      [SOS_EVENTS_STORAGE_KEY],
    );
    return nextEvents;
    });
  },

  async finalizeEvent(userId: string, eventId: string, remoteStatus: SOSTerminalStatus) {
    return serialize(userId, async () => {
    const events = await readEvents(userId);
    const nextEvents = events.map((event) =>
      event.id === eventId
        ? {
            ...event,
            contactIds: [],
            location: null,
            message: null,
            remoteStatus,
            isActive: false,
          }
        : event,
    );

    await setAccountStorageItem(
      userId,
      'sos-events',
      JSON.stringify(nextEvents),
      [SOS_EVENTS_STORAGE_KEY],
    );
    return nextEvents;
    });
  },
};
