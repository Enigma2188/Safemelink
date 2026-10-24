import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';

// Default OFF. Enabled only by the manual Android diagnostic APK workflow.
export const checkpointDiagnosticsEnabled = () => Platform.OS === 'android' &&
  process.env.EXPO_PUBLIC_CHECKPOINT_DIAGNOSTICS === 'true';

export type CheckpointAlarmProbeResult = {
  status: 'idle' | 'scheduled' | 'schedule_failed' | 'receiver_entered';
  deadline?: number;
  alarmRequestAt?: number;
  alarmReturnedAt?: number;
  enteredAt?: number;
  wallDelayMs?: number;
  elapsedDelayMs?: number;
  clockUncertain?: boolean;
};

export function parseCheckpointAlarmProbe(raw: string): CheckpointAlarmProbeResult {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid probe result');
  if (!('status' in value)) return { status: 'idle' };
  const status = value.status;
  if (status !== 'scheduled' && status !== 'schedule_failed' && status !== 'receiver_entered') throw new Error('Invalid probe status');
  const result: CheckpointAlarmProbeResult = { status };
  for (const key of ['deadline', 'alarmRequestAt', 'alarmReturnedAt', 'enteredAt', 'wallDelayMs', 'elapsedDelayMs'] as const) {
    if (key in value) {
      const field = (value as Record<string, unknown>)[key];
      if (typeof field !== 'number' || !Number.isFinite(field)) throw new Error('Invalid probe time');
      result[key] = field;
    }
  }
  if ('clockUncertain' in value && typeof value.clockUncertain === 'boolean') result.clockUncertain = value.clockUncertain;
  if (result.deadline === undefined) throw new Error('Missing probe deadline');
  if (status === 'receiver_entered' && [result.enteredAt, result.wallDelayMs, result.elapsedDelayMs].some(field => field === undefined)) throw new Error('Incomplete probe receipt');
  return result;
}

export async function runCheckpointNotificationDiagnostic() {
  if (!checkpointDiagnosticsEnabled()) throw new Error('Diagnostica non abilitata in questa build.');
  if (!SafeMeLinkSafety?.testCheckpointNotification) throw new Error('Diagnostica nativa non disponibile: serve una APK contenente il modulo aggiornato.');
  // Read only: no permission prompt, scheduling API, location or backend access.
  const permission = await Notifications.getPermissionsAsync();
  const native = await SafeMeLinkSafety.testCheckpointNotification();
  return { permissionGranted: permission.granted, canAskAgain: permission.canAskAgain, native };
}
