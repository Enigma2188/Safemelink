import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Linking, Platform } from 'react-native';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';
import { ensureOperationalChannel, openOperationalChannelSettings, SAFETY_NOTIFICATION_CHANNEL_ID } from '@/services/OperationalNotificationChannels';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';

export type SetupRequirement = 'notifications' | 'channel' | 'location' | 'gps' | 'background' | 'microphone' | 'alarms' | 'visibility' | 'battery';
export type SetupStatus = 'ready' | 'missing' | 'unknown';
export type SetupSnapshot = Record<SetupRequirement, SetupStatus>;
const permissionStatus = (p: { granted: boolean }): SetupStatus => p.granted ? 'ready' : 'missing';
const inspect = async (read: () => Promise<SetupStatus>): Promise<SetupStatus> => {
  try { return await read(); } catch { return 'unknown'; }
};

// Inspection never requests permissions, creates channels, starts listeners or arms alarms.
export async function readSecuritySetup(): Promise<SetupSnapshot> {
  const [notifications, channel, location, gps, background, microphone, alarms] = await Promise.all([
    inspect(async () => permissionStatus(await Notifications.getPermissionsAsync())),
    inspect(async () => {
      if (Number(Platform.Version) < 26) return 'ready';
      const c = await Notifications.getNotificationChannelAsync(SAFETY_NOTIFICATION_CHANNEL_ID);
      return c && c.importance >= Notifications.AndroidImportance.HIGH && c.sound ? 'ready' : 'missing';
    }),
    inspect(async () => permissionStatus(await Location.getForegroundPermissionsAsync())),
    inspect(async () => await Location.hasServicesEnabledAsync() ? 'ready' : 'missing'),
    inspect(async () => permissionStatus(await Location.getBackgroundPermissionsAsync())),
    inspect(async () => permissionStatus(await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync())),
    inspect(async () => SafeMeLinkSafety ? (SafeMeLinkSafety.canScheduleExactAlarms() ? 'ready' : 'missing') : 'unknown'),
  ]);
  return { notifications, channel, location, gps, background, microphone, alarms, visibility: 'unknown', battery: 'unknown' };
}

async function requestOrSettings(get: () => Promise<{ granted: boolean; canAskAgain: boolean }>, request: () => Promise<unknown>) {
  const permission = await get();
  if (permission.granted) return;
  if (permission.canAskAgain) await request();
  else await Linking.openSettings();
}

// Exactly one contextual action per tap; never chain unrelated permission dialogs.
export async function configureSecurityRequirement(id: SetupRequirement): Promise<void> {
  if (Platform.OS !== 'android') return;
  switch (id) {
    case 'notifications':
      await ensureOperationalChannel(SAFETY_NOTIFICATION_CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      await requestOrSettings(Notifications.getPermissionsAsync, Notifications.requestPermissionsAsync); return;
    case 'channel':
      await ensureOperationalChannel(SAFETY_NOTIFICATION_CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      await openOperationalChannelSettings(SAFETY_NOTIFICATION_CHANNEL_ID); return;
    case 'visibility': await openOperationalChannelSettings(SAFETY_NOTIFICATION_CHANNEL_ID); return;
    case 'location': await requestOrSettings(Location.getForegroundPermissionsAsync, Location.requestForegroundPermissionsAsync); return;
    case 'gps': await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS'); return;
    case 'background':
      if (!(await Location.getForegroundPermissionsAsync()).granted) throw new Error('Prima configura la posizione durante l’uso.');
      await requestOrSettings(Location.getBackgroundPermissionsAsync, Location.requestBackgroundPermissionsAsync); return;
    case 'microphone':
      await requestOrSettings(() => ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync(), () => ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()); return;
    case 'alarms':
      if (!SafeMeLinkSafety) throw new Error('Controllo nativo non disponibile in questa installazione.');
      await SafeMeLinkSafety.openExactAlarmSettings(); return;
    case 'battery': await VoiceProtectionService.openBatterySettings(); return;
  }
}
