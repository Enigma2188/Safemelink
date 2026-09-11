import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reportSafetyError, withSafetyTimeout } from '@/services/SafetyOperation';
import { ensureOperationalChannel, SAFETY_NOTIFICATION_CHANNEL_ID, warnSilentOperationalChannel } from '@/services/OperationalNotificationChannels';

const CHANNEL_ID = SAFETY_NOTIFICATION_CHANNEL_ID;
const identifierFor = (sessionId: string) => `safety-${sessionId}-confirm`;
const contentFor = (kind: string) => ({
  title: kind === 'checkpoint' ? 'Checkpoint scaduto' : 'Torno a casa',
  body: 'Stai bene? Apri SafeMeLink per confermare entro 30 secondi.',
  sound: 'default' as const,
  data: { type: 'safety_check' },
});

export const SafetyNotifications = {
  async scheduleConfirmation(sessionId: string, kind: string, expiresAt: string) {
    const startedAt = Date.now();
    try {
      await ensureOperationalChannel(CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      await withSafetyTimeout(Notifications.scheduleNotificationAsync({
        identifier: identifierFor(sessionId),
        content: contentFor(kind),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: Date.parse(expiresAt),
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
        },
      }), 'local_notification_schedule');
      console.info('[SafetyNotification] DEADLINE_SCHEDULED', {
        kind, deadline: expiresAt, deadlineMs: Date.parse(expiresAt), nowMs: Date.now(),
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch {
      reportSafetyError('local_notification_schedule');
      return false;
    }
  },

  async cancelConfirmation(sessionId: string) {
    try {
      await withSafetyTimeout(
        Notifications.cancelScheduledNotificationAsync(identifierFor(sessionId)),
        'local_notification_cancel',
      );
    } catch { reportSafetyError('local_notification_cancel'); }
  },

  async configure() {
    if (Platform.OS === 'android') {
      const channel = await ensureOperationalChannel(CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      warnSilentOperationalChannel(CHANNEL_ID, channel);
    }
    const permission = await withSafetyTimeout(Notifications.getPermissionsAsync(), 'notification_permission');
    if (permission.granted) return true;
    const requested = await withSafetyTimeout(Notifications.requestPermissionsAsync(), 'notification_permission');
    return requested.granted;
  },

  async show(sessionId: string, kind: string, failed = false) {
    try {
      await ensureOperationalChannel(CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      console.info('[SafetyNotification] DISPATCH_STARTED', { kind, nowMs: Date.now() });
      await withSafetyTimeout(Notifications.scheduleNotificationAsync({
      identifier: `safety-${sessionId}-${failed ? 'failed' : 'confirm-now'}`,
      content: {
        title: failed ? 'SOS automatico non completato' : kind === 'checkpoint' ? 'Checkpoint scaduto' : 'Torno a casa',
        body: failed ? 'Apri SafeMeLink e verifica lo stato dell’SOS.' : 'Stai bene? Apri SafeMeLink per confermare entro 30 secondi.',
        sound: 'default',
        data: { type: 'safety_check' },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
      }), 'local_notification');
      console.info('[SafetyNotification] DISPATCH_RESOLVED', { kind, nowMs: Date.now() });
    } catch {
      reportSafetyError('local_notification');
      console.warn('[SafetyNotification] DISPATCH_REJECTED', { kind, nowMs: Date.now() });
    }
  },
};
