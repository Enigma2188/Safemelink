import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Linking, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

import {
  type VoiceProtectionDurationMinutes,
  VoiceProtectionStorage,
} from '@/storage/VoiceProtectionStorage';

const TASK_CHECK_INTERVAL_MS = 1000;

type VoiceProtectionTaskData = {
  expiresAt: string | null;
  userId: string;
};

export type VoiceProtectionPermissionState = {
  microphoneGranted: boolean;
  notificationsGranted: boolean;
};

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

const runVoiceProtectionTask = async (taskData?: VoiceProtectionTaskData) => {
  while (BackgroundService.isRunning()) {
    if (taskData?.expiresAt && Date.now() >= new Date(taskData.expiresAt).getTime()) {
      const storedSettings = await VoiceProtectionStorage.get(taskData.userId);
      await VoiceProtectionStorage.save(taskData.userId, {
        ...storedSettings,
        enabled: false,
        enabledAt: null,
        expiresAt: null,
      });
      await BackgroundService.stop();
      break;
    }

    await sleep(TASK_CHECK_INTERVAL_MS);
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

  async start(userId: string, durationMinutes: VoiceProtectionDurationMinutes) {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      throw new Error('Protezione Vocale è disponibile soltanto su Android e iOS.');
    }

    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
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
      foregroundServiceType: ['microphone'],
      linkingURI: 'safemelink://voice-protection',
      parameters: {
        expiresAt,
        userId,
      },
    });

    return {
      enabledAt: new Date().toISOString(),
      expiresAt,
    };
  },

  async stop() {
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
  },

  async openBatterySettings() {
    if (Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      return;
    }

    await Linking.openSettings();
  },
};
