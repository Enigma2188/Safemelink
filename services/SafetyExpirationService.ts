import { SafetyExpirationRuntime } from '@/services/SafetyExpirationRuntime';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import type { SafetyExpirationKind } from '@/storage/SafetyExpirationStorage';
import { reportSafetyError, withSafetyTimeout } from '@/services/SafetyOperation';
import { SafetyNotifications } from '@/services/SafetyNotifications';

export const SafetyExpirationService = {
  async schedule(
    userId: string,
    kind: SafetyExpirationKind,
    sessionId: string,
    expiresAt: string,
    confirmationSeconds: number,
  ) {
    try {
    const schedule = await SafetyExpirationRuntime.schedule(
      userId,
      kind,
      sessionId,
      expiresAt,
      confirmationSeconds,
    );
      await VoiceProtectionService.ensureSafetyMonitoring(userId);
      VoiceProtectionRuntime.wakeBackgroundTask();
      return schedule;
    } catch (error) {
      await SafetyExpirationRuntime.cancel(userId, kind, sessionId).catch(() => reportSafetyError('arm_rollback'));
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
  ) {
    const schedule = await SafetyExpirationRuntime.ensure(
      userId,
      kind,
      sessionId,
      expiresAt,
      confirmationSeconds,
    );
    if (schedule.phase === 'failed' || schedule.phase === 'executing') return schedule;
    await VoiceProtectionService.ensureSafetyMonitoring(userId);
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
    const schedule = await SafetyExpirationRuntime.get(userId);
    if (schedule && schedule.phase !== 'failed' && schedule.phase !== 'executing') {
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
