import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { AuthService } from '@/backend/auth/AuthService';
import { PushTokenRepository } from '@/backend/repositories/PushTokenRepository';

export const SOS_NOTIFICATION_CHANNEL_ID = 'sos-alerts';

export class NotificationPermissionError extends Error {
  constructor(readonly permanentlyDenied = false) {
    super(
      permanentlyDenied
        ? 'Le notifiche sono disabilitate nelle impostazioni del dispositivo. Abilitale per ricevere gli SOS SafeMeLink.'
        : 'Le notifiche non sono autorizzate. Concedi il permesso per ricevere gli SOS SafeMeLink.',
    );
    this.name = 'NotificationPermissionError';
  }
}

const isExpoPushToken = (token: string) =>
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);

const tokenLabel = (token: string) => `...${token.slice(-10)}`;
const PUSH_NATIVE_STEP_TIMEOUT_MS = 15_000;
const PUSH_BACKEND_STEP_TIMEOUT_MS = 15_000;
const cachedExpoPushTokensByUser = new Map<string, string>();
const registrationsByUser = new Map<string, Promise<string | null>>();

const runPushStepWithTimeout = async <T,>(
  operation: Promise<T>,
  timeoutMs: number,
  step: string,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timeout registrazione push durante: ${step}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getExpoProjectId = () =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

async function getCurrentExpoPushToken() {
  const projectId = getExpoProjectId();

  if (!projectId) {
    throw new Error('EAS projectId non disponibile: impossibile ottenere il token Expo Push.');
  }

  console.log('[SafeMeLink Push] Richiesta Expo Push Token.', { projectId });
  const { data: expoPushToken } = await runPushStepWithTimeout(
    Notifications.getExpoPushTokenAsync({ projectId }),
    PUSH_NATIVE_STEP_TIMEOUT_MS,
    'ottenimento Expo Push Token',
  );

  if (!isExpoPushToken(expoPushToken)) {
    throw new Error('Il dispositivo ha restituito un Expo Push Token non valido.');
  }

  return expoPushToken;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerDevice(userId: string) {
  if (!Device.isDevice || (Platform.OS !== 'android' && Platform.OS !== 'ios')) {
    console.log('[SafeMeLink Push] Registrazione ignorata: serve un dispositivo fisico mobile.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SOS_NOTIFICATION_CHANNEL_ID, {
      name: 'SafeMeLink SOS',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#DC2626',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    });
    console.log('[SafeMeLink Push] Canale Android SOS pronto.', {
      channelId: SOS_NOTIFICATION_CHANNEL_ID,
    });
  }

  const currentPermissions = await runPushStepWithTimeout(
    Notifications.getPermissionsAsync(),
    PUSH_NATIVE_STEP_TIMEOUT_MS,
    'lettura permessi notifiche',
  );
  const finalPermissions = currentPermissions.granted
    ? currentPermissions
    : await runPushStepWithTimeout(
        Notifications.requestPermissionsAsync(),
        PUSH_NATIVE_STEP_TIMEOUT_MS,
        'richiesta permessi notifiche',
      );

  if (!finalPermissions.granted) {
    console.warn('[SafeMeLink Push] Permesso notifiche non concesso.', {
      userId,
      status: finalPermissions.status,
      canAskAgain: finalPermissions.canAskAgain,
    });
    throw new NotificationPermissionError(!finalPermissions.canAskAgain);
  }

  console.log('[SafeMeLink Push] Permessi notifiche verificati.', {
    userId,
    status: finalPermissions.status,
    canAskAgain: finalPermissions.canAskAgain,
  });

  const expoPushToken = await getCurrentExpoPushToken();

  const platform = Platform.OS;

  console.log('[SafeMeLink Push] Expo Push Token ottenuto.', {
    userId,
    token: tokenLabel(expoPushToken),
    platform,
  });

  const currentSession = await runPushStepWithTimeout(
    AuthService.getSession(),
    PUSH_BACKEND_STEP_TIMEOUT_MS,
    'verifica sessione Supabase',
  );

  if (currentSession?.user.id !== userId) {
    console.warn('[SafeMeLink Push] Registrazione annullata: account non più attivo.', { userId });
    return null;
  }

  console.log('[SafeMeLink Push] Upsert token avviato.', {
    userId,
    token: tokenLabel(expoPushToken),
  });
  await runPushStepWithTimeout(
    PushTokenRepository.upsertForUser({
      user_id: userId,
      expo_push_token: expoPushToken,
      platform,
      device_name: Device.modelName,
      active: true,
    }),
    PUSH_BACKEND_STEP_TIMEOUT_MS,
    'upsert device_push_tokens',
  );
  cachedExpoPushTokensByUser.set(userId, expoPushToken);

  console.log('[SafeMeLink Push] Token associato all’utente.', {
    userId,
    token: tokenLabel(expoPushToken),
  });

  return expoPushToken;
}

async function unregisterDeviceForUser(userId: string) {
  await registrationsByUser.get(userId)?.catch(() => null);

  let tokenToDeactivate = cachedExpoPushTokensByUser.get(userId) ?? null;

  if (!tokenToDeactivate && Device.isDevice) {
    try {
      tokenToDeactivate = await getCurrentExpoPushToken();
    } catch (error) {
      console.warn('[SafeMeLink Push] Token corrente non recuperabile durante il logout.', {
        userId,
        error,
      });
    }
  }

  if (!tokenToDeactivate) {
    console.warn('[SafeMeLink Push] Nessun token da disattivare durante il logout.', { userId });
    return;
  }

  await PushTokenRepository.deactivateForUserAndToken(userId, tokenToDeactivate);
  cachedExpoPushTokensByUser.delete(userId);
}

export const PushNotificationService = {
  registerDeviceForUser(userId: string) {
    const existingRequest = registrationsByUser.get(userId);

    if (existingRequest) {
      return existingRequest;
    }

    const request = registerDevice(userId).finally(() => {
      if (registrationsByUser.get(userId) === request) {
        registrationsByUser.delete(userId);
      }
    });
    registrationsByUser.set(userId, request);
    return request;
  },

  unregisterDeviceForUser,
};
