import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';
import { withSafetyTimeout } from '@/services/SafetyOperation';

export const SAFETY_NOTIFICATION_CHANNEL_ID = 'safety-checks';
const warnedChannels = new Set<string>();

export const channelIsSilent = (channel: Notifications.NotificationChannel | null) =>
  channel !== null && (channel.importance < Notifications.AndroidImportance.DEFAULT || channel.sound === null);

export async function openOperationalChannelSettings(channelId: string) {
  const packageName = Constants.expoConfig?.android?.package;
  if (Platform.OS === 'android' && packageName) {
    try {
      await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: packageName },
        { key: 'android.provider.extra.CHANNEL_ID', value: channelId },
      ]);
      return;
    } catch { console.warn('[NotificationSound] CHANNEL_SETTINGS_UNAVAILABLE'); }
  }
  await Linking.openSettings();
}

export async function ensureOperationalChannel(id: string, name: string, importance: Notifications.AndroidImportance) {
  if (Platform.OS !== 'android') return null;
  let channel = await withSafetyTimeout(Notifications.getNotificationChannelAsync(id), 'notification_channel_read');
  // Existing settings belong to Android/the user. Recreating the same ID cannot
  // repair an old silent channel; choosing a new ID would bypass a possible mute.
  if (!channel) {
    await withSafetyTimeout(Notifications.setNotificationChannelAsync(id, {
      name, importance, sound: 'default', enableVibrate: true,
      vibrationPattern: [0, 500, 250, 500], bypassDnd: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        flags: { enforceAudibility: false, requestHardwareAudioVideoSynchronization: false },
      },
    }), 'notification_channel_create');
    channel = await withSafetyTimeout(Notifications.getNotificationChannelAsync(id), 'notification_channel_read');
  }
  console.info('[NotificationSound] CHANNEL_STATE', {
    channelId: id, exists: channel !== null, importance: channel?.importance ?? null,
    sound: channel?.sound ?? null, vibration: channel?.enableVibrate ?? null,
  });
  return channel;
}

export function warnSilentOperationalChannel(id: string, channel: Notifications.NotificationChannel | null) {
  if (!channelIsSilent(channel) || warnedChannels.has(id)) return;
  warnedChannels.add(id);
  Alert.alert('Avvisi di sicurezza silenziati',
    'Gli avvisi “Stai bene?” non hanno un suono attivo. Puoi abilitarlo nelle impostazioni Android. Non disturbare e modalità silenziosa restano rispettati.', [
      { text: 'Non ora', style: 'cancel' },
      { text: 'Apri impostazioni', onPress: () => {
        void openOperationalChannelSettings(id).catch(() => console.warn('[NotificationSound] SETTINGS_OPEN_FAILED'));
      } },
    ]);
}
