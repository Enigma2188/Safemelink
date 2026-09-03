import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Linking, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

import { SafetyExpirationRuntime } from '@/services/SafetyExpirationRuntime';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { SOSService } from '@/services/SOSService';
import {
  type VoiceProtectionDurationMinutes,
  VoiceProtectionStorage,
} from '@/storage/VoiceProtectionStorage';

const TASK_MAX_SLEEP_MS = 60_000;
const RECOGNITION_READINESS_TIMEOUT_MS = 5_000;
let activeTaskUserId: string | null = null;

type VoiceProtectionTaskData = {
  expiresAt: string | null;
  userId: string;
};

export type VoiceProtectionPermissionState = {
  microphoneGranted: boolean;
  notificationsGranted: boolean;
};

export type VoiceRecognitionReadiness =
  | 'ready'
  | 'recognition_unavailable'
  | 'on_device_unavailable'
  | 'italian_model_missing'
  | 'model_status_unknown';

const normalizeLocale = (locale: string) => locale.replace('_', '-').toLowerCase();

const runVoiceProtectionTask = async (taskData?: VoiceProtectionTaskData) => {
  let taskExpiresAtMs = taskData?.expiresAt
    ? new Date(taskData.expiresAt).getTime()
    : null;
  while (BackgroundService.isRunning()) {
    const taskUserId = taskData?.userId ?? null;
    if (taskExpiresAtMs !== null && taskUserId && Date.now() >= taskExpiresAtMs) {
      try {
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {}
        const storedSettings = await VoiceProtectionStorage.get(taskUserId);
        await VoiceProtectionStorage.save(taskUserId, {
          ...storedSettings,
          enabled: false,
          enabledAt: null,
          expiresAt: null,
        });
      } catch {
        console.warn('[VoiceProtection] scadenza non salvata nello storage locale');
      } finally {
        VoiceProtectionRuntime.notifySettingsChanged(taskUserId);
        taskExpiresAtMs = null;
      }
    }

    if (taskUserId && VoiceProtectionRuntime.claimDueSOS(taskUserId)) {
      VoiceProtectionRuntime.notifySOSExecutionStarted(taskUserId);
      try {
        const result = await SOSService.completeSOS(taskUserId, {
          allowRemoteDelivery: true,
          allowRecentNetworkLocation: true,
          allowInteractiveFallback: false,
        });
        VoiceProtectionRuntime.notifySOSCompleted(taskUserId, result);
      } catch (error: unknown) {
        console.warn('[VoiceProtection] completamento SOS non riuscito', {
          category: error instanceof Error ? error.name : 'unknown',
        });
        VoiceProtectionRuntime.notifySOSFailed(taskUserId, error);
      } finally {
        VoiceProtectionRuntime.finishSOSExecution();
      }
      continue;
    }

    const safetyExpiration = taskUserId
      ? await SafetyExpirationRuntime.processDue(taskUserId)
      : { schedule: null, waitMs: TASK_MAX_SLEEP_MS };
    const storedVoiceSettings = taskUserId
      ? await VoiceProtectionStorage.get(taskUserId).catch(() => null)
      : null;
    const voiceStillEnabled =
      storedVoiceSettings?.enabled === true &&
      (storedVoiceSettings.expiresAt === null ||
        Date.parse(storedVoiceSettings.expiresAt) > Date.now());
    if (!voiceStillEnabled && !safetyExpiration.schedule) {
      await BackgroundService.stop().catch(() => {});
      break;
    }

    const protectionWaitMs =
      taskExpiresAtMs === null
        ? TASK_MAX_SLEEP_MS
        : Math.max(0, taskExpiresAtMs - Date.now());
    const voiceHasPendingSOS = taskUserId
      ? VoiceProtectionRuntime.getScheduledSOS(taskUserId) !== null
      : false;
    const voiceWaitMs = taskUserId && (voiceStillEnabled || voiceHasPendingSOS)
      ? VoiceProtectionRuntime.getBackgroundWaitMs(
          taskUserId,
          Math.min(TASK_MAX_SLEEP_MS, protectionWaitMs),
        )
      : Number.POSITIVE_INFINITY;
    const waitMs = Math.min(voiceWaitMs, safetyExpiration.waitMs);
    await VoiceProtectionRuntime.waitForBackgroundWake(waitMs);
  }
};

const calculateExpiresAt = (durationMinutes: VoiceProtectionDurationMinutes) =>
  durationMinutes === 0
    ? null
    : new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

