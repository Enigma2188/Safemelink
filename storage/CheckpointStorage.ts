import {
  getAccountStorageItem,
  removeAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const ACTIVE_CHECKPOINT_STORAGE_KEY = 'safemelink.checkpoint.active';
const CHECKPOINT_EVENTS_STORAGE_KEY = 'safemelink.checkpoint.events';
const MAX_STORED_EVENTS = 20;

export type CheckpointEvent = {
  id: string;
  createdAt: string;
  durationMinutes: number;
  status: 'completed';
};

export type ActiveCheckpointSession = {
  active: true;
  durationMinutes: number;
  expiresAt: string;
  startedAt: string;
};

const isActiveCheckpointSession = (value: unknown): value is ActiveCheckpointSession => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ActiveCheckpointSession>;
  const startedAtMs = Date.parse(candidate.startedAt ?? '');
  const expiresAtMs = Date.parse(candidate.expiresAt ?? '');
  return (
    candidate.active === true &&
    Number.isInteger(candidate.durationMinutes) &&
    (candidate.durationMinutes ?? 0) > 0 &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > startedAtMs
  );
};

export const CheckpointStorage = {
  async getActive(userId: string): Promise<ActiveCheckpointSession | null> {
    const storedSession = await getAccountStorageItem(
      userId,
      'checkpoint-active',
      [ACTIVE_CHECKPOINT_STORAGE_KEY],
    );
    if (!storedSession) {
      return null;
    }
    try {
      const parsedSession: unknown = JSON.parse(storedSession);
      return isActiveCheckpointSession(parsedSession) ? parsedSession : null;
    } catch {
      return null;
    }
  },

  async saveActive(userId: string, session: ActiveCheckpointSession) {
    await setAccountStorageItem(
      userId,
      'checkpoint-active',
      JSON.stringify(session),
      [ACTIVE_CHECKPOINT_STORAGE_KEY],
    );
  },

  async clearActive(userId: string) {
    await removeAccountStorageItem(userId, 'checkpoint-active');
  },

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
