import * as Notifications from 'expo-notifications';

import { SOSService, type SOSCompletionResult } from '@/services/SOSService';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { CheckpointStorage } from '@/storage/CheckpointStorage';
import { GoHomeStorage } from '@/storage/GoHomeStorage';
import {
  SafetyExpirationStorage,
  type SafetyExpirationKind,
  type SafetyExpirationSchedule,
} from '@/storage/SafetyExpirationStorage';

const MAX_BACKGROUND_WAIT_MS = 24 * 60 * 60 * 1_000;
let operationQueue: Promise<void> = Promise.resolve();
const phaseListeners = new Set<(userId: string, schedule: SafetyExpirationSchedule) => void>();

const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
};

const notifyConfirmation = async (kind: SafetyExpirationKind) => {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: kind === 'checkpoint' ? 'Checkpoint scaduto' : 'Torno a casa',
      body: 'Stai bene? Apri SafeMeLink per confermare entro 30 secondi.',
      sound: 'default',
    },
    trigger: null,
  }).catch(() => undefined);
};

const clearSourceSession = async (userId: string, kind: SafetyExpirationKind) => {
  if (kind === 'checkpoint') {
    await CheckpointStorage.clearActive(userId);
  } else {
    await GoHomeStorage.clearActive(userId);
  }
};

const sourceSessionExists = async (
  userId: string,
  schedule: SafetyExpirationSchedule,
) => {
  if (schedule.kind === 'checkpoint') {
    const sourceSession = await CheckpointStorage.getActive(userId);
    return sourceSession?.startedAt === schedule.sessionId;
  }
  const sourceSession = await GoHomeStorage.getActive(userId);
  return sourceSession?.id === schedule.sessionId;
};

const notifyPhase = (userId: string, schedule: SafetyExpirationSchedule) => {
  phaseListeners.forEach((listener) => listener(userId, schedule));
};

export const SafetyExpirationRuntime = {
  schedule(
    userId: string,
    kind: SafetyExpirationKind,
    sessionId: string,
    expiresAt: string,
    confirmationSeconds: number,
  ) {
    return enqueue(async () => {
      const schedule: SafetyExpirationSchedule = {
        kind,
        sessionId,
        expiresAt,
        confirmationExpiresAt: new Date(
          Date.parse(expiresAt) + confirmationSeconds * 1_000,
        ).toISOString(),
        phase: 'waiting',
      };
      await SafetyExpirationStorage.save(userId, schedule);
      notifyPhase(userId, schedule);
      return schedule;
    });
  },

  ensure(
    userId: string,
    kind: SafetyExpirationKind,
    sessionId: string,
    expiresAt: string,
    confirmationSeconds: number,
  ) {
    return enqueue(async () => {
      const existing = await SafetyExpirationStorage.get(userId);
      if (existing?.kind === kind && existing.sessionId === sessionId) return existing;
      const schedule: SafetyExpirationSchedule = {
        kind,
        sessionId,
        expiresAt,
        confirmationExpiresAt: new Date(
          Date.parse(expiresAt) + confirmationSeconds * 1_000,
        ).toISOString(),
        phase: 'waiting',
      };
      await SafetyExpirationStorage.save(userId, schedule);
      return schedule;
    });
  },

  cancel(userId: string, kind?: SafetyExpirationKind, sessionId?: string) {
    return enqueue(async () => {
      const existing = await SafetyExpirationStorage.get(userId);
      if (!existing) return true;
      if (kind && existing.kind !== kind) return false;
      if (sessionId && existing.sessionId !== sessionId) return false;
      if (existing.phase === 'executing') return false;
      await SafetyExpirationStorage.clear(userId);
      return true;
    });
  },

  processDue(userId: string): Promise<{
    schedule: SafetyExpirationSchedule | null;
    waitMs: number;
  }> {
    return enqueue(async () => {
      let schedule = await SafetyExpirationStorage.get(userId);
      if (!schedule || schedule.phase === 'failed' || schedule.phase === 'executing') {
        return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
      }

      if (!(await sourceSessionExists(userId, schedule))) {
        await SafetyExpirationStorage.clear(userId);
        return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
      }

      const now = Date.now();
      const expiresAt = Date.parse(schedule.expiresAt);
      const confirmationExpiresAt = Date.parse(schedule.confirmationExpiresAt);

      if (schedule.phase === 'waiting' && now >= expiresAt) {
        schedule = { ...schedule, phase: 'confirming' };
        await SafetyExpirationStorage.save(userId, schedule);
        notifyPhase(userId, schedule);
        await notifyConfirmation(schedule.kind);
      }

      if (now < confirmationExpiresAt) {
        const nextDeadline = schedule.phase === 'waiting' ? expiresAt : confirmationExpiresAt;
        return {
          schedule,
          waitMs: Math.max(0, Math.min(MAX_BACKGROUND_WAIT_MS, nextDeadline - now)),
        };
      }

      schedule = { ...schedule, phase: 'executing' };
      await SafetyExpirationStorage.save(userId, schedule);
      await clearSourceSession(userId, schedule.kind);
      notifyPhase(userId, schedule);
      VoiceProtectionRuntime.notifySOSExecutionStarted(userId);

      try {
        const result: SOSCompletionResult = await SOSService.completeSOS(userId, {
          allowRemoteDelivery: true,
          allowRecentNetworkLocation: true,
          allowInteractiveFallback: false,
        });
        await SafetyExpirationStorage.clear(userId);
        VoiceProtectionRuntime.notifySOSCompleted(userId, result);
        return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
      } catch (error: unknown) {
        const failedSchedule = { ...schedule, phase: 'failed' as const };
        await SafetyExpirationStorage.save(userId, failedSchedule).catch(() => undefined);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'SOS automatico non completato',
            body: 'Apri SafeMeLink e attiva manualmente l’SOS.',
            sound: 'default',
          },
          trigger: null,
        }).catch(() => undefined);
        VoiceProtectionRuntime.notifySOSFailed(userId, error);
        return { schedule: failedSchedule, waitMs: MAX_BACKGROUND_WAIT_MS };
      }
    });
  },

  get(userId: string) {
    return SafetyExpirationStorage.get(userId);
  },

  onPhaseChanged(listener: (userId: string, schedule: SafetyExpirationSchedule) => void) {
    phaseListeners.add(listener);
    return () => phaseListeners.delete(listener);
  },
};
