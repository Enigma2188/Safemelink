import { SOSService } from '@/services/SOSService';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { SafetyNotifications } from '@/services/SafetyNotifications';
import { reportSafetyError, withSafetyTimeout } from '@/services/SafetyOperation';
import { CheckpointStorage } from '@/storage/CheckpointStorage';
import { GoHomeStorage } from '@/storage/GoHomeStorage';
import { SafetyExpirationStorage, type SafetyExpirationKind, type SafetyExpirationSchedule } from '@/storage/SafetyExpirationStorage';

const MAX_BACKGROUND_WAIT_MS = 24 * 60 * 60 * 1_000;
let operationQueue: Promise<void> = Promise.resolve();
const revisions = new Map<string, number>();
const executing = new Set<string>();
const cancelled = new Set<string>();
const phaseListeners = new Set<(userId: string, schedule: SafetyExpirationSchedule | null) => void>();
const errorListeners = new Set<(userId: string) => void>();
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
};
const revision = (userId: string) => revisions.get(userId) ?? 0;
const notifyPhase = (userId: string, schedule: SafetyExpirationSchedule | null) => {
  for (const listener of phaseListeners) {
    try { listener(userId, schedule); } catch { reportSafetyError('phase_listener'); }
  }
};
const read = (userId: string) => withSafetyTimeout(SafetyExpirationStorage.get(userId), 'storage_read');
const save = (userId: string, schedule: SafetyExpirationSchedule) => withSafetyTimeout(SafetyExpirationStorage.save(userId, schedule), 'storage_write');
const clear = (userId: string) => withSafetyTimeout(SafetyExpirationStorage.clear(userId), 'storage_clear');
const sourceSessionExists = async (userId: string, schedule: SafetyExpirationSchedule) => {
  if (schedule.kind === 'manual_sos') return true;
  if (schedule.kind === 'checkpoint') {
    const session = await withSafetyTimeout(CheckpointStorage.getActive(userId), 'source_read');
    return session?.startedAt === schedule.sessionId;
  }
  const session = await withSafetyTimeout(GoHomeStorage.getActive(userId), 'source_read');
  return session?.id === schedule.sessionId;
};
const clearSourceSession = async (userId: string, kind: SafetyExpirationKind) => {
  if (kind === 'manual_sos') return;
  await withSafetyTimeout(kind === 'checkpoint' ? CheckpointStorage.clearActive(userId) : GoHomeStorage.clearActive(userId), 'source_clear');
};

// Delivery runs outside the queue: a native/network Promise cannot block cancellation.
const executeSOS = async (userId: string, schedule: SafetyExpirationSchedule) => {
  try {
    VoiceProtectionRuntime.notifySOSExecutionStarted(userId);
    const result = await SOSService.completeSOS(userId, {
      allowRemoteDelivery: true,
      allowRecentNetworkLocation: true,
      allowInteractiveFallback: false,
    });
    await clearSourceSession(userId, schedule.kind).catch(() => reportSafetyError('source_cleanup'));
    await clear(userId).catch(() => reportSafetyError('completed_cleanup'));
    VoiceProtectionRuntime.notifySOSCompleted(userId, result);
    notifyPhase(userId, null);
  } catch (error: unknown) {
    reportSafetyError('sos_execution');
    const failed = { ...schedule, phase: 'failed' as const };
    await save(userId, failed).catch(() => reportSafetyError('failure_persistence'));
    notifyPhase(userId, failed);
    void SafetyNotifications.show(schedule.sessionId, schedule.kind, true);
    VoiceProtectionRuntime.notifySOSFailed(userId, error);
  } finally {
    executing.delete(userId);
    VoiceProtectionRuntime.wakeBackgroundTask();
  }
};

