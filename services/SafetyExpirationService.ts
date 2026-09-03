import { SafetyExpirationRuntime } from '@/services/SafetyExpirationRuntime';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import type { SafetyExpirationKind } from '@/storage/SafetyExpirationStorage';

export const SafetyExpirationService = {
  async schedule(
    userId: string,
    kind: SafetyExpirationKind,
    sessionId: string,
    expiresAt: string,
    confirmationSeconds: number,
  ) {
    const schedule = await SafetyExpirationRuntime.schedule(
      userId,
      kind,
      sessionId,
      expiresAt,
      confirmationSeconds,
    );
    try {
      await VoiceProtectionService.ensureSafetyMonitoring(userId);
      VoiceProtectionRuntime.wakeBackgroundTask();
      return schedule;
    } catch (error) {
      await SafetyExpirationRuntime.cancel(userId, kind, sessionId).catch(() => undefined);
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
    await VoiceProtectionService.ensureSafetyMonitoring(userId);
    VoiceProtectionRuntime.wakeBackgroundTask();
    return schedule;
  },

  async cancel(userId: string, kind?: SafetyExpirationKind, sessionId?: string) {
    const cancelled = await SafetyExpirationRuntime.cancel(userId, kind, sessionId);
    await VoiceProtectionService.releaseSafetyMonitoring(userId).catch(() => undefined);
    return cancelled;
  },

  processDue(userId: string) {
    VoiceProtectionRuntime.wakeBackgroundTask();
    return SafetyExpirationRuntime.processDue(userId);
  },
};
