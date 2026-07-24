import type { SOSEvent, SOSTerminalStatus } from '@/services/SOSService';
import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const SOS_EVENTS_STORAGE_KEY = 'safemelink.sos.events';
const MAX_STORED_EVENTS = 20;

export const SOSStorage = {
  async listEvents(userId: string): Promise<SOSEvent[]> {
    const storedEvents = await getAccountStorageItem(
      userId,
      'sos-events',
      [SOS_EVENTS_STORAGE_KEY],
    );

    if (!storedEvents) {
      return [];
    }

    return JSON.parse(storedEvents) as SOSEvent[];
  },

  async saveEvent(userId: string, event: SOSEvent) {
    const events = await SOSStorage.listEvents(userId);
    const nextEvents = [event, ...events].slice(0, MAX_STORED_EVENTS);

    await setAccountStorageItem(
      userId,
      'sos-events',
      JSON.stringify(nextEvents),
      [SOS_EVENTS_STORAGE_KEY],
    );
    return nextEvents;
  },

  async finalizeEvent(userId: string, eventId: string, remoteStatus: SOSTerminalStatus) {
    const events = await SOSStorage.listEvents(userId);
    const nextEvents = events.map((event) =>
      event.id === eventId
        ? {
            ...event,
            contactIds: [],
            location: null,
            message: null,
            remoteStatus,
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
  },
};
