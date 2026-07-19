import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { PushTokenRepository } from '@/backend/repositories/PushTokenRepository';

const SOS_NOTIFICATION_CHANNEL_ID = 'safemelink-sos';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const PushNotificationService = {
  async registerDeviceForUser(userId: string) {
    if (!Device.isDevice || (Platform.OS !== 'android' && Platform.OS !== 'ios')) {
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(SOS_NOTIFICATION_CHANNEL_ID, {
        name: 'SafeMeLink SOS',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#DC2626',
      });
    }

    const currentPermissions = await Notifications.getPermissionsAsync();
    const finalPermissions = currentPermissions.granted
      ? currentPermissions
      : await Notifications.requestPermissionsAsync();

    if (!finalPermissions.granted) {
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

    if (!projectId) {
      throw new Error('EAS projectId non disponibile: impossibile ottenere il token Expo Push.');
    }

    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform = Platform.OS;

    await PushTokenRepository.upsertForUser({
      user_id: userId,
      expo_push_token: expoPushToken,
      platform,
      device_name: Device.modelName,
      active: true,
    });

    return expoPushToken;
  },
};
