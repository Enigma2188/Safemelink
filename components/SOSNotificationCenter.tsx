import * as Notifications from 'expo-notifications';
import {
  type Href,
  usePathname,
  useRootNavigationState,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import {
  isActiveSOSStatus,
  SOSLifecycleDiagnosticError,
  SOSLifecycleService,
} from '@/services/SOSLifecycleService';
import {
  parseSOSNotificationPayload,
  type SOSNotificationPayload,
} from '@/services/SOSNotificationPayload';

type ReceivedSOSState = 'unread' | 'opened' | 'dismissed';

type ReceivedSOSEvent = SOSNotificationPayload & {
  receivedAt: number;
};

const SOS_UNAVAILABLE_MESSAGE =
  'Questa emergenza non è più attiva o non è disponibile per il tuo account.';
const SOS_OPEN_ERROR_MESSAGE =
  'Impossibile verificare ora questa emergenza. Controlla la connessione e riprova.';

const isUnavailableSOS = (error: unknown) =>
  error instanceof SOSLifecycleDiagnosticError &&
  (error.category === 'invalid_sos_id' ||
    error.category === 'not_authorized_or_missing' ||
    error.category === 'unexpected_response');

export function SOSNotificationCenter() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<ReceivedSOSEvent[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const eventStatesRef = useRef(new Map<string, ReceivedSOSState>());
  const pathnameRef = useRef(pathname);
  const userIdRef = useRef(session?.user.id);
  const isMountedRef = useRef(true);
  const navigationInFlightRef = useRef(false);
  const openRequestGenerationRef = useRef(0);
  const navigationReadyRef = useRef(Boolean(rootNavigationState?.key));
  const pendingResponseRef = useRef<SOSNotificationPayload | null>(null);

  pathnameRef.current = pathname;
  userIdRef.current = session?.user.id;
  navigationReadyRef.current = Boolean(rootNavigationState?.key);

  const removeEvent = useCallback((sosId: string, state: ReceivedSOSState) => {
    eventStatesRef.current.set(sosId, state);
    setEvents((currentEvents) => currentEvents.filter((event) => event.sosId !== sosId));
    setOpenError(null);
  }, []);

  const navigateToSOS = useCallback(
    (sosId: string) => {
      if (navigationInFlightRef.current) {
        console.info('[SafeMeLink SOS ricevuto] Navigazione duplicata ignorata.');
        return;
      }

      const routePath = `/sos/${sosId}`;
      removeEvent(sosId, 'opened');

      if (pathnameRef.current === routePath) {
        console.info('[SafeMeLink SOS ricevuto] Dettaglio SOS già aperto.');
        return;
      }

      navigationInFlightRef.current = true;
      console.info('[SafeMeLink SOS ricevuto] Apertura dettaglio avviata.');

      try {
        router.push(routePath as Href);
        console.info('[SafeMeLink SOS ricevuto] Apertura dettaglio richiesta.');
      } catch {
        console.warn('[SafeMeLink SOS ricevuto] Apertura dettaglio non riuscita.', {
          category: 'navigation',
        });
      } finally {
        navigationInFlightRef.current = false;
      }
    },
    [removeEvent, router],
  );

  const enqueueForegroundSOS = useCallback((data: unknown) => {
    const payload = parseSOSNotificationPayload(data);

    if (!payload) {
      return;
    }

    if (!userIdRef.current) {
      console.warn('[SafeMeLink SOS ricevuto] Evento ignorato: sessione non disponibile.');
      return;
    }

    const routePath = `/sos/${payload.sosId}`;
    if (pathnameRef.current === routePath) {
      eventStatesRef.current.set(payload.sosId, 'opened');
      return;
    }

    if (eventStatesRef.current.has(payload.sosId)) {
      console.info('[SafeMeLink SOS ricevuto] Evento duplicato ignorato.');
      return;
    }

    eventStatesRef.current.set(payload.sosId, 'unread');
    setEvents((currentEvents) => [
      ...currentEvents,
      { ...payload, receivedAt: Date.now() },
    ]);
    setOpenError(null);
    console.info('[SafeMeLink SOS ricevuto] Avviso interno mostrato.');
  }, []);

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const payload = parseSOSNotificationPayload(
        response.notification.request.content.data,
      );

      if (!payload) {
        return;
      }

      if (eventStatesRef.current.get(payload.sosId) === 'opened') {
        console.info('[SafeMeLink SOS ricevuto] Risposta duplicata ignorata.');
        return;
      }

      if (!navigationReadyRef.current) {
        pendingResponseRef.current = payload;
        console.info('[SafeMeLink SOS ricevuto] Apertura in attesa della navigazione.');
        return;
      }

      openRequestGenerationRef.current += 1;
      setIsOpening(false);
      navigateToSOS(payload.sosId);
    },
    [navigateToSOS],
  );

  useEffect(() => {
    isMountedRef.current = true;
    const receivedSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        enqueueForegroundSOS(notification.request.content.data);
      },
    );
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response && isMountedRef.current) {
          handleNotificationResponse(response);
          void Notifications.clearLastNotificationResponseAsync().catch(() => {
            console.warn('[SafeMeLink SOS ricevuto] Pulizia risposta iniziale non riuscita.', {
              category: 'notification_response_cleanup',
            });
          });
        }
      })
      .catch(() => {
        console.warn('[SafeMeLink SOS ricevuto] Risposta iniziale non disponibile.', {
          category: 'notification_response_unavailable',
        });
      });

    return () => {
      isMountedRef.current = false;
      receivedSubscription.remove();
      responseSubscription.remove();
      navigationInFlightRef.current = false;
      openRequestGenerationRef.current += 1;
      pendingResponseRef.current = null;
    };
  }, [enqueueForegroundSOS, handleNotificationResponse]);

  useEffect(() => {
    if (!rootNavigationState?.key || !pendingResponseRef.current) {
      return;
    }

    const pendingResponse = pendingResponseRef.current;
    pendingResponseRef.current = null;
    openRequestGenerationRef.current += 1;
    setIsOpening(false);
    navigateToSOS(pendingResponse.sosId);
  }, [navigateToSOS, rootNavigationState?.key]);

  useEffect(() => {
    eventStatesRef.current.clear();
    setEvents([]);
    setOpenError(null);
    setNotice(null);
    setIsOpening(false);
    navigationInFlightRef.current = false;
    openRequestGenerationRef.current += 1;
  }, [session?.user.id]);

  const currentEvent = events[0] ?? null;

  const openCurrentSOS = useCallback(async () => {
    if (!currentEvent || isOpening || navigationInFlightRef.current) {
      return;
    }

    setIsOpening(true);
    setOpenError(null);
    const requestGeneration = ++openRequestGenerationRef.current;

    try {
      const remoteState = await SOSLifecycleService.getStatus(currentEvent.sosId);

      if (
        !isMountedRef.current ||
        requestGeneration !== openRequestGenerationRef.current
      ) {
        return;
      }

      if (!isActiveSOSStatus(remoteState.sos_status)) {
        removeEvent(currentEvent.sosId, 'dismissed');
        setNotice(SOS_UNAVAILABLE_MESSAGE);
        return;
      }

      navigateToSOS(currentEvent.sosId);
    } catch (error: unknown) {
      if (
        isMountedRef.current &&
        requestGeneration === openRequestGenerationRef.current
      ) {
        if (isUnavailableSOS(error)) {
          removeEvent(currentEvent.sosId, 'dismissed');
          setNotice(SOS_UNAVAILABLE_MESSAGE);
        } else {
          setOpenError(SOS_OPEN_ERROR_MESSAGE);
        }
      }
    } finally {
      if (
        isMountedRef.current &&
        requestGeneration === openRequestGenerationRef.current
      ) {
        setIsOpening(false);
      }
    }
  }, [currentEvent, isOpening, navigateToSOS, removeEvent]);

  const displayedEvent = notice ? null : currentEvent;

  if (!displayedEvent && !openError && !notice) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { paddingTop: insets.top + 8 }]}
    >
      <View
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        style={[styles.banner, !displayedEvent && styles.infoBanner]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>
            {displayedEvent ? 'SOS RICEVUTO' : 'AGGIORNAMENTO SOS'}
          </Text>
          <Pressable
            accessibilityLabel="Chiudi avviso SOS"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => {
              if (displayedEvent) {
                openRequestGenerationRef.current += 1;
                setIsOpening(false);
                removeEvent(displayedEvent.sosId, 'dismissed');
              } else {
                setOpenError(null);
                setNotice(null);
              }
            }}
          >
            <Text style={styles.closeText}>CHIUDI</Text>
          </Pressable>
        </View>

        <Text style={styles.message}>
          {notice ?? openError ?? 'Un utente SafeMeLink ha attivato un’emergenza.'}
        </Text>

        {displayedEvent ? (
          <>
            {events.length > 1 ? (
              <Text style={styles.queueText}>
                Altre emergenze in attesa: {events.length - 1}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isOpening}
              style={[styles.openButton, isOpening && styles.disabledButton]}
              onPress={() => void openCurrentSOS()}
            >
              <Text style={styles.openButtonText}>
                {isOpening ? 'VERIFICA IN CORSO…' : 'APRI EMERGENZA'}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    left: 12,
    position: 'absolute',
    right: 12,
    top: 0,
    zIndex: 1000,
  },
  banner: {
    backgroundColor: '#7F1024',
    borderColor: '#FF5A72',
    borderRadius: 16,
    borderWidth: 1,
    elevation: 12,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  infoBanner: {
    backgroundColor: '#17213A',
    borderColor: '#45B7FF',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  closeText: {
    color: '#FFE5EA',
    fontSize: 12,
    fontWeight: '800',
  },
  message: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
  },
  queueText: {
    color: '#FFD5DD',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  openButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  disabledButton: {
    opacity: 0.65,
  },
  openButtonText: {
    color: '#8D1027',
    fontSize: 14,
    fontWeight: '900',
  },
});