export const SafetyExpirationRuntime = {
  schedule(userId: string, kind: SafetyExpirationKind, sessionId: string, expiresAt: string, confirmationSeconds: number) {
    const expectedRevision = revision(userId);
    return enqueue(async () => {
      if (executing.has(userId)) throw new Error('SOS già in esecuzione.');
      const schedule: SafetyExpirationSchedule = {
        kind, sessionId, expiresAt,
        confirmationExpiresAt: new Date(Date.parse(expiresAt) + confirmationSeconds * 1_000).toISOString(),
        phase: 'waiting',
      };
      await save(userId, schedule);
      if (revision(userId) !== expectedRevision) {
        await clear(userId);
        throw new Error('Avvio annullato.');
      }
      cancelled.delete(userId);
      notifyPhase(userId, schedule);
      return schedule;
    });
  },
  async ensure(userId: string, kind: SafetyExpirationKind, sessionId: string, expiresAt: string, confirmationSeconds: number) {
    if (cancelled.has(userId)) throw new Error('Controllo annullato: avvia una nuova sessione.');
    const existing = await read(userId);
    if (existing?.kind === kind && existing.sessionId === sessionId) return existing;
    return this.schedule(userId, kind, sessionId, expiresAt, confirmationSeconds);
  },
  cancel(userId: string, kind?: SafetyExpirationKind, sessionId?: string) {
    // Synchronous invalidation defeats a prepare/claim that is already awaiting storage.
    revisions.set(userId, revision(userId) + 1);
    cancelled.add(userId);
    return enqueue(async () => {
      const existing = await read(userId);
      if (!existing) return true;
      if ((kind && existing.kind !== kind) || (sessionId && existing.sessionId !== sessionId)) {
        cancelled.delete(userId);
        return false;
      }
      if (executing.has(userId) || existing.phase === 'executing') {
        cancelled.delete(userId);
        return false;
      }
      await clear(userId);
      await clearSourceSession(userId, existing.kind);
      notifyPhase(userId, null);
      return true;
    });
  },
  expedite(userId: string) {
    return enqueue(async () => {
      const schedule = await read(userId);
      if (!schedule || schedule.kind !== 'manual_sos' || schedule.phase !== 'waiting') return;
      const deadline = new Date().toISOString();
      await save(userId, { ...schedule, expiresAt: deadline, confirmationExpiresAt: deadline });
      VoiceProtectionRuntime.wakeBackgroundTask();
    }).then(() => this.processDue(userId));
  },
  processDue(userId: string): Promise<{ schedule: SafetyExpirationSchedule | null; waitMs: number }> {
    const expectedRevision = revision(userId);
    return enqueue(async () => {
      try {
        if (cancelled.has(userId) && !executing.has(userId)) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        let schedule = await read(userId);
        if (!schedule) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        if (schedule.phase === 'failed' || schedule.phase === 'executing') {
          // After process death an executing claim has an unknown outcome. Never replay it.
          notifyPhase(userId, schedule.phase === 'executing' && !executing.has(userId)
            ? { ...schedule, phase: 'failed' } : schedule);
          return { schedule: executing.has(userId) ? schedule : null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        if (revision(userId) !== expectedRevision) return { schedule, waitMs: 0 };
        if (!(await sourceSessionExists(userId, schedule))) {
          await clear(userId);
          notifyPhase(userId, null);
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        if (revision(userId) !== expectedRevision || cancelled.has(userId)) {
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        const expiresAt = Date.parse(schedule.expiresAt);
        const confirmationExpiresAt = Date.parse(schedule.confirmationExpiresAt);
        if (schedule.phase === 'waiting' && Date.now() >= expiresAt && schedule.kind !== 'manual_sos') {
          schedule = { ...schedule, phase: 'confirming' };
          await save(userId, schedule);
          notifyPhase(userId, schedule);
          // A notification must never hold the deadline queue.
          void SafetyNotifications.show(schedule.sessionId, schedule.kind);
        }
        const nextDeadline = schedule.phase === 'waiting' ? expiresAt : confirmationExpiresAt;
        if (Date.now() < confirmationExpiresAt) {
          notifyPhase(userId, schedule);
          return { schedule, waitMs: Math.max(0, nextDeadline - Date.now()) };
        }
        if (revision(userId) !== expectedRevision) return { schedule, waitMs: 0 };
        const claim = { ...schedule, phase: 'executing' as const };
        try {
          await save(userId, claim);
        } catch (error) {
          // No SOS call occurred: restore the recoverable pre-claim phase.
          await save(userId, schedule).catch(() => reportSafetyError('claim_rollback'));
          throw error;
        }
        if (revision(userId) !== expectedRevision) {
          await clear(userId);
          notifyPhase(userId, null);
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        executing.add(userId);
        notifyPhase(userId, claim);
        void executeSOS(userId, claim).catch(() => reportSafetyError('completion_listener'));
        return { schedule: claim, waitMs: MAX_BACKGROUND_WAIT_MS };
      } catch (error) {
        reportSafetyError('deadline_transition');
        for (const listener of errorListeners) {
          try { listener(userId); } catch { reportSafetyError('error_listener'); }
        }
        throw error;
      }
    });
  },
  get: read,
  onPhaseChanged(listener: (userId: string, schedule: SafetyExpirationSchedule | null) => void) {
    phaseListeners.add(listener);
    return () => { phaseListeners.delete(listener); };
  },
  onError(listener: (userId: string) => void) {
    errorListeners.add(listener);
    return () => { errorListeners.delete(listener); };
  },
};
