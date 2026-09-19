import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';
import { reportSafetyError, SafetyOperationError, withSafetyTimeout } from '@/services/SafetyOperation';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';
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
  checkExactAlarmPermission() {
    const nativeSafety = SafeMeLinkSafety;
    if (Platform.OS === 'android') {
      if (!nativeSafety) throw new SafetyOperationError('exact_alarm_native_unavailable');
      const exactAllowed = nativeSafety.canScheduleExactAlarms();
      console.info('[SafetyNotification] EXACT_ALARM_CAPABILITY', { exactAllowed, nowMs: Date.now() });
      if (!exactAllowed) {
        Alert.alert('Autorizzazione necessaria',
          'Per avvisi puntuali abilita “Sveglie e promemoria” per SafeMeLink, poi avvia di nuovo il controllo.',
          [{ text: 'Annulla', style: 'cancel' }, { text: 'Apri impostazioni', onPress: () => {
            void nativeSafety.openExactAlarmSettings()
              .catch(() => Linking.openSettings()).catch(() => reportSafetyError('exact_alarm_settings'));
          } }]);
        throw new SafetyOperationError('exact_alarm_permission');
      }
    }
  },
  async scheduleConfirmation(sessionId: string, kind: string, expiresAt: string, nativeGeneration?: string) {
    const startedAt = Date.now();
    this.checkExactAlarmPermission();
    try {
      await ensureOperationalChannel(CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      if (Platform.OS === 'android') {
        if (!nativeGeneration || !SafeMeLinkSafety) throw new SafetyOperationError('native_deadline_missing');
        const permission = await withSafetyTimeout(Notifications.getPermissionsAsync(), 'notification_permission');
        if (!permission.granted) throw new SafetyOperationError('notification_permission');
        const armed = await withSafetyTimeout(SafeMeLinkSafety.armDeadlines(nativeGeneration, CHANNEL_ID), 'native_deadline_arm');
        if (!armed) throw new SafetyOperationError('native_deadline_stale');
        return true;
      }
      await withSafetyTimeout(Notifications.scheduleNotificationAsync({
        identifier: identifierFor(sessionId),
        content: contentFor(kind),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: Date.parse(expiresAt),
        },
      }), 'local_notification_schedule');
      console.info('[SafetyNotification] DEADLINE_SCHEDULED', {
        kind, deadline: expiresAt, deadlineMs: Date.parse(expiresAt), nowMs: Date.now(),
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      reportSafetyError('local_notification_schedule');
      if (error instanceof SafetyOperationError) throw error;
      throw new SafetyOperationError('local_notification_schedule');
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
