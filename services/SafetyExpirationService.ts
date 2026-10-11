import { SafetyExpirationRuntime } from '@/services/SafetyExpirationRuntime';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import type { SafetyExpirationKind, SafetyExpirationSchedule } from '@/storage/SafetyExpirationStorage';
import { reportSafetyError, withSafetyTimeout } from '@/services/SafetyOperation';
import { SafetyNotifications } from '@/services/SafetyNotifications';
import { Platform } from 'react-native';

export const SafetyExpirationService = {
  async schedule(
    userId: string,
    kind: SafetyExpirationKind,
    sessionId: string,
    expiresAt: string,
    confirmationSeconds: number,
  ) {
    let prepared: SafetyExpirationSchedule | undefined;
    try {
      const schedule = await SafetyExpirationRuntime.schedule(
        userId,
        kind,
        sessionId,
        expiresAt,
        confirmationSeconds,
      );
      prepared = schedule;
      if (kind !== 'manual_sos') {
        const notificationScheduled = await SafetyNotifications.scheduleConfirmation(
          sessionId,
          kind,
          expiresAt,
          schedule.nativeDeadlineGeneration,
        );
        if (notificationScheduled) {
          const retained = await SafetyExpirationRuntime.markConfirmationScheduled(
            userId,
            kind,
            sessionId,
            schedule.nativeDeadlineGeneration,
          );
          if (!retained) void SafetyNotifications.cancelConfirmation(sessionId);
        }
      }
      if (kind === 'manual_sos' || Platform.OS !== 'android') await VoiceProtectionService.ensureSafetyMonitoring(userId);
      VoiceProtectionRuntime.wakeBackgroundTask();
      return schedule;
    } catch (error) {
      // A stale arm failure must never cancel a newer generation (including Repeat).
      if (prepared?.nativeDeadlineGeneration) {
        await SafetyExpirationRuntime.rollbackPrepared(userId, prepared).catch(() => reportSafetyError('arm_rollback'));
      } else if (prepared && (kind === 'manual_sos' || Platform.OS !== 'android')) {
        await SafetyExpirationRuntime.cancel(userId, kind, sessionId).catch(() => reportSafetyError('arm_rollback'));
      }
      await VoiceProtectionService.releaseSafetyMonitoring(userId).catch(() => reportSafetyError('service_rollback'));
      throw error;
    }
  },

  async ensure(
    userId: string,
    kind: SafetyExpirationKind,
    sessionId: string,
    expiresAt: string,
    confirmationSeconds: number,
    expectedRevision?: number,
  ) {
    const schedule = await SafetyExpirationRuntime.ensure(
      userId,
      kind,
      sessionId,
      expiresAt,
      confirmationSeconds,
      expectedRevision,
    );
    if (
      kind !== 'manual_sos' &&
      (schedule.phase === 'waiting' || (Platform.OS === 'android' && schedule.phase === 'confirming')) &&
      (Platform.OS === 'android' || !schedule.confirmationNotificationScheduled) &&
      (Platform.OS === 'android' || Date.parse(expiresAt) > Date.now())
    ) {
      const notificationScheduled = await SafetyNotifications.scheduleConfirmation(
        sessionId,
        kind,
        schedule.expiresAt,
        schedule.nativeDeadlineGeneration,
      );
      if (notificationScheduled) {
        await SafetyExpirationRuntime.markConfirmationScheduled(userId, kind, sessionId, schedule.nativeDeadlineGeneration);
      }
    }
    if (schedule.phase === 'failed' || schedule.phase === 'executing') return schedule;
    if (kind === 'manual_sos' || Platform.OS !== 'android') await VoiceProtectionService.ensureSafetyMonitoring(userId);
    VoiceProtectionRuntime.wakeBackgroundTask();
    return schedule;
  },

  async cancel(userId: string, kind?: SafetyExpirationKind, sessionId?: string) {
    const cancelled = await SafetyExpirationRuntime.cancel(userId, kind, sessionId);
    VoiceProtectionRuntime.wakeBackgroundTask();
    await VoiceProtectionService.releaseSafetyMonitoring(userId).catch(() => reportSafetyError('service_release'));
    return cancelled;
  },

  processDue(userId: string) {
    VoiceProtectionRuntime.wakeBackgroundTask();
    return SafetyExpirationRuntime.processDue(userId);
  },

  configureNotifications() {
    return SafetyNotifications.configure().catch(() => {
      reportSafetyError('notification_setup');
      return false;
    });
  },

  async startManual(userId: string, expiresAt: string) {
    return this.schedule(userId, 'manual_sos', expiresAt, expiresAt, 0);
  },

  async reconcile(userId: string) {
    const expectedRevision = SafetyExpirationRuntime.getRevision(userId);
    const schedule = await SafetyExpirationRuntime.get(userId);
    // Re-arm identical PendingIntents: storage flags are not OS registration proof.
    if (Platform.OS === 'android' && schedule && schedule.kind !== 'manual_sos' &&
        (schedule.phase === 'waiting' || schedule.phase === 'confirming')) {
      await this.ensure(userId, schedule.kind, schedule.sessionId, schedule.expiresAt,
        (Date.parse(schedule.confirmationExpiresAt) - Date.parse(schedule.expiresAt)) / 1_000, expectedRevision);
    }
    if (schedule && schedule.phase !== 'failed' && schedule.phase !== 'executing' &&
      (schedule.kind === 'manual_sos' || Platform.OS !== 'android')) {
      await VoiceProtectionService.ensureSafetyMonitoring(userId);
    }
    await this.processDue(userId);
    return SafetyExpirationRuntime.get(userId);
  },

  async expedite(userId: string) {
    await withSafetyTimeout(VoiceProtectionService.ensureSafetyMonitoring(userId), 'service_start', 15_000);
    return SafetyExpirationRuntime.expedite(userId);
  },
};
