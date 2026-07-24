import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const CHECKPOINT_EVENTS_STORAGE_KEY = 'safemelink.checkpoint.events';
const MAX_STORED_EVENTS = 20;

export type CheckpointEvent = {
  id: string;
  createdAt: string;
  durationMinutes: number;
  status: 'completed';
};

export const CheckpointStorage = {
  async listEvents(userId: string): Promise<CheckpointEvent[]> {
    const storedEvents = await getAccountStorageItem(
      userId,
      'checkpoint-events',
      [CHECKPOINT_EVENTS_STORAGE_KEY],
    );

    if (!storedEvents) {
      return [];
    }

    return JSON.parse(storedEvents) as CheckpointEvent[];
  },

  async saveCompleted(userId: string, durationMinutes: number) {
    const events = await CheckpointStorage.listEvents(userId);
    const event: CheckpointEvent = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      durationMinutes,
      status: 'completed',
    };
    const nextEvents = [event, ...events].slice(0, MAX_STORED_EVENTS);

    await setAccountStorageItem(
      userId,
      'checkpoint-events',
      JSON.stringify(nextEvents),
      [CHECKPOINT_EVENTS_STORAGE_KEY],
    );
    return nextEvents;
  },
};
