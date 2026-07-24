import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { AuthService } from '@/backend/auth/AuthService';
import { PushTokenRepository } from '@/backend/repositories/PushTokenRepository';

export const SOS_NOTIFICATION_CHANNEL_ID = 'sos-alerts';

const isExpoPushToken = (token: string) =>
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);

const tokenLabel = (token: string) => `...${token.slice(-10)}`;
let cachedExpoPushToken: string | null = null;
const registrationsByUser = new Map<string, Promise<string | null>>();

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

  const currentPermissions = await Notifications.getPermissionsAsync();
  const finalPermissions = currentPermissions.granted
    ? currentPermissions
    : await Notifications.requestPermissionsAsync();

  if (!finalPermissions.granted) {
    console.warn('[SafeMeLink Push] Permesso notifiche non concesso.', {
      userId,
      status: finalPermissions.status,
    });
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error('EAS projectId non disponibile: impossibile ottenere il token Expo Push.');
  }

  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });

  if (!isExpoPushToken(expoPushToken)) {
    throw new Error('Il dispositivo ha restituito un Expo Push Token non valido.');
  }

  const platform = Platform.OS;

  console.log('[SafeMeLink Push] Expo Push Token ottenuto.', {
    userId,
    token: tokenLabel(expoPushToken),
    platform,
  });

  const currentSession = await AuthService.getSession();

  if (currentSession?.user.id !== userId) {
    console.warn('[SafeMeLink Push] Registrazione annullata: account non più attivo.', { userId });
    return null;
  }

  await PushTokenRepository.upsertForUser({
    user_id: userId,
    expo_push_token: expoPushToken,
    platform,
    device_name: Device.modelName,
    active: true,
  });
  cachedExpoPushToken = expoPushToken;

  console.log('[SafeMeLink Push] Token associato all’utente.', {
    userId,
    token: tokenLabel(expoPushToken),
  });

  return expoPushToken;
}

async function unregisterDeviceForUser(userId: string) {
  await registrationsByUser.get(userId)?.catch(() => null);

  if (!cachedExpoPushToken) {
    return;
  }

  const tokenToDeactivate = cachedExpoPushToken;
  await PushTokenRepository.deactivateForUserAndToken(userId, tokenToDeactivate);

  if (cachedExpoPushToken === tokenToDeactivate) {
    cachedExpoPushToken = null;
  }
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
