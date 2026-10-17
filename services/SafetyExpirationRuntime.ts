import { SOSService } from '@/services/SOSService';
import { Platform } from 'react-native';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { SafetyNotifications } from '@/services/SafetyNotifications';
import { reportSafetyError, withSafetyTimeout } from '@/services/SafetyOperation';
import { CheckpointStorage } from '@/storage/CheckpointStorage';
import { GoHomeStorage } from '@/storage/GoHomeStorage';
import { SafetyExpirationStorage, type SafetyExpirationKind, type SafetyExpirationSchedule } from '@/storage/SafetyExpirationStorage';

const MAX_BACKGROUND_WAIT_MS = 24 * 60 * 60 * 1_000;
let operationQueue: Promise<void> = Promise.resolve();
const revisions = new Map<string, number>();
const startIdentities = new Map<string, { kind: SafetyExpirationKind; sessionId: string }>();
const executing = new Set<string>();
const executionPromises = new Map<string, Promise<void>>();
const cancelled = new Set<string>();
const phaseListeners = new Set<(userId: string, schedule: SafetyExpirationSchedule | null) => void>();
const errorListeners = new Set<(userId: string) => void>();
const trace = (event: string, schedule?: SafetyExpirationSchedule) => console.info(
  `[SafetyExpiration] ${event}`,
  schedule ? {
    kind: schedule.kind,
    phase: schedule.phase,
    nowMs: Date.now(),
    expiresAt: schedule.expiresAt,
    expiresAtMs: Date.parse(schedule.expiresAt),
    deadlineLatenessMs: Math.max(0, Date.now() - Date.parse(schedule.expiresAt)),
    confirmationExpiresAt: schedule.confirmationExpiresAt,
    confirmationExpiresAtMs: Date.parse(schedule.confirmationExpiresAt),
    escalationLatenessMs: Math.max(0, Date.now() - Date.parse(schedule.confirmationExpiresAt)),
  } : { nowMs: Date.now() },
);
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
};
const revision = (userId: string) => revisions.get(userId) ?? 0;
const sameIdentity = (a: SafetyExpirationSchedule | null, b: SafetyExpirationSchedule) =>
  a?.kind === b.kind && a.sessionId === b.sessionId && a.nativeDeadlineGeneration === b.nativeDeadlineGeneration;
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
const clearSourceSession = async (userId: string, kind: SafetyExpirationKind, sessionId: string, expectedRevision = revision(userId)) => {
  if (kind === 'manual_sos') return;
  const sourceId = kind === 'checkpoint'
    ? (await withSafetyTimeout(CheckpointStorage.getActive(userId), 'source_read'))?.startedAt
    : (await withSafetyTimeout(GoHomeStorage.getActive(userId), 'source_read'))?.id;
  if (sourceId !== sessionId || revision(userId) !== expectedRevision) return;
  await withSafetyTimeout(kind === 'checkpoint' ? CheckpointStorage.clearActive(userId) : GoHomeStorage.clearActive(userId), 'source_clear');
};

// Delivery runs outside the queue: a native/network Promise cannot block cancellation.
const executeSOS = async (userId: string, schedule: SafetyExpirationSchedule) => {
  trace('SOS_EXECUTION_STARTED', schedule);
  let completed = false;
  let voiceAttemptId: string | undefined;
  try {
    voiceAttemptId = VoiceProtectionRuntime.notifySOSExecutionStarted(userId);
    const result = await SOSService.completeSOS(userId, {
      allowRemoteDelivery: true,
      allowRecentNetworkLocation: true,
      allowInteractiveFallback: false,
      ...(schedule.operationId ? { escalationOperationId: schedule.operationId } : {}),
    });
    // Persist completion before cleanup. The SOS operation journal already contains
    // the result: a crash on either side of this write reuses the SAME operation.
    await enqueue(async () => {
      if (!sameIdentity(await read(userId), schedule)) return;
      await save(userId, { ...schedule, phase: 'completed' });
      completed = true;
      try {
        await clearSourceSession(userId, schedule.kind, schedule.sessionId);
        await clear(userId);
      } catch { reportSafetyError('completed_cleanup'); }
    });
    VoiceProtectionRuntime.notifySOSCompleted(userId, result, voiceAttemptId);
    notifyPhase(userId, null);
    trace('SOS_EXECUTION_COMPLETED', schedule);
  } catch (error: unknown) {
    reportSafetyError('sos_execution');
    const failed = { ...schedule, phase: (schedule.operationId ? 'recoverable' : 'failed') as 'recoverable' | 'failed' };
    await enqueue(async () => {
      if (sameIdentity(await read(userId), schedule)) await save(userId, failed);
    }).catch(() => reportSafetyError('failure_persistence'));
    notifyPhase(userId, failed);
    void SafetyNotifications.show(schedule.sessionId, schedule.kind, true);
    VoiceProtectionRuntime.notifySOSFailed(userId, error, voiceAttemptId);
    trace('SOS_EXECUTION_FAILED', schedule);
  } finally {
    if (completed && schedule.nativeDeadlineGeneration) {
      try { SafeMeLinkSafety?.finishDeadlines(userId, schedule.sessionId, schedule.nativeDeadlineGeneration); }
      catch { reportSafetyError('native_deadline_finish'); }
    }
    executing.delete(userId);
    executionPromises.delete(userId);
    VoiceProtectionRuntime.wakeBackgroundTask();
  }
};

