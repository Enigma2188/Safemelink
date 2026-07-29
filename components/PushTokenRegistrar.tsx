import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { Alert, Linking } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import {
  NotificationPermissionError,
  PushNotificationService,
} from '@/services/PushNotificationService';

export function PushTokenRegistrar() {
  const { session, isInitializing } = useAuth();
  const router = useRouter();
  const registrationInProgressForUser = useRef<string | null>(null);
  const handledNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const notificationId = response.notification.request.identifier;

      if (handledNotificationIds.current.has(notificationId)) {
        return;
      }

      handledNotificationIds.current.add(notificationId);
      const data = response.notification.request.content.data;

      console.log('[SafeMeLink Push] Notifica aperta.', {
        type: data.type,
        sosId: data.sosId,
      });

      if (
        (data.type === 'sos_alert' || data.type === 'sos') &&
        typeof data.sosId === 'string'
      ) {
        const sosRoute = `/sos/${encodeURIComponent(data.sosId)}` as unknown as Href;
        router.push(sosRoute);
      }
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      console.log('[SafeMeLink Push] Notifica ricevuta in foreground.', {
        type: data.type,
        sosId: data.sosId,
      });
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          console.log('[SafeMeLink Push] Avvio app da notifica terminata.');
          handleResponse(response);
          void Notifications.clearLastNotificationResponseAsync();
        }
      })
      .catch((error: unknown) => {
        console.warn('[SafeMeLink Push] Lettura notifica di avvio non riuscita.', error);
      });

    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, [isInitializing, router]);

  useEffect(() => {
    const userId = session?.user.id;

    if (!userId || registrationInProgressForUser.current === userId) {
      return;
    }

    registrationInProgressForUser.current = userId;

    console.log('[SafeMeLink Push] Avvio registrazione dispositivo.', { userId });

    void PushNotificationService.registerDeviceForUser(userId)
      .catch((error: unknown) => {
        if (error instanceof NotificationPermissionError) {
          Alert.alert(
            'Notifiche non autorizzate',
            error.message,
            [
              { text: 'Non ora', style: 'cancel' },
              {
                text: 'Apri impostazioni',
                onPress: () => {
                  void Linking.openSettings().catch((settingsError: unknown) => {
                    console.warn(
                      '[SafeMeLink Push] Apertura impostazioni non riuscita.',
                      settingsError,
                    );
                  });
                },
              },
            ],
          );
        }

        console.warn('Registrazione Expo Push non riuscita.', error);
      })
      .finally(() => {
        if (registrationInProgressForUser.current === userId) {
          registrationInProgressForUser.current = null;
        }
      });
  }, [session?.user.id]);

  return null;
}
