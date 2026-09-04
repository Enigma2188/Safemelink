import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reportSafetyError, withSafetyTimeout } from '@/services/SafetyOperation';

const CHANNEL_ID = 'safety-checks';

export const SafetyNotifications = {
  async configure() {
    if (Platform.OS === 'android') {
      await withSafetyTimeout(Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Verifiche di sicurezza',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 500, 250, 500],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      }), 'notification_channel');
    }
    const permission = await withSafetyTimeout(Notifications.getPermissionsAsync(), 'notification_permission');
    if (permission.granted) return true;
    const requested = await withSafetyTimeout(Notifications.requestPermissionsAsync(), 'notification_permission');
    return requested.granted;
  },

  async show(sessionId: string, kind: string, failed = false) {
    try {
      await withSafetyTimeout(Notifications.scheduleNotificationAsync({
      identifier: `safety-${sessionId}-${failed ? 'failed' : 'confirm'}`,
      content: {
        title: failed ? 'SOS automatico non completato' : kind === 'checkpoint' ? 'Checkpoint scaduto' : 'Torno a casa',
        body: failed ? 'Apri SafeMeLink e verifica lo stato dell’SOS.' : 'Stai bene? Apri SafeMeLink per confermare entro 30 secondi.',
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
      }), 'local_notification');
    } catch {
      reportSafetyError('local_notification');
    }
  },
};
