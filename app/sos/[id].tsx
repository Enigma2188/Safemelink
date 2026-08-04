import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { ReceivedSOSRepository } from '@/backend/repositories/ReceivedSOSRepository';
import {
  isActiveSOSStatus,
  SOSLifecycleService,
  type SOSLifecycleState,
} from '@/services/SOSLifecycleService';

type ReceivedSOS = Awaited<ReturnType<typeof ReceivedSOSRepository.getById>>;

const statusLabels: Record<ReceivedSOS['sos_status'], string> = {
  open: 'Attivo',
  accepted: 'Accettato',
  closed: 'Chiuso',
  cancelled: 'Annullato',
};

export default function ReceivedSOSScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id;
  const sosId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [sos, setSOS] = useState<ReceivedSOS | null>(null);
  const [remoteState, setRemoteState] = useState<SOSLifecycleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const activeUserIdRef = useRef<string | undefined>(userId);
  const backNavigationInFlightRef = useRef(false);
  const backNavigationCompletedRef = useRef(false);
  activeUserIdRef.current = userId;

  useEffect(
    () => () => {
      if (backNavigationInFlightRef.current) {
        console.info('[SafeMeLink Navigation] ritorno SOS annullato nel cleanup.', {
          origin: '/sos/[id]',
        });
      }
      backNavigationInFlightRef.current = false;
    },
    [],
  );

  useEffect(() => {
    setSOS(null);
    setRemoteState(null);
    setError(null);
    setIsAccepting(false);

    if (isInitializing) {
      return;
    }

    if (!userId) {
      setError('Accedi per visualizzare questo SOS.');
      return;
    }

    if (!sosId) {
      setError('Identificativo SOS non disponibile.');
      return;
    }

    let isCurrent = true;
    let requestInFlight = false;
    let refreshInterval: ReturnType<typeof setInterval> | null = null;

    const loadSOS = async () => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;

      try {
        const nextRemoteState = await SOSLifecycleService.getStatus(sosId);

        if (!isCurrent || activeUserIdRef.current !== userId) {
          return;
        }

        setRemoteState(nextRemoteState);

        if (!isActiveSOSStatus(nextRemoteState.sos_status)) {
          setSOS(null);
          setError(null);
          if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
          }
          return;
        }

        const result = await ReceivedSOSRepository.getById(sosId);

        if (isCurrent && activeUserIdRef.current === userId) {
          setSOS(result);
          setError(null);
        }
      } catch (loadError: unknown) {
        if (isCurrent && activeUserIdRef.current === userId) {
          setSOS(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Impossibile caricare il dettaglio SOS.',
          );
        }
      } finally {
        requestInFlight = false;
      }
    };

    void loadSOS();
    refreshInterval = setInterval(() => void loadSOS(), 15_000);

    return () => {
      isCurrent = false;
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [isInitializing, sosId, userId]);

  const acceptSOS = async () => {
    if (!sosId || !userId || isAccepting) {
      return;
    }

    const actionUserId = userId;
    setIsAccepting(true);
    setError(null);

    try {
      const nextState = await SOSLifecycleService.accept(sosId);

      if (activeUserIdRef.current === actionUserId) {
        setRemoteState(nextState);
      }
    } catch (acceptError: unknown) {
      if (activeUserIdRef.current === actionUserId) {
        setError(
          acceptError instanceof Error
            ? acceptError.message
            : 'Impossibile accettare l’SOS.',
        );
      }
    } finally {
      if (activeUserIdRef.current === actionUserId) {
        setIsAccepting(false);
      }
    }
  };

  const openMap = async () => {
    if (!sos) {
      return;
    }

    const mapUrl = `https://maps.google.com/?q=${sos.latitude},${sos.longitude}`;

    try {
      await Linking.openURL(mapUrl);
    } catch {
      setError('Impossibile aprire la posizione nella mappa.');
    }
  };

  const goBack = useCallback(() => {
    if (backNavigationInFlightRef.current || backNavigationCompletedRef.current) {
      console.info('[SafeMeLink Navigation] ritorno SOS duplicato ignorato.', {
        origin: '/sos/[id]',
      });
      return;
    }

    backNavigationInFlightRef.current = true;
    const startedAt = Date.now();
    const canGoBack = router.canGoBack();
    const destination = canGoBack ? 'schermata precedente' : '/';
    console.info('[SafeMeLink Navigation] inizio ritorno SOS.', {
      origin: '/sos/[id]',
      destination,
    });

    try {
      if (canGoBack) {
        router.back();
      } else {
        router.replace('/');
      }
      backNavigationCompletedRef.current = true;
      console.info('[SafeMeLink Navigation] fine ritorno SOS.', {
        origin: '/sos/[id]',
        destination,
        durationMs: Date.now() - startedAt,
      });
    } catch (navigationError) {
      console.error('[SafeMeLink Navigation] errore ritorno SOS.', {
        origin: '/sos/[id]',
        destination,
        durationMs: Date.now() - startedAt,
        error:
          navigationError instanceof Error
            ? navigationError.message
            : 'Errore sconosciuto.',
      });
    } finally {
      backNavigationInFlightRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });

    return () => subscription.remove();
  }, [goBack]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>SOS SafeMeLink</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!remoteState && !error ? <Text style={styles.loading}>Caricamento SOS…</Text> : null}

      {sos ? (
        <View style={styles.card}>
          <Text style={styles.name}>{sos.sender_display_name}</Text>
          <Text style={styles.alert}>Ha attivato una richiesta di aiuto.</Text>

          <Text style={styles.label}>Stato</Text>
          <Text style={styles.value}>
            {statusLabels[remoteState?.sos_status ?? sos.sos_status]}
          </Text>

          <Text style={styles.label}>Data e ora</Text>
          <Text style={styles.value}>{new Date(sos.event_time).toLocaleString()}</Text>

          <Text style={styles.label}>Coordinate</Text>
          <Text style={styles.value}>
            {sos.latitude}, {sos.longitude}
          </Text>

          <Text style={styles.label}>Identificativo evento</Text>
          <Text selectable style={styles.eventId}>{sos.sos_id}</Text>

          <Pressable style={styles.primaryButton} onPress={() => void openMap()}>
            <Text style={styles.primaryButtonText}>Apri posizione nella mappa</Text>
          </Pressable>

          {remoteState?.sos_status === 'open' ? (
            <Pressable
              disabled={isAccepting}
              style={[styles.acceptButton, isAccepting && styles.disabledButton]}
              onPress={() => void acceptSOS()}>
              <Text style={styles.primaryButtonText}>
                {isAccepting ? 'Accettazione…' : 'Prendi in carico SOS'}
              </Text>
            </Pressable>
          ) : null}

          {remoteState?.accepted_by_me ? (
            <Text style={styles.acceptedText}>Hai preso in carico questo SOS.</Text>
          ) : null}
        </View>
      ) : null}

      {remoteState && !isActiveSOSStatus(remoteState.sos_status) ? (
        <View style={styles.card}>
          <Text style={styles.label}>Stato</Text>
          <Text style={styles.value}>{statusLabels[remoteState.sos_status]}</Text>
          <Text style={styles.closedNotice}>
            L’emergenza non è più attiva. Coordinate e dati protetti non sono più disponibili.
          </Text>
          <Text style={styles.label}>Identificativo evento</Text>
          <Text selectable style={styles.eventId}>{remoteState.sos_id}</Text>
        </View>
      ) : null}

      <Pressable
        disabled={backNavigationInFlightRef.current || backNavigationCompletedRef.current}
        style={styles.secondaryButton}
        onPress={goBack}>
        <Text style={styles.secondaryButtonText}>Indietro</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f7f9fb',
    flexGrow: 1,
    padding: 20,
    paddingTop: 64,
  },
  title: {
    color: '#b71c1c',
    fontSize: 30,
    fontWeight: '900',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 18,
  },
  name: {
    color: '#11181c',
    fontSize: 22,
    fontWeight: '900',
  },
  alert: {
    color: '#b71c1c',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 18,
    marginTop: 4,
  },
  label: {
    color: '#687076',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
  },
  value: {
    color: '#11181c',
    fontSize: 16,
    marginTop: 2,
  },
  eventId: {
    color: '#52616b',
    fontSize: 12,
    marginTop: 3,
  },
  primaryButton: {
    backgroundColor: '#b71c1c',
    borderRadius: 6,
    marginTop: 22,
    padding: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  acceptButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 6,
    marginTop: 12,
    padding: 14,
  },
  disabledButton: {
    opacity: 0.6,
  },
  acceptedText: {
    color: '#0a7ea4',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
  },
  closedNotice: {
    color: '#52616b',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 14,
  },
  secondaryButton: {
    marginTop: 14,
    padding: 12,
  },
  secondaryButtonText: {
    color: '#0a7ea4',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  loading: {
    color: '#52616b',
    fontSize: 16,
  },
  error: {
    color: '#b71c1c',
    fontSize: 16,
    lineHeight: 22,
  },
});
