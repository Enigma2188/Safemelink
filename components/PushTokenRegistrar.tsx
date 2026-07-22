import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

import { useAuth } from '@/backend/auth/AuthProvider';
import { PushNotificationService } from '@/services/PushNotificationService';

export function PushTokenRegistrar() {
  const { session } = useAuth();
  const router = useRouter();
  const registrationInProgressForUser = useRef<string | null>(null);
  const handledNotificationIds = useRef(new Set<string>());

  useEffect(() => {
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

      if (data.type === 'sos' && typeof data.sosId === 'string') {
        router.replace('/');
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
  }, [router]);

  useEffect(() => {
    const userId = session?.user.id;

    if (!userId || registrationInProgressForUser.current === userId) {
      return;
    }

    registrationInProgressForUser.current = userId;

    console.log('[SafeMeLink Push] Avvio registrazione dispositivo.', { userId });

    void PushNotificationService.registerDeviceForUser(userId)
      .catch((error: unknown) => {
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
