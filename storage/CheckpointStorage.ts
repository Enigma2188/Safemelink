import AsyncStorage from '@react-native-async-storage/async-storage';

const CHECKPOINT_EVENTS_STORAGE_KEY = 'safemelink.checkpoint.events';
const MAX_STORED_EVENTS = 20;

export type CheckpointEvent = {
  id: string;
  createdAt: string;
  durationMinutes: number;
  status: 'completed';
};

export const CheckpointStorage = {
  async listEvents(): Promise<CheckpointEvent[]> {
    const storedEvents = await AsyncStorage.getItem(CHECKPOINT_EVENTS_STORAGE_KEY);

    if (!storedEvents) {
      return [];
    }

    return JSON.parse(storedEvents) as CheckpointEvent[];
  },

  async saveCompleted(durationMinutes: number) {
    const events = await CheckpointStorage.listEvents();
    const event: CheckpointEvent = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      durationMinutes,
      status: 'completed',
    };
    const nextEvents = [event, ...events].slice(0, MAX_STORED_EVENTS);

    await AsyncStorage.setItem(CHECKPOINT_EVENTS_STORAGE_KEY, JSON.stringify(nextEvents));
    return nextEvents;
  },
};