export const SafetyExpirationRuntime = {
  schedule(userId: string, kind: SafetyExpirationKind, sessionId: string, expiresAt: string, confirmationSeconds: number) {
    if (executing.has(userId)) throw new Error('SOS già in esecuzione.');
    const expectedRevision = revision(userId) + 1;
    revisions.set(userId, expectedRevision);
    startIdentities.set(userId, { kind, sessionId });
    return enqueue(async () => {
      if (revision(userId) !== expectedRevision) throw new Error('Avvio superato o annullato.');
      if (executing.has(userId)) throw new Error('SOS già in esecuzione.');
      let nativeDeadlineGeneration: string | undefined;
      if (Platform.OS === 'android' && kind !== 'manual_sos') {
        SafetyNotifications.checkExactAlarmPermission();
        nativeDeadlineGeneration = SafeMeLinkSafety!.prepareDeadlines(userId, kind, sessionId,
          Date.parse(expiresAt), Date.parse(expiresAt) + confirmationSeconds * 1_000);
      }
      const schedule: SafetyExpirationSchedule = {
        kind, sessionId, expiresAt,
        confirmationExpiresAt: new Date(Date.parse(expiresAt) + confirmationSeconds * 1_000).toISOString(),
        phase: 'waiting',
        confirmationNotificationScheduled: false,
        ...(nativeDeadlineGeneration ? { nativeDeadlineGeneration, operationId: SafeMeLinkSafety!.operationId(userId, sessionId, nativeDeadlineGeneration) } : {}),
      };
      try { await save(userId, schedule); }
      catch (error) {
        if (nativeDeadlineGeneration) SafeMeLinkSafety?.finishDeadlines(userId, sessionId, nativeDeadlineGeneration);
        throw error;
      }
      trace('DEADLINE_PERSISTED', schedule);
      if (revision(userId) !== expectedRevision) {
        if (nativeDeadlineGeneration) SafeMeLinkSafety?.finishDeadlines(userId, sessionId, nativeDeadlineGeneration);
        await clear(userId);
        throw new Error('Avvio annullato.');
      }
      cancelled.delete(userId);
      notifyPhase(userId, schedule);
      return schedule;
    });
  },
  ensure(userId: string, kind: SafetyExpirationKind, sessionId: string, expiresAt: string, confirmationSeconds: number,
    expectedRevision = revision(userId)) {
    return enqueue(async () => {
      const checkCurrent = () => {
        if (revision(userId) !== expectedRevision || cancelled.has(userId)) throw new Error('Recupero obsoleto o annullato.');
      };
      checkCurrent();
      const existing = await read(userId);
      checkCurrent();
      // Recovery is not a new start. Never replace another session or generation.
      if (existing && (existing.kind !== kind || existing.sessionId !== sessionId)) throw new Error('Sessione di recupero superata.');
      if (existing && (existing.phase === 'failed' || existing.phase === 'executing' || existing.phase === 'recoverable' || existing.phase === 'completed')) return existing;
      let schedule: SafetyExpirationSchedule = existing ?? {
        kind, sessionId, expiresAt, confirmationExpiresAt: new Date(Date.parse(expiresAt) + confirmationSeconds * 1_000).toISOString(),
        phase: 'waiting', confirmationNotificationScheduled: false,
      };
      if (!(await sourceSessionExists(userId, schedule))) throw new Error('Sessione terminata o assente.');
      checkCurrent();
      if (Platform.OS === 'android' && kind !== 'manual_sos') {
        SafetyNotifications.checkExactAlarmPermission();
        // Native compare-and-recover is atomic with cancel/prepare/arm. It cannot
        // replace a different identity between the JS check and native mutation.
        const generation = SafeMeLinkSafety!.recoverDeadlines(userId, kind, sessionId,
          Date.parse(schedule.expiresAt), Date.parse(schedule.confirmationExpiresAt), schedule.nativeDeadlineGeneration ?? null);
        if (!generation) throw new Error('Generazione nativa di recupero superata.');
        schedule = { ...schedule, nativeDeadlineGeneration: generation,
          operationId: SafeMeLinkSafety!.operationId(userId, sessionId, generation) };
      }
      checkCurrent();
      await save(userId, schedule);
      checkCurrent();
      return schedule;
    });
  },
  cancel(userId: string, kind?: SafetyExpirationKind, sessionId?: string) {
    const intended = startIdentities.get(userId);
    if (intended && ((kind && intended.kind !== kind) || (sessionId && intended.sessionId !== sessionId))) {
      // Do not invalidate the successor's JS launch, but retire an old native
      // preventive alarm if a manual SOS (which prepares no alarms) supersedes it.
      try { SafeMeLinkSafety?.cancelDeadlines(userId, kind ?? null, sessionId ?? null); }
      catch { reportSafetyError('native_deadline_cancel'); }
      return Promise.resolve(false);
    }
    // Synchronous invalidation defeats a prepare/claim that is already awaiting storage.
    revisions.set(userId, revision(userId) + 1);
    const expectedRevision = revision(userId);
    cancelled.add(userId);
    // Native cancellation is synchronous: delayed arming validates its generation
    // and cannot resurrect a cancelled session while JS storage is awaiting I/O.
    try { SafeMeLinkSafety?.cancelDeadlines(userId, kind ?? null, sessionId ?? null); }
    catch { reportSafetyError('native_deadline_cancel'); }
    return enqueue(async () => {
      const existing = await read(userId);
      if (revision(userId) !== expectedRevision) return false;
      if (!existing) {
        if (sessionId) void SafetyNotifications.cancelConfirmation(sessionId);
        return true;
      }
      if ((kind && existing.kind !== kind) || (sessionId && existing.sessionId !== sessionId)) {
        cancelled.delete(userId);
        return false;
      }
      if (executing.has(userId) || existing.phase === 'executing') {
        cancelled.delete(userId);
        return false;
      }
      await clear(userId);
      if (revision(userId) !== expectedRevision) return false;
      startIdentities.delete(userId);
      void SafetyNotifications.cancelConfirmation(existing.sessionId);
      await clearSourceSession(userId, existing.kind, existing.sessionId, expectedRevision);
      if (revision(userId) !== expectedRevision) return false;
      notifyPhase(userId, null);
      return true;
    });
  },
  rollbackPrepared(userId: string, schedule: SafetyExpirationSchedule) {
    const expectedRevision = revision(userId);
    return enqueue(async () => {
      const current = await read(userId);
      if (revision(userId) !== expectedRevision || !sameIdentity(current, schedule) || executing.has(userId) || current?.phase === 'executing') return;
      if (schedule.nativeDeadlineGeneration && !SafeMeLinkSafety?.rollbackDeadlines(userId, schedule.sessionId, schedule.nativeDeadlineGeneration)) return;
      revisions.set(userId, expectedRevision + 1);
      cancelled.add(userId);
      await clear(userId);
      if (revision(userId) !== expectedRevision + 1) return;
      await clearSourceSession(userId, schedule.kind, schedule.sessionId, expectedRevision + 1);
      if (revision(userId) !== expectedRevision + 1) return;
      notifyPhase(userId, null);
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
  markConfirmationScheduled(userId: string, kind: SafetyExpirationKind, sessionId: string, generation?: string) {
    const expectedRevision = revision(userId);
    return enqueue(async () => {
      const existing = await read(userId);
      if (revision(userId) !== expectedRevision || cancelled.has(userId) || !existing || existing.kind !== kind || existing.sessionId !== sessionId ||
          (generation && existing.nativeDeadlineGeneration !== generation) || existing.phase !== 'waiting') return false;
      await save(userId, { ...existing, confirmationNotificationScheduled: true });
      return true;
    });
  },
  processDue(userId: string): Promise<{ schedule: SafetyExpirationSchedule | null; waitMs: number }> {
    const expectedRevision = revision(userId);
    return enqueue(async () => {
      try {
        trace('PROCESS_DUE_STARTED');
        if (cancelled.has(userId) && !executing.has(userId)) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        let schedule = await read(userId);
        if (revision(userId) !== expectedRevision) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        if (!schedule) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        if (schedule.phase === 'completed') {
          await clearSourceSession(userId, schedule.kind, schedule.sessionId, expectedRevision);
          if (revision(userId) !== expectedRevision) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
          if (schedule.nativeDeadlineGeneration) SafeMeLinkSafety?.finishDeadlines(userId, schedule.sessionId, schedule.nativeDeadlineGeneration);
          await clear(userId);
          notifyPhase(userId, null);
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        if (schedule.operationId && (schedule.phase === 'executing' || schedule.phase === 'recoverable') && !executing.has(userId)) {
          schedule = { ...schedule, phase: 'confirming' };
        }
        if (schedule.phase === 'failed' || schedule.phase === 'executing') {
          // After process death an executing claim has an unknown outcome. Never replay it.
          notifyPhase(userId, schedule.phase === 'executing' && !executing.has(userId)
            ? { ...schedule, phase: 'failed' } : schedule);
          return { schedule: executing.has(userId) ? schedule : null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        if (revision(userId) !== expectedRevision) return { schedule, waitMs: 0 };
        if (!(await sourceSessionExists(userId, schedule))) {
          if (revision(userId) !== expectedRevision) return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
          if (schedule.nativeDeadlineGeneration) SafeMeLinkSafety?.finishDeadlines(userId, schedule.sessionId, schedule.nativeDeadlineGeneration);
          await clear(userId);
          void SafetyNotifications.cancelConfirmation(schedule.sessionId);
          notifyPhase(userId, null);
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        if (revision(userId) !== expectedRevision || cancelled.has(userId)) {
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        const expiresAt = Date.parse(schedule.expiresAt);
        const confirmationExpiresAt = Date.parse(schedule.confirmationExpiresAt);
        if (schedule.phase === 'waiting' && Date.now() >= expiresAt && schedule.kind !== 'manual_sos') {
          trace('DEADLINE_DUE', schedule);
          schedule = { ...schedule, phase: 'confirming' };
          trace('PHASE_TRANSITION_STARTED', schedule);
          await save(userId, schedule);
          trace('PHASE_TRANSITION_COMPLETED', schedule);
          notifyPhase(userId, schedule);
          // A notification must never hold the deadline queue.
          if (!schedule.confirmationNotificationScheduled && Platform.OS !== 'android') {
            void SafetyNotifications.show(schedule.sessionId, schedule.kind);
          }
        }
        const nextDeadline = schedule.phase === 'waiting' ? expiresAt : confirmationExpiresAt;
        if (Date.now() < confirmationExpiresAt) {
          notifyPhase(userId, schedule);
          return { schedule, waitMs: Math.max(0, nextDeadline - Date.now()) };
        }
        if (revision(userId) !== expectedRevision) return { schedule, waitMs: 0 };
        if (Platform.OS === 'android' && schedule.kind !== 'manual_sos') {
          const generation = schedule.nativeDeadlineGeneration;
          if (!generation || !SafeMeLinkSafety?.claimEscalation(userId, schedule.sessionId, generation)) {
            // Another task owns the lease; recovery alarm is native, not a JS retry loop.
            const state = generation ? SafeMeLinkSafety?.escalationState(userId, schedule.sessionId, generation) : 'missing';
            if (state === 'failed' || state === 'missing') {
              const failed = { ...schedule, phase: 'failed' as const };
              await save(userId, failed);
              notifyPhase(userId, failed);
            }
            return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
          }
        }
        const claim = { ...schedule, phase: 'executing' as const };
        trace('SOS_EXECUTION_CLAIM_STARTED', claim);
        try {
          await save(userId, claim);
        } catch (error) {
          // No SOS call occurred: restore the recoverable pre-claim phase.
          if (schedule.nativeDeadlineGeneration) {
            SafeMeLinkSafety?.releaseEscalation(userId, schedule.sessionId, schedule.nativeDeadlineGeneration);
          }
          await save(userId, schedule).catch(() => reportSafetyError('claim_rollback'));
          throw error;
        }
        if (revision(userId) !== expectedRevision) {
          await clear(userId);
          notifyPhase(userId, null);
          return { schedule: null, waitMs: MAX_BACKGROUND_WAIT_MS };
        }
        executing.add(userId);
        trace('SOS_EXECUTION_CLAIMED', claim);
        notifyPhase(userId, claim);
        const completion = executeSOS(userId, claim).catch(() => reportSafetyError('completion_listener'));
        executionPromises.set(userId, completion);
        return { schedule: claim, waitMs: MAX_BACKGROUND_WAIT_MS };
      } catch (error) {
        reportSafetyError('deadline_transition');
        for (const listener of errorListeners) {
          try { listener(userId); } catch { reportSafetyError('error_listener'); }
        }
        throw error;
      } finally {
        trace('PROCESS_DUE_FINISHED');
      }
    });
  },
  get: read,
  getRevision: revision,
  waitForExecution(userId: string) {
    return executionPromises.get(userId) ?? Promise.resolve();
  },
  onPhaseChanged(listener: (userId: string, schedule: SafetyExpirationSchedule | null) => void) {
    phaseListeners.add(listener);
    return () => { phaseListeners.delete(listener); };
  },
  onError(listener: (userId: string) => void) {
    errorListeners.add(listener);
    return () => { errorListeners.delete(listener); };
  },
};
