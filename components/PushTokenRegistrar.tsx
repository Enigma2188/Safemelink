import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { Alert, AppState, Linking } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import {
  NotificationPermissionError,
  PushNotificationService,
} from '@/services/PushNotificationService';

export function PushTokenRegistrar() {
  const { session, isInitializing } = useAuth();
  const router = useRouter();
  const handledNotificationIds = useRef(new Set<string>());
  const permissionAlertShownForUser = useRef(new Set<string>());

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

    if (!userId) {
      return;
    }

    let isCurrent = true;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleRetry = () => {
      if (!isCurrent || retryTimer) {
        return;
      }

      const delayMs = Math.min(60_000, 5_000 * 2 ** retryAttempt);
      retryAttempt += 1;
      console.warn('[SafeMeLink Push] Nuovo tentativo registrazione programmato.', {
        userId,
        retryAttempt,
        delayMs,
      });
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void registerDevice('retry');
      }, delayMs);
    };

    const registerDevice = async (reason: 'login' | 'foreground' | 'token_changed' | 'retry') => {
      clearRetry();
      console.log('[SafeMeLink Push] Avvio registrazione dispositivo.', {
        userId,
        reason,
      });

      try {
        const token = await PushNotificationService.registerDeviceForUser(userId);

        if (!isCurrent) {
          return;
        }

        if (token) {
          retryAttempt = 0;
          console.log('[SafeMeLink Push] Registrazione dispositivo verificata.', {
            userId,
            reason,
          });
        } else {
          console.warn('[SafeMeLink Push] Registrazione senza token, nuovo tentativo necessario.', {
            userId,
            reason,
          });
          scheduleRetry();
        }
      } catch (error: unknown) {
        if (!isCurrent) {
          return;
        }

        if (error instanceof NotificationPermissionError) {
          if (!permissionAlertShownForUser.current.has(userId)) {
            permissionAlertShownForUser.current.add(userId);
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
        } else {
          scheduleRetry();
        }

        console.warn('[SafeMeLink Push] Registrazione Expo Push non riuscita.', {
          userId,
          reason,
          error,
        });
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        permissionAlertShownForUser.current.delete(userId);
        void registerDevice('foreground');
      }
    });
    const pushTokenSubscription = Notifications.addPushTokenListener(() => {
      console.log('[SafeMeLink Push] Token nativo modificato, sincronizzazione richiesta.', {
        userId,
      });
      void registerDevice('token_changed');
    });

    void registerDevice('login');

    return () => {
      isCurrent = false;
      clearRetry();
      appStateSubscription.remove();
      pushTokenSubscription.remove();
    };
  }, [session?.user.id]);

  return null;
}