export const VoiceProtectionService = {
  isRunning() {
    return BackgroundService.isRunning();
  },

  async getPermissionState(): Promise<VoiceProtectionPermissionState> {
    const [speechPermission, notificationPermission] = await Promise.all([
      ExpoSpeechRecognitionModule.getPermissionsAsync(),
      Notifications.getPermissionsAsync(),
    ]);

    return {
      microphoneGranted: speechPermission.granted,
      notificationsGranted: notificationPermission.granted,
    };
  },

  async requestPermissions(): Promise<VoiceProtectionPermissionState> {
    const speechPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    const notificationPermission = await Notifications.requestPermissionsAsync();

    return {
      microphoneGranted: speechPermission.granted,
      notificationsGranted: notificationPermission.granted,
    };
  },

  async getRecognitionReadiness(locale = 'it-IT'): Promise<VoiceRecognitionReadiness> {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return 'recognition_unavailable';
    }
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      return 'on_device_unavailable';
    }
    if (Platform.OS !== 'android') {
      return 'ready';
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const { installedLocales } = await Promise.race([
        ExpoSpeechRecognitionModule.getSupportedLocales({}),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('recognition_readiness_timeout')),
            RECOGNITION_READINESS_TIMEOUT_MS,
          );
        }),
      ]);
      const expectedLocale = normalizeLocale(locale);
      const expectedLanguage = expectedLocale.split('-')[0];
      const modelInstalled = installedLocales.some((installedLocale) => {
        const normalizedLocale = normalizeLocale(installedLocale);
        return (
          normalizedLocale === expectedLocale ||
          normalizedLocale.split('-')[0] === expectedLanguage
        );
      });

      if (modelInstalled) {
        return 'ready';
      }

      const androidApiLevel =
        typeof Platform.Version === 'number'
          ? Platform.Version
          : Number.parseInt(String(Platform.Version), 10);
      return androidApiLevel >= 33 ? 'italian_model_missing' : 'model_status_unknown';
    } catch {
      return 'model_status_unknown';
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  },

  async requestItalianModelDownload() {
    if (Platform.OS !== 'android') {
      throw new Error('Download del modello disponibile soltanto su Android.');
    }
    return ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: 'it-IT' });
  },

  async start(userId: string, durationMinutes: VoiceProtectionDurationMinutes) {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      throw new Error('Protezione Vocale è disponibile soltanto su Android e iOS.');
    }

    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
    if (activeTaskUserId && activeTaskUserId !== userId) {
      VoiceProtectionRuntime.cancelScheduledSOS(activeTaskUserId);
    }

    const expiresAt = calculateExpiresAt(durationMinutes);
    await BackgroundService.start<VoiceProtectionTaskData>(runVoiceProtectionTask, {
      taskName: 'SafeMeLinkVoiceProtection',
      taskTitle: 'Protezione Vocale attiva',
      taskDesc: 'SafeMeLink mantiene pronta la protezione locale.',
      taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
      },
      color: '#7868FF',
      foregroundServiceType: ['microphone', 'location', 'specialUse'],
      linkingURI: 'safemelink://voice-protection',
      parameters: {
        expiresAt,
        userId,
      },
    });
    activeTaskUserId = userId;

    return {
      enabledAt: new Date().toISOString(),
      expiresAt,
    };
  },

  async ensureSafetyMonitoring(userId: string) {
    if (BackgroundService.isRunning() && activeTaskUserId === userId) {
      VoiceProtectionRuntime.wakeBackgroundTask();
      return;
    }
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
    const voiceSettings = await VoiceProtectionStorage.get(userId).catch(() => null);
    const voiceEnabled = voiceSettings?.enabled === true;
    await BackgroundService.start<VoiceProtectionTaskData>(runVoiceProtectionTask, {
      taskName: 'SafeMeLinkSafetyExpiration',
      taskTitle: 'Controllo sicurezza attivo',
      taskDesc: 'SafeMeLink controlla una scadenza di sicurezza.',
      taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
      },
      color: '#7868FF',
      foregroundServiceType: voiceEnabled
        ? ['microphone', 'location', 'specialUse']
        : ['specialUse'],
      linkingURI: 'safemelink://',
      parameters: {
        expiresAt: voiceEnabled ? voiceSettings.expiresAt : null,
        userId,
      },
    });
    activeTaskUserId = userId;
  },

  async releaseSafetyMonitoring(userId: string) {
    if (activeTaskUserId !== userId) return;
    const [safetySchedule, voiceSettings] = await Promise.all([
      SafetyExpirationRuntime.get(userId),
      VoiceProtectionStorage.get(userId).catch(() => null),
    ]);
    if (safetySchedule || voiceSettings?.enabled) {
      VoiceProtectionRuntime.wakeBackgroundTask();
      return;
    }
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
    activeTaskUserId = null;
  },

  async stop() {
    if (activeTaskUserId) {
      VoiceProtectionRuntime.cancelScheduledSOS(activeTaskUserId);
    }
    VoiceProtectionRuntime.wakeBackgroundTask();
    const safetySchedule = activeTaskUserId
      ? await SafetyExpirationRuntime.get(activeTaskUserId).catch(() => null)
      : null;
    if (BackgroundService.isRunning() && !safetySchedule) {
      await BackgroundService.stop();
    }
    if (!safetySchedule) activeTaskUserId = null;
  },

  async openBatterySettings() {
    if (Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      return;
    }

    await Linking.openSettings();
  },
};
