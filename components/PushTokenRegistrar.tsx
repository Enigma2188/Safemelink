import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, AppState, Linking } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import {
  NotificationPermissionError,
  PushNotificationService,
} from '@/services/PushNotificationService';

const MAX_AUTOMATIC_RETRY_ATTEMPTS = 5;

export function PushTokenRegistrar() {
  const { isOffline, session } = useAuth();
  const permissionAlertShownForUser = useRef(new Set<string>());
  const channelAlertShown = useRef(false);

  useEffect(() => {
    const userId = session?.user.id;

    if (!userId || isOffline) {
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

      if (retryAttempt >= MAX_AUTOMATIC_RETRY_ATTEMPTS) {
        console.warn('[SafeMeLink Push] Tentativi automatici sospesi.', {
          retryAttempt,
        });
        return;
      }

      const delayMs = Math.min(60_000, 5_000 * 2 ** retryAttempt);
      retryAttempt += 1;
      console.warn('[SafeMeLink Push] Nuovo tentativo registrazione programmato.', {
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
      if (reason !== 'retry') {
        retryAttempt = 0;
      }
      console.log('[SafeMeLink Push] Avvio registrazione dispositivo.', {
        reason,
      });

      try {
        const token = await PushNotificationService.registerDeviceForUser(userId);

        if (!isCurrent) {
          return;
        }

        if (token) {
          retryAttempt = 0;
          void PushNotificationService.isSOSChannelSilenced().then((silenced) => {
            if (!isCurrent || !silenced || channelAlertShown.current) return;
            channelAlertShown.current = true;
            Alert.alert('Avvisi SOS silenziati',
              'Il canale SOS non ha un avviso sonoro attivo. Puoi verificarlo nelle impostazioni Android. Non disturbare e modalità silenziosa restano rispettati.', [
                { text: 'Non ora', style: 'cancel' },
                { text: 'Apri impostazioni', onPress: () => {
                  void PushNotificationService.openSOSChannelSettings().catch(() => console.warn('[SafeMeLink Push] Apertura impostazioni non riuscita.'));
                } },
              ]);
          }).catch(() => console.warn('[SafeMeLink Push] Stato canale non verificabile.'));
          console.log('[SafeMeLink Push] Registrazione dispositivo verificata.', {
            reason,
          });
        } else {
          console.warn('[SafeMeLink Push] Registrazione senza token, nuovo tentativo necessario.', {
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
                        {
                          category:
                            settingsError instanceof Error ? settingsError.name : 'unknown',
                        },
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
          reason,
          category: error instanceof Error ? error.name : 'unknown',
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
        reason: 'token_changed',
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
  }, [isOffline, session?.user.id]);

  return null;
}
