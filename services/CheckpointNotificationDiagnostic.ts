import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';

// Default OFF. Enabled only by the manual Android diagnostic APK workflow.
export const checkpointDiagnosticsEnabled = () => Platform.OS === 'android' &&
  process.env.EXPO_PUBLIC_CHECKPOINT_DIAGNOSTICS === 'true';

export async function runCheckpointNotificationDiagnostic() {
  if (!checkpointDiagnosticsEnabled()) throw new Error('Diagnostica non abilitata in questa build.');
  if (!SafeMeLinkSafety?.testCheckpointNotification) throw new Error('Diagnostica nativa non disponibile: serve una APK contenente il modulo aggiornato.');
  // Read only: no permission prompt, scheduling API, location or backend access.
  const permission = await Notifications.getPermissionsAsync();
  const native = await SafeMeLinkSafety.testCheckpointNotification();
  return { permissionGranted: permission.granted, canAskAgain: permission.canAskAgain, native };
}
