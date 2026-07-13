import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SOSEvent } from '@/services/SOSService';

const SOS_EVENTS_STORAGE_KEY = 'safemelink.sos.events';
const MAX_STORED_EVENTS = 20;

export const SOSStorage = {
  async listEvents(): Promise<SOSEvent[]> {
    const storedEvents = await AsyncStorage.getItem(SOS_EVENTS_STORAGE_KEY);

    if (!storedEvents) {
      return [];
    }

    return JSON.parse(storedEvents) as SOSEvent[];
  },

  async saveEvent(event: SOSEvent) {
    const events = await SOSStorage.listEvents();
    const nextEvents = [event, ...events].slice(0, MAX_STORED_EVENTS);

    await AsyncStorage.setItem(SOS_EVENTS_STORAGE_KEY, JSON.stringify(nextEvents));
    return nextEvents;
  },
};
