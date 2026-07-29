import { type Href, Link, useFocusEffect } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import { LocationService } from '@/services/LocationService';
import { SOSLifecycleService } from '@/services/SOSLifecycleService';
import {
  SOSService,
  type ActiveSOSEvent,
  type SOSEvent,
  type SOSTerminalStatus,
} from '@/services/SOSService';
import { CheckpointStorage } from '@/storage/CheckpointStorage';
import { GoHomeStorage, type GoHomeSession, type HomeLocation } from '@/storage/GoHomeStorage';
import { normalizePassphrase, PassphraseStorage, type SavedPassphrase } from '@/storage/PassphraseStorage';
import { SOSStorage } from '@/storage/SOSStorage';

const SAFETY_TIMER_SECONDS = 10;
const CHECKPOINT_CONFIRM_SECONDS = 30;
const CHECKPOINT_OPTIONS_MINUTES = [5, 10, 15, 30];
const GO_HOME_CONFIRM_SECONDS = 30;
const WALKING_SPEED_KM_H = 5;
const GO_HOME_SAFETY_MARGIN = 1.3;
const PASSPHRASE_COOLDOWN_MS = 10000;
const SPEECH_RECOGNITION_LANGUAGE = 'it-IT';

type SOSStatus = 'idle' | 'countdown' | 'sending' | 'active';
type CheckpointStatus = 'idle' | 'running' | 'confirming';
type GoHomeStatus = 'idle' | 'estimating' | 'running' | 'confirming';
type PassphraseMode = 'idle' | 'recording' | 'listening';
type HomePanel = 'home' | 'checkpoint' | 'goHome' | 'passphrase';

const logoImage = require('../../assets/images/occhio safemelink definitivo.png');

const formatTimer = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const calculateDistanceKm = (
  firstLocation: Pick<HomeLocation, 'latitude' | 'longitude'>,
  secondLocation: Pick<HomeLocation, 'latitude' | 'longitude'>
) => {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(secondLocation.latitude - firstLocation.latitude);
  const longitudeDelta = toRadians(secondLocation.longitude - firstLocation.longitude);
  const firstLatitude = toRadians(firstLocation.latitude);
  const secondLatitude = toRadians(secondLocation.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const estimateWalkingMinutes = (distanceKm: number) =>
  Math.max(1, Math.round((distanceKm / WALKING_SPEED_KM_H) * 60 * GO_HOME_SAFETY_MARGIN));

export default function HomeScreen() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [lastEvents, setLastEvents] = useState<SOSEvent[]>([]);
  const [activeEvent, setActiveEvent] = useState<ActiveSOSEvent | null>(null);
  const [isEndingSOS, setIsEndingSOS] = useState(false);
  const [status, setStatus] = useState<SOSStatus>('idle');
  const [remainingSeconds, setRemainingSeconds] = useState(SAFETY_TIMER_SECONDS);
  const [checkpointStatus, setCheckpointStatus] = useState<CheckpointStatus>('idle');
  const [checkpointMinutes, setCheckpointMinutes] = useState(CHECKPOINT_OPTIONS_MINUTES[0]);
  const [checkpointRemainingSeconds, setCheckpointRemainingSeconds] = useState(0);
  const [checkpointConfirmSeconds, setCheckpointConfirmSeconds] = useState(CHECKPOINT_CONFIRM_SECONDS);
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);
  const [goHomeStatus, setGoHomeStatus] = useState<GoHomeStatus>('idle');
  const [goHomeSession, setGoHomeSession] = useState<GoHomeSession | null>(null);
  const [goHomeRemainingSeconds, setGoHomeRemainingSeconds] = useState(0);
  const [goHomeConfirmSeconds, setGoHomeConfirmSeconds] = useState(GO_HOME_CONFIRM_SECONDS);
  const [savedPassphrase, setSavedPassphrase] = useState<SavedPassphrase | null>(null);
  const [passphraseMode, setPassphraseMode] = useState<PassphraseMode>('idle');
  const [passphraseDraft, setPassphraseDraft] = useState('');
  const [lastRecognizedPassphraseText, setLastRecognizedPassphraseText] = useState('');
  const [passphraseError, setPassphraseError] = useState('');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<HomePanel>('home');
  const passphraseModeRef = useRef<PassphraseMode>('idle');
  const savedPassphraseRef = useRef<SavedPassphrase | null>(null);
  const passphraseCooldownUntilRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(userId);
  const loadGenerationRef = useRef(0);
  const sosCompletionInFlightRef = useRef(false);
  const nebulaPulse = useRef(new Animated.Value(0)).current;
  const logoGlowPulse = useRef(new Animated.Value(0)).current;
  const sosGlowPulse = useRef(new Animated.Value(0)).current;

  const latestEvent = useMemo(() => lastEvents[0], [lastEvents]);
  const passphraseIsConfigured = Boolean(savedPassphrase);
  activeUserIdRef.current = userId;

  useEffect(() => {
    const nebulaAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(nebulaPulse, {
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(nebulaPulse, {
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );
    const logoAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlowPulse, {
          duration: 8000,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(logoGlowPulse, {
          duration: 8000,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );
    const sosAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(sosGlowPulse, {
          duration: 7000,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(sosGlowPulse, {
          duration: 7000,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    nebulaAnimation.start();
    logoAnimation.start();
    sosAnimation.start();

    return () => {
      nebulaAnimation.stop();
      logoAnimation.stop();
      sosAnimation.stop();
    };
  }, [logoGlowPulse, nebulaPulse, sosGlowPulse]);

  const startSOSCountdown = useCallback(() => {
    if (contacts.length === 0) {
      Alert.alert('Contatti fidati', 'Aggiungi almeno un contatto fidato prima di usare SOS.');
      return;
    }

    setRemainingSeconds(SAFETY_TIMER_SECONDS);
    setActiveEvent(null);
    setStatus('countdown');
  }, [contacts.length]);

  useEffect(() => {
    passphraseModeRef.current = passphraseMode;
  }, [passphraseMode]);

  useEffect(() => {
    savedPassphraseRef.current = savedPassphrase;
  }, [savedPassphrase]);

  const stopPassphraseRecognition = useCallback(() => {
    passphraseModeRef.current = 'idle';
    setPassphraseMode('idle');

    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }, []);

  const startPassphraseRecognition = useCallback(
    async (mode: Exclude<PassphraseMode, 'idle'>) => {
      setPassphraseError('');

      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setPassphraseError('Riconoscimento vocale non disponibile su questo dispositivo.');
        return;
      }

      if (mode === 'listening' && !savedPassphraseRef.current) {
        setPassphraseError('Registra prima una parola d ordine.');
        return;
      }

      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

        if (permission.status !== 'granted') {
          setPassphraseError('Permesso microfono o riconoscimento vocale non concesso.');
          return;
        }

        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {}

        passphraseModeRef.current = mode;
        setPassphraseMode(mode);

        if (mode === 'recording') {
          setPassphraseDraft('');
        }

        ExpoSpeechRecognitionModule.start({
          lang: SPEECH_RECOGNITION_LANGUAGE,
          interimResults: true,
          maxAlternatives: 3,
          continuous: mode === 'listening',
          contextualStrings: savedPassphraseRef.current ? [savedPassphraseRef.current.text] : undefined,
        });
      } catch (error) {
        passphraseModeRef.current = 'idle';
        setPassphraseMode('idle');
        setPassphraseError(error instanceof Error ? error.message : 'Non riesco ad avviare il riconoscimento vocale.');
      }
    },
    []
  );

  const triggerPassphraseSOS = useCallback(() => {
    const now = Date.now();

    if (now < passphraseCooldownUntilRef.current) {
      return;
    }

    passphraseCooldownUntilRef.current = now + PASSPHRASE_COOLDOWN_MS;
    stopPassphraseRecognition();
    startSOSCountdown();
  }, [startSOSCountdown, stopPassphraseRecognition]);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();

    if (!transcript) {
      return;
    }

    setLastRecognizedPassphraseText(transcript);

    if (passphraseModeRef.current === 'recording') {
      setPassphraseDraft(transcript);

      if (event.isFinal) {
        stopPassphraseRecognition();
      }

      return;
    }

    const passphrase = savedPassphraseRef.current;

    if (!passphrase || passphraseModeRef.current !== 'listening') {
      return;
    }

    const normalizedTranscript = normalizePassphrase(transcript);

    if (
      normalizedTranscript === passphrase.normalizedText ||
      normalizedTranscript.includes(passphrase.normalizedText)
    ) {
      triggerPassphraseSOS();
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (event.error === 'aborted') {
      return;
    }

    setPassphraseError(event.message || 'Errore riconoscimento vocale.');
    passphraseModeRef.current = 'idle';
    setPassphraseMode('idle');
  });

  useSpeechRecognitionEvent('end', () => {
    if (passphraseModeRef.current !== 'listening') {
      return;
    }

    setTimeout(() => {
      if (passphraseModeRef.current === 'listening') {
        try {
          ExpoSpeechRecognitionModule.start({
            lang: SPEECH_RECOGNITION_LANGUAGE,
            interimResults: true,
            maxAlternatives: 3,
            continuous: true,
            contextualStrings: savedPassphraseRef.current ? [savedPassphraseRef.current.text] : undefined,
          });
        } catch (error) {
          passphraseModeRef.current = 'idle';
          setPassphraseMode('idle');
          setPassphraseError(error instanceof Error ? error.message : 'Ascolto interrotto.');
        }
      }
    }, 400);
  });

  useEffect(() => () => stopPassphraseRecognition(), [stopPassphraseRecognition]);

  const resetSensitiveState = useCallback(() => {
    stopPassphraseRecognition();
    setContacts([]);
    setLastEvents([]);
    setActiveEvent(null);
    setIsEndingSOS(false);
    setStatus('idle');
    setRemainingSeconds(SAFETY_TIMER_SECONDS);
    setCheckpointStatus('idle');
    setCheckpointRemainingSeconds(0);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
    setHomeLocation(null);
    setGoHomeStatus('idle');
    setGoHomeSession(null);
    setGoHomeRemainingSeconds(0);
    setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
    setSavedPassphrase(null);
    setPassphraseDraft('');
    setLastRecognizedPassphraseText('');
    setPassphraseError('');
    passphraseCooldownUntilRef.current = 0;
  }, [stopPassphraseRecognition]);

  const loadSOSData = useCallback(async () => {
    const loadUserId = userId;
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;

    if (isInitializing || !loadUserId) {
      return;
    }

    try {
      const [storedContacts, storedEvents, storedHomeLocation, storedPassphrase] =
        await Promise.all([
          ContactsService.list(),
          SOSStorage.listEvents(loadUserId),
          GoHomeStorage.getHomeLocation(loadUserId),
          PassphraseStorage.get(loadUserId),
        ]);
      let nextEvents = storedEvents;
      let restoredActiveEvent: ActiveSOSEvent | null = null;
      const latestStoredEvent = storedEvents[0];

      if (
        latestStoredEvent?.remoteSosId &&
        latestStoredEvent.location &&
        latestStoredEvent.message
      ) {
        try {
          const remoteState = await SOSLifecycleService.getStatus(
            latestStoredEvent.remoteSosId,
          );

          if (
            remoteState.sos_status === 'open' ||
            remoteState.sos_status === 'accepted'
          ) {
            restoredActiveEvent = {
              ...latestStoredEvent,
              location: latestStoredEvent.location,
              message: latestStoredEvent.message,
              remoteStatus: remoteState.sos_status,
            };
          } else {
            nextEvents = await SOSStorage.finalizeEvent(
              loadUserId,
              latestStoredEvent.id,
              remoteState.sos_status,
            );
          }
        } catch (statusError: unknown) {
          console.warn(
            '[SafeMeLink SOS] Stato remoto temporaneamente non disponibile.',
            statusError,
          );
        }
      }

      if (
        activeUserIdRef.current !== loadUserId ||
        loadGenerationRef.current !== loadGeneration
      ) {
        return;
      }

      setContacts(storedContacts);
      setLastEvents(nextEvents);
      setHomeLocation(storedHomeLocation);
      setSavedPassphrase(storedPassphrase);
      setActiveEvent(restoredActiveEvent);
      setStatus(restoredActiveEvent ? 'active' : 'idle');
    } catch (loadError: unknown) {
      if (
        activeUserIdRef.current === loadUserId &&
        loadGenerationRef.current === loadGeneration
      ) {
        Alert.alert(
          'Modulo SOS',
          loadError instanceof Error
            ? loadError.message
            : 'Non riesco a caricare i dati salvati.',
        );
      }
    }
  }, [isInitializing, userId]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    resetSensitiveState();
  }, [resetSensitiveState, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadSOSData();

      return () => {
        loadGenerationRef.current += 1;
      };
    }, [loadSOSData]),
  );

  const confirmPassphraseDraft = async () => {
    const normalizedDraft = normalizePassphrase(passphraseDraft);

    if (!normalizedDraft) {
      Alert.alert('Parola d ordine', 'Registra una parola o frase prima di salvarla.');
      return;
    }

    if (!userId) {
      Alert.alert('Parola d’ordine', 'Accedi prima di salvare una parola d’ordine.');
      return;
    }

    try {
      const actionUserId = userId;
      const storedPassphrase = await PassphraseStorage.save(actionUserId, passphraseDraft);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      setSavedPassphrase(storedPassphrase);
      setPassphraseDraft('');
      setLastRecognizedPassphraseText('');
      Alert.alert('Parola d ordine', 'Frase salvata su questo dispositivo.');
    } catch {
      Alert.alert('Parola d ordine', 'Non riesco a salvare la frase sul dispositivo.');
    }
  };

  const cancelSOS = () => {
    setRemainingSeconds(SAFETY_TIMER_SECONDS);
    setStatus('idle');
  };

  const startCheckpoint = (minutes: number) => {
    if (status !== 'idle') {
      Alert.alert('Checkpoint', 'Puoi avviare un checkpoint solo quando non ci sono SOS attivi.');
      return;
    }

    setCheckpointMinutes(minutes);
    setCheckpointRemainingSeconds(minutes * 60);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
    setCheckpointStatus('running');
  };

  const cancelCheckpoint = () => {
    setCheckpointStatus('idle');
    setCheckpointRemainingSeconds(0);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
  };

  const confirmCheckpoint = async () => {
    if (!userId) {
      Alert.alert('Checkpoint', 'Accedi prima di salvare un Checkpoint.');
      cancelCheckpoint();
      return;
    }

    try {
      await CheckpointStorage.saveCompleted(userId, checkpointMinutes);
    } catch {
      Alert.alert('Checkpoint', 'Checkpoint completato, ma non riesco a salvarlo sul dispositivo.');
    }

    cancelCheckpoint();
  };

  const saveCurrentLocationAsHome = async () => {
    if (!userId) {
      Alert.alert('Torno a casa', 'Accedi prima di salvare la posizione Casa.');
      return;
    }

    try {
      const actionUserId = userId;
      const location = await LocationService.getCurrentLocation();
      const savedLocation = await GoHomeStorage.saveHomeLocation(actionUserId, location);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      setHomeLocation(savedLocation);
      Alert.alert('Torno a casa', 'Posizione Casa salvata su questo dispositivo.');
    } catch (error) {
      Alert.alert('Torno a casa', error instanceof Error ? error.message : 'Non riesco a salvare la posizione Casa.');
    }
  };

  const cancelGoHome = () => {
    setGoHomeStatus('idle');
    setGoHomeSession(null);
    setGoHomeRemainingSeconds(0);
    setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
  };

  const startGoHome = async () => {
    if (!userId) {
      Alert.alert('Torno a casa', 'Accedi prima di avviare Torno a casa.');
      return;
    }

    if (status !== 'idle') {
      Alert.alert('Torno a casa', 'Puoi avviare Torno a casa solo quando non ci sono SOS attivi.');
      return;
    }

    if (checkpointStatus !== 'idle') {
      Alert.alert('Torno a casa', 'Concludi o annulla il checkpoint prima di avviare Torno a casa.');
      return;
    }

    setGoHomeStatus('estimating');

    try {
      const actionUserId = userId;
      const savedHomeLocation = await GoHomeStorage.getHomeLocation(actionUserId);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      if (!savedHomeLocation) {
        setGoHomeStatus('idle');
        Alert.alert('Torno a casa', 'Salva prima la posizione Casa.');
        return;
      }

      const startLocation = await LocationService.getCurrentLocation();

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      const distanceKm = calculateDistanceKm(startLocation, savedHomeLocation);
      const estimatedMinutes = estimateWalkingMinutes(distanceKm);
      const session: GoHomeSession = {
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        startLocation,
        homeLocation: savedHomeLocation,
        distanceKm,
        estimatedMinutes,
      };

      Alert.alert(
        'Torno a casa',
        `Distanza stimata: ${distanceKm.toFixed(2)} km\nTempo stimato: ${estimatedMinutes} min\n\nStima indicativa, non considera strade, traffico o deviazioni.`,
        [
          {
            text: 'Annulla',
            style: 'cancel',
            onPress: () => setGoHomeStatus('idle'),
          },
          {
            text: 'Avvia',
            onPress: () => {
              setGoHomeSession(session);
              setGoHomeRemainingSeconds(estimatedMinutes * 60);
              setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
              setGoHomeStatus('running');
            },
          },
        ]
      );
    } catch (error) {
      setGoHomeStatus('idle');
      Alert.alert('Torno a casa', error instanceof Error ? error.message : 'Non riesco ad avviare Torno a casa.');
    }
  };

  const confirmGoHomeArrival = async () => {
    if (!goHomeSession) {
      cancelGoHome();
      return;
    }

    if (!userId) {
      cancelGoHome();
      return;
    }

    try {
      await GoHomeStorage.saveCompleted(userId, goHomeSession);
    } catch {
      Alert.alert('Torno a casa', 'Arrivo confermato, ma non riesco a salvarlo sul dispositivo.');
    }

    cancelGoHome();
  };

  const completeSOS = useCallback(async () => {
    if (sosCompletionInFlightRef.current) {
      return;
    }

    if (!userId) {
      setStatus('idle');
      Alert.alert('SOS', 'Accedi prima di attivare un SOS.');
      return;
    }

    const actionUserId = userId;
    sosCompletionInFlightRef.current = true;
    setStatus('sending');

    try {
      const result = await SOSService.completeSOS(actionUserId);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      setActiveEvent(result.event);
      setLastEvents(result.events);
      setStatus('active');
    } catch (error) {
      if (activeUserIdRef.current === actionUserId) {
        setStatus('idle');
        Alert.alert(
          'SOS non inviato',
          error instanceof Error ? error.message : 'Errore inatteso.',
          [
            { text: 'Annulla', style: 'cancel' },
            {
              text: 'Riprova',
              onPress: () => {
                if (activeUserIdRef.current === actionUserId) {
                  void completeSOS();
                }
              },
            },
          ],
        );
      }
    } finally {
      sosCompletionInFlightRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    const trackedEvent = activeEvent;
    const trackedUserId = userId;

    if (!trackedEvent?.remoteSosId || !trackedUserId || status !== 'active') {
      return;
    }

    let isCurrent = true;
    let requestInFlight = false;

    const refreshRemoteStatus = async () => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;

      try {
        const remoteState = await SOSLifecycleService.getStatus(trackedEvent.remoteSosId!);

        if (!isCurrent || activeUserIdRef.current !== trackedUserId) {
          return;
        }

        if (
          remoteState.sos_status === 'open' ||
          remoteState.sos_status === 'accepted'
        ) {
          setActiveEvent((current) =>
            current?.id === trackedEvent.id
              ? current.remoteStatus === remoteState.sos_status
                ? current
                : { ...current, remoteStatus: remoteState.sos_status }
              : current,
          );
          return;
        }

        const nextEvents = await SOSStorage.finalizeEvent(
          trackedUserId,
          trackedEvent.id,
          remoteState.sos_status,
        );

        if (isCurrent && activeUserIdRef.current === trackedUserId) {
          setLastEvents(nextEvents);
          setActiveEvent(null);
          setRemainingSeconds(SAFETY_TIMER_SECONDS);
          setStatus('idle');
        }
      } catch (refreshError: unknown) {
        console.warn('[SafeMeLink SOS] Aggiornamento stato remoto non riuscito.', refreshError);
      } finally {
        requestInFlight = false;
      }
    };

    void refreshRemoteStatus();
    const refreshInterval = setInterval(() => void refreshRemoteStatus(), 15_000);

    return () => {
      isCurrent = false;
      clearInterval(refreshInterval);
    };
  }, [activeEvent, status, userId]);

  useEffect(() => {
    if (status !== 'countdown') {
      return;
    }

    if (remainingSeconds <= 0) {
      completeSOS();
      return;
    }

    const timeoutId = setTimeout(() => {
      setRemainingSeconds((current) => current - 1);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [completeSOS, remainingSeconds, status]);

  useEffect(() => {
    if (checkpointStatus !== 'running') {
      return;
    }

    if (checkpointRemainingSeconds <= 0) {
      setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
      setCheckpointStatus('confirming');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }

    const timeoutId = setTimeout(() => {
      setCheckpointRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [checkpointRemainingSeconds, checkpointStatus]);

  useEffect(() => {
    if (checkpointStatus !== 'confirming') {
      return;
    }

    if (checkpointConfirmSeconds <= 0) {
      cancelCheckpoint();
      startSOSCountdown();
      return;
    }

    const timeoutId = setTimeout(() => {
      setCheckpointConfirmSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [checkpointConfirmSeconds, checkpointStatus, startSOSCountdown]);

  useEffect(() => {
    if (goHomeStatus !== 'running') {
      return;
    }

    if (goHomeRemainingSeconds <= 0) {
      setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
      setGoHomeStatus('confirming');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }

    const timeoutId = setTimeout(() => {
      setGoHomeRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [goHomeRemainingSeconds, goHomeStatus]);

  useEffect(() => {
    if (goHomeStatus !== 'confirming') {
      return;
    }

    if (goHomeConfirmSeconds <= 0) {
      cancelGoHome();
      startSOSCountdown();
      return;
    }

    const timeoutId = setTimeout(() => {
      setGoHomeConfirmSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [goHomeConfirmSeconds, goHomeStatus, startSOSCountdown]);

  const finishSOS = async (terminalStatus: SOSTerminalStatus) => {
    if (isEndingSOS || !activeEvent) {
      return;
    }

    const eventToFinish = activeEvent;
    const actionUserId = userId;

    if (!actionUserId) {
      Alert.alert('SOS', 'Sessione non disponibile. Accedi e riprova.');
      return;
    }

    setIsEndingSOS(true);

    try {
      if (eventToFinish.remoteSosId) {
        const remoteState =
          terminalStatus === 'closed'
            ? await SOSLifecycleService.close(eventToFinish.remoteSosId)
            : await SOSLifecycleService.cancel(eventToFinish.remoteSosId);

        if (remoteState.sos_status !== terminalStatus) {
          throw new Error('Il backend non ha confermato la conclusione dell’SOS.');
        }
      }

      let nextEvents: SOSEvent[];

      try {
        nextEvents = await SOSStorage.finalizeEvent(
          actionUserId,
          eventToFinish.id,
          terminalStatus,
        );
      } catch (storageError: unknown) {
        console.warn('[SafeMeLink SOS] Cronologia locale non aggiornata.', storageError);
        nextEvents = lastEvents.map((event) =>
          event.id === eventToFinish.id
            ? {
                ...event,
                contactIds: [],
                location: null,
                message: null,
                remoteStatus: terminalStatus,
              }
            : event,
        );
      }

      if (
        activeUserIdRef.current !== actionUserId ||
        activeEvent?.id !== eventToFinish.id
      ) {
        return;
      }

      setLastEvents(nextEvents);
      setActiveEvent(null);
      setRemainingSeconds(SAFETY_TIMER_SECONDS);
      setStatus('idle');
    } catch (finishError: unknown) {
      if (activeUserIdRef.current === actionUserId) {
        Alert.alert(
          'SOS ancora attivo',
          finishError instanceof Error
            ? finishError.message
            : 'Il backend non ha confermato la conclusione dell’SOS.',
        );
      }
    } finally {
      if (activeUserIdRef.current === actionUserId) {
        setIsEndingSOS(false);
      }
    }
  };

  const deactivateSOS = () => {
    if (isEndingSOS) {
      return;
    }

    Alert.alert('Disattiva SOS', 'Come vuoi concludere questo SOS?', [
      { text: 'Indietro', style: 'cancel' },
      {
        text: 'Annulla SOS',
        style: 'destructive',
        onPress: () => void finishSOS('cancelled'),
      },
      {
        text: 'Emergenza conclusa',
        onPress: () => void finishSOS('closed'),
      },
    ]);
  };

  const shareActiveSOS = async () => {
    if (!activeEvent) {
      return;
    }

    try {
      await SOSService.shareSOS(activeEvent, contacts);
    } catch {
      Alert.alert('Condivisione SOS', 'Non riesco ad aprire la condivisione del messaggio.');
    }
  };

  const openPanel = (panel: HomePanel) => {
    setActivePanel(panel);
    setDrawerVisible(false);
  };

  const activeSafetyMode =
    status !== 'idle'
      ? 'SOS attivo'
      : checkpointStatus !== 'idle'
        ? 'Checkpoint attivo'
        : goHomeStatus !== 'idle'
          ? 'Torno a casa attivo'
          : passphraseMode === 'listening'
            ? "Parola d'ordine in ascolto"
            : 'Nessuna modalita attiva';
  const nebulaAnimatedStyle = {
    opacity: nebulaPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.18, 0.32],
    }),
    transform: [
      {
        scale: nebulaPulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.04],
        }),
      },
    ],
  };
  const logoGlowAnimatedStyle = {
    opacity: logoGlowPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.18, 0.34],
    }),
  };
  const sosGlowAnimatedStyle = {
    opacity: sosGlowPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.42, 0.68],
    }),
    transform: [
      {
        scale: sosGlowPulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.035],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.starField}>
        <View style={[styles.star, styles.starOne]} />
        <View style={[styles.star, styles.starTwo]} />
        <View style={[styles.star, styles.starThree]} />
        <View style={[styles.star, styles.starFour]} />
        <View style={[styles.networkPoint, styles.networkPointOne]} />
        <View style={[styles.networkPoint, styles.networkPointTwo]} />
        <View style={[styles.networkPoint, styles.networkPointThree]} />
        <View style={[styles.networkPoint, styles.networkPointFour]} />
        <View style={[styles.networkLine, styles.networkLineOne]} />
        <View style={[styles.networkLine, styles.networkLineTwo]} />
        <View style={[styles.networkLine, styles.networkLineThree]} />
        <Animated.View style={[styles.nebula, styles.nebulaOne, nebulaAnimatedStyle]} />
        <Animated.View style={[styles.nebula, styles.nebulaTwo, nebulaAnimatedStyle]} />
      </View>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => setDrawerVisible(true)}>
          <Text style={styles.iconButtonText}>☰</Text>
        </Pressable>
        <View style={styles.topTitleWrap}>
          <Text style={styles.appName}>SafeMeLink</Text>
          <Text style={styles.subtitle}>
            {activePanel === 'home'
              ? 'Una rete silenziosa, pronta ad aiutarti.'
              : activePanel === 'checkpoint'
                ? 'Checkpoint'
                : activePanel === 'goHome'
                  ? 'Torno a casa'
                  : "Parola d'ordine"}
          </Text>
        </View>
        <View style={styles.iconButtonGhost} />
      </View>

      {activePanel === 'home' && (
        <View style={styles.homePanel}>
          <View style={styles.logoStage}>
            <Animated.View style={[styles.logoGlow, logoGlowAnimatedStyle]} />
            <Image source={logoImage} style={styles.logo} resizeMode="contain" />
          </View>

          <View style={styles.contactsSummary}>
            <View>
              <Text style={styles.summaryLabel}>Contatti fidati</Text>
              <Text style={styles.summaryValue}>{contacts.length}/3 salvati</Text>
            </View>
            <Link href={"/(tabs)/contacts" as any} asChild>
              <Pressable style={styles.manageContactsButton}>
                <Text style={styles.manageContactsText}>Gestisci</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      )}

      {status === 'countdown' && (
        <View style={styles.countdownPanel}>
          <Text style={styles.countdownLabel}>SOS tra</Text>
          <Text style={styles.countdownValue}>{remainingSeconds}</Text>
          <Text style={styles.countdownText}>Annulla se non vuoi inviare il messaggio.</Text>
          <Pressable style={styles.sendNowButton} onPress={() => void completeSOS()}>
            <Text style={styles.sendNowButtonText}>Invia subito</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={cancelSOS}>
            <Text style={styles.cancelButtonText}>Annulla SOS</Text>
          </Pressable>
        </View>
      )}

      {status === 'sending' && (
        <View style={styles.statusPanel}>
          <Text style={styles.statusTitle}>Invio SOS</Text>
          <Text style={styles.statusText}>Recupero posizione GPS e preparo il messaggio.</Text>
        </View>
      )}

      {status === 'active' && activeEvent && (
        <View style={styles.emergencyPanel}>
          <Text style={styles.emergencyLabel}>
            {activeEvent.remoteStatus === 'accepted' ? 'SOS PRESO IN CARICO' : 'SOS ATTIVO'}
          </Text>
          <Text style={styles.emergencyText}>Messaggio preparato e evento salvato.</Text>
          <Text style={styles.coordinates}>
            {activeEvent.location.latitude}, {activeEvent.location.longitude}
          </Text>
          <Pressable style={styles.shareButton} onPress={shareActiveSOS}>
            <Text style={styles.shareButtonText}>Condividi di nuovo SOS</Text>
          </Pressable>
          <Pressable
            disabled={isEndingSOS}
            style={[styles.stopButton, isEndingSOS && styles.disabledButton]}
            onPress={deactivateSOS}>
            <Text style={styles.stopButtonText}>
              {isEndingSOS ? 'Aggiornamento SOS…' : 'Disattiva SOS'}
            </Text>
          </Pressable>
        </View>
      )}

      {status === 'idle' && activePanel === 'home' && (
        <View style={styles.sosPanel}>
          <View style={styles.sosStage}>
            <Animated.View style={[styles.sosGlow, sosGlowAnimatedStyle]} />
            <Pressable style={({ pressed }) => [styles.sosButton, pressed && styles.sosButtonPressed]} onPress={startSOSCountdown}>
              <Text style={styles.sosButtonText}>SOS</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>
            In caso di emergenza SafeMeLink può condividere la tua posizione con la tua rete di aiuto.
          </Text>
          <View style={styles.statusDock}>
            <View style={styles.statusItem}>
              <View style={styles.readyDot} />
              <Text style={styles.statusDockText}>Sistema operativo</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusIcon}>⌖</Text>
              <Text style={styles.statusDockMuted}>Posizione richiesta al bisogno</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusIcon}>◇</Text>
              <Text style={styles.statusDockMuted}>Rete SafeMeLink pronta</Text>
            </View>
            <Text style={styles.statusModeText}>{activeSafetyMode}</Text>
          </View>
        </View>
      )}

      {activePanel === 'checkpoint' && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Checkpoint</Text>
        <Text style={styles.sectionDescription}>Controllo generico dopo un tempo.</Text>
        {checkpointStatus === 'running' ? (
          <View>
            <Text style={styles.checkpointTimer}>{formatTimer(checkpointRemainingSeconds)}</Text>
            <Pressable style={styles.secondaryActionButton} onPress={cancelCheckpoint}>
              <Text style={styles.secondaryActionText}>Annulla checkpoint</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.checkpointOptions}>
            {CHECKPOINT_OPTIONS_MINUTES.map((minutes) => (
              <Pressable
                key={minutes}
                style={styles.checkpointButton}
                onPress={() => startCheckpoint(minutes)}>
                <Text style={styles.checkpointButtonText}>{minutes} min</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      )}

      {activePanel === 'goHome' && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Torno a casa</Text>
        <Text style={styles.sectionDescription}>Sessione legata al tragitto verso la posizione Casa.</Text>
        {homeLocation ? (
          <Text style={styles.goHomeHomeText}>Casa salvata il {new Date(homeLocation.savedAt).toLocaleString()}</Text>
        ) : (
          <Text style={styles.emptyText}>Nessuna posizione Casa salvata.</Text>
        )}

        {goHomeStatus === 'running' && goHomeSession ? (
          <View style={styles.goHomeActive}>
            <Text style={styles.goHomeTimer}>{formatTimer(goHomeRemainingSeconds)}</Text>
            <Text style={styles.goHomeEstimate}>
              {goHomeSession.distanceKm.toFixed(2)} km stimati, {goHomeSession.estimatedMinutes} min
            </Text>
            <Text style={styles.goHomeNote}>Stima indicativa, non considera strade, traffico o deviazioni.</Text>
            <Pressable style={styles.secondaryActionButton} onPress={cancelGoHome}>
              <Text style={styles.secondaryActionText}>Annulla Torno a casa</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.goHomeActions}>
            <Pressable style={styles.secondaryActionButton} onPress={saveCurrentLocationAsHome}>
              <Text style={styles.secondaryActionText}>Salva questa posizione come Casa</Text>
            </Pressable>
            <Pressable
              disabled={goHomeStatus === 'estimating'}
              style={[styles.goHomeStartButton, goHomeStatus === 'estimating' && styles.disabledButton]}
              onPress={startGoHome}>
              <Text style={styles.goHomeStartText}>{goHomeStatus === 'estimating' ? 'Calcolo...' : 'Avvia Torno a casa'}</Text>
            </Pressable>
          </View>
        )}
      </View>
      )}

      {activePanel === 'passphrase' && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Parola d’ordine</Text>
        <Text style={styles.passphraseStatus}>
          {passphraseIsConfigured ? 'Frase configurata' : 'Nessuna parola salvata'}
        </Text>
        {savedPassphrase && (
          <Text style={styles.passphraseSavedText}>
            {`Salvata: “${savedPassphrase.text}”`}
          </Text>
        )}
        <Text style={styles.goHomeNote}>Il microfono viene usato solo mentre la modalita ascolto e attiva.</Text>

        {lastRecognizedPassphraseText ? (
          <Text style={styles.passphraseTranscript}>
            {`Riconosciuto: “${lastRecognizedPassphraseText}”`}
          </Text>
        ) : null}
        {passphraseDraft ? (
          <Text style={styles.passphraseTranscript}>{`Da salvare: “${passphraseDraft}”`}</Text>
        ) : null}
        {passphraseError ? <Text style={styles.passphraseError}>{passphraseError}</Text> : null}

        <View style={styles.passphraseActions}>
          <Pressable
            disabled={passphraseMode === 'listening'}
            style={[styles.secondaryActionButton, passphraseMode === 'listening' && styles.disabledButton]}
            onPress={() => startPassphraseRecognition('recording')}>
            <Text style={styles.secondaryActionText}>
              {passphraseMode === 'recording' ? 'Sto ascoltando...' : 'Registra parola d’ordine'}
            </Text>
          </Pressable>

          {passphraseDraft ? (
            <Pressable style={styles.goHomeStartButton} onPress={confirmPassphraseDraft}>
              <Text style={styles.goHomeStartText}>Conferma frase</Text>
            </Pressable>
          ) : null}

          {passphraseMode === 'listening' ? (
            <Pressable style={styles.cancelButton} onPress={stopPassphraseRecognition}>
              <Text style={styles.cancelButtonText}>Disattiva ascolto</Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={!passphraseIsConfigured || passphraseMode === 'recording'}
              style={[
                styles.goHomeStartButton,
                (!passphraseIsConfigured || passphraseMode === 'recording') && styles.disabledButton,
              ]}
              onPress={() => startPassphraseRecognition('listening')}>
              <Text style={styles.goHomeStartText}>Attiva ascolto</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.passphraseListenState}>
          {passphraseMode === 'listening' ? 'Ascolto attivo' : 'Ascolto disattivato'}
        </Text>
      </View>
      )}

      {activePanel === 'home' && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ultimo evento</Text>
        {!latestEvent ? (
          <Text style={styles.emptyText}>Nessun evento SOS salvato.</Text>
        ) : (
          <View style={styles.eventRow}>
            <Text style={styles.eventDate}>{new Date(latestEvent.createdAt).toLocaleString()}</Text>
            {latestEvent.location ? (
              <Text style={styles.eventCoords}>
                {latestEvent.location.latitude}, {latestEvent.location.longitude}
              </Text>
            ) : (
              <Text style={styles.eventCoords}>
                {latestEvent.remoteStatus === 'cancelled' ? 'SOS annullato' : 'SOS concluso'}
              </Text>
            )}
          </View>
        )}
      </View>
      )}

      <Modal visible={drawerVisible} transparent animationType="fade" onRequestClose={() => setDrawerVisible(false)}>
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerScrim} onPress={() => setDrawerVisible(false)} />
          <SafeAreaView style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>SafeMeLink</Text>
              <Pressable style={styles.drawerClose} onPress={() => setDrawerVisible(false)}>
                <Text style={styles.drawerCloseText}>x</Text>
              </Pressable>
            </View>

            <Text style={styles.drawerSectionLabel}>EMERGENZA</Text>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('home')}>
              <Text style={styles.drawerItemText}>SOS</Text>
            </Pressable>
            <Link href={"/(tabs)/contacts" as any} asChild>
              <Pressable style={styles.drawerItem} onPress={() => setDrawerVisible(false)}>
                <Text style={styles.drawerItemText}>Contatti fidati</Text>
              </Pressable>
            </Link>
            <Link href={'/emergency-profile' as unknown as Href} asChild>
              <Pressable style={styles.drawerItem} onPress={() => setDrawerVisible(false)}>
                <Text style={styles.drawerItemText}>Profilo di Emergenza</Text>
              </Pressable>
            </Link>

            <Text style={styles.drawerSectionLabel}>SICUREZZA PREVENTIVA</Text>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('checkpoint')}>
              <Text style={styles.drawerItemText}>Checkpoint</Text>
            </Pressable>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('goHome')}>
              <Text style={styles.drawerItemText}>Torno a casa</Text>
            </Pressable>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('passphrase')}>
              <Text style={styles.drawerItemText}>Parola d’ordine</Text>
            </Pressable>

            <Text style={styles.drawerSectionLabel}>COMMUNITY</Text>
            <Link href={'/radar' as unknown as Href} asChild>
              <Pressable style={styles.drawerItem} onPress={() => setDrawerVisible(false)}>
                <Text style={styles.drawerItemText}>Radar</Text>
              </Pressable>
            </Link>
            <View style={styles.drawerItemDisabled}>
              <Text style={styles.drawerItemDisabledText}>Guardian</Text>
              <Text style={styles.drawerBadge}>In arrivo</Text>
            </View>
            <View style={styles.drawerItemDisabled}>
              <Text style={styles.drawerItemDisabledText}>Punti Safe</Text>
              <Text style={styles.drawerBadge}>In arrivo</Text>
            </View>

            <Text style={styles.drawerSectionLabel}>IMPOSTAZIONI</Text>
            <View style={styles.drawerItemDisabled}>
              <Text style={styles.drawerItemDisabledText}>Impostazioni</Text>
              <Text style={styles.drawerBadge}>In arrivo</Text>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={checkpointStatus === 'confirming'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.checkpointModal}>
            <Text style={styles.modalTitle}>Stai bene?</Text>
            <Text style={styles.modalCountdown}>{checkpointConfirmSeconds}</Text>
            <Pressable style={styles.safeButton} onPress={confirmCheckpoint}>
              <Text style={styles.safeButtonText}>Sto bene</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={goHomeStatus === 'confirming'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.checkpointModal}>
            <Text style={styles.modalTitle}>Sei arrivato/a?</Text>
            <Text style={styles.modalCountdown}>{goHomeConfirmSeconds}</Text>
            <Pressable style={styles.safeButton} onPress={confirmGoHomeArrival}>
              <Text style={styles.safeButtonText}>Sì, sono arrivato/a</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#050816',
    flex: 1,
  },
  starField: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050816',
    overflow: 'hidden',
  },
  star: {
    backgroundColor: '#dce9ff',
    borderRadius: 4,
    opacity: 0.78,
    position: 'absolute',
  },
  starOne: {
    height: 4,
    left: '14%',
    top: '12%',
    width: 4,
  },
  starTwo: {
    height: 3,
    right: '18%',
    top: '21%',
    width: 3,
  },
  starThree: {
    bottom: '26%',
    height: 5,
    left: '22%',
    width: 5,
  },
  starFour: {
    bottom: '14%',
    height: 3,
    right: '12%',
    width: 3,
  },
  networkPoint: {
    backgroundColor: '#55c7ff',
    borderRadius: 4,
    height: 6,
    opacity: 0.5,
    position: 'absolute',
    width: 6,
  },
  networkPointOne: {
    left: '18%',
    top: '32%',
  },
  networkPointTwo: {
    right: '20%',
    top: '36%',
  },
  networkPointThree: {
    bottom: '30%',
    left: '28%',
  },
  networkPointFour: {
    bottom: '22%',
    right: '18%',
  },
  networkLine: {
    backgroundColor: 'rgba(88, 166, 255, 0.22)',
    height: 1,
    position: 'absolute',
  },
  networkLineOne: {
    left: '20%',
    top: '34%',
    transform: [{ rotate: '8deg' }],
    width: '58%',
  },
  networkLineTwo: {
    bottom: '28%',
    left: '28%',
    transform: [{ rotate: '-12deg' }],
    width: '48%',
  },
  networkLineThree: {
    left: '18%',
    top: '48%',
    transform: [{ rotate: '58deg' }],
    width: '38%',
  },
  nebula: {
    borderRadius: 240,
    position: 'absolute',
  },
  nebulaOne: {
    backgroundColor: '#1455ff',
    height: 320,
    right: -118,
    top: 42,
    width: 320,
  },
  nebulaTwo: {
    backgroundColor: '#8b3dff',
    bottom: 36,
    height: 280,
    left: -128,
    width: 280,
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 36,
    paddingTop: 18,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  topTitleWrap: {
    alignItems: 'center',
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 14,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonText: {
    color: '#eef6ff',
    fontSize: 24,
    fontWeight: '800',
  },
  iconButtonGhost: {
    height: 44,
    width: 44,
  },
  appName: {
    color: '#f7fbff',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9fb5d9',
    fontSize: 14,
    marginTop: 4,
  },
  homePanel: {
    alignItems: 'center',
  },
  logoStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    width: '100%',
  },
  logoGlow: {
    backgroundColor: '#1d8bff',
    borderRadius: 140,
    height: 170,
    position: 'absolute',
    width: 260,
  },
  logo: {
    alignSelf: 'center',
    height: 210,
    maxWidth: 380,
    width: '100%',
  },
  contactsSummary: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 22,
    padding: 16,
    width: '100%',
  },
  summaryLabel: {
    color: '#9fb5d9',
    fontSize: 13,
  },
  summaryValue: {
    color: '#f7fbff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  manageContactsButton: {
    backgroundColor: 'rgba(88, 166, 255, 0.16)',
    borderColor: 'rgba(88, 166, 255, 0.28)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  manageContactsText: {
    color: '#a9d7ff',
    fontWeight: '800',
  },
  sosPanel: {
    alignItems: 'center',
    marginBottom: 28,
  },
  sosStage: {
    alignItems: 'center',
    height: 226,
    justifyContent: 'center',
    width: 226,
  },
  sosGlow: {
    backgroundColor: '#ff2d55',
    borderColor: 'rgba(103, 69, 255, 0.55)',
    borderRadius: 113,
    borderWidth: 2,
    height: 226,
    position: 'absolute',
    shadowColor: '#ff2d55',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.58,
    shadowRadius: 30,
    width: 226,
  },
  sosButton: {
    alignItems: 'center',
    backgroundColor: '#e11d2e',
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 94,
    borderWidth: 2,
    elevation: 8,
    height: 188,
    justifyContent: 'center',
    shadowColor: '#ff354d',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.62,
    shadowRadius: 24,
    width: 188,
  },
  sosButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  sosButtonText: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
  },
  helperText: {
    color: '#b8c9e8',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 18,
    textAlign: 'center',
  },
  statusDock: {
    backgroundColor: 'rgba(7, 16, 39, 0.66)',
    borderColor: 'rgba(129, 190, 255, 0.2)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 9,
    marginTop: 22,
    padding: 16,
    shadowColor: '#1d8bff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    width: '100%',
  },
  statusDotRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statusItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  readyDot: {
    backgroundColor: '#34d399',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  statusIcon: {
    color: '#73c7ff',
    fontSize: 16,
    fontWeight: '900',
    width: 16,
  },
  statusDockText: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '800',
  },
  statusDockMuted: {
    color: '#9fb5d9',
    fontSize: 13,
  },
  statusModeText: {
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    borderTopWidth: 1,
    color: '#c9d8f5',
    fontSize: 13,
    paddingTop: 10,
  },
  countdownPanel: {
    backgroundColor: 'rgba(255, 243, 224, 0.94)',
    borderRadius: 18,
    marginBottom: 28,
    padding: 20,
  },
  countdownLabel: {
    color: '#7a3d00',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  countdownValue: {
    color: '#c62828',
    fontSize: 64,
    fontWeight: '900',
    textAlign: 'center',
  },
  countdownText: {
    color: '#7a3d00',
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: '#7a3d00',
    borderRadius: 6,
    marginTop: 10,
    padding: 14,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  sendNowButton: {
    backgroundColor: '#b71c1c',
    borderRadius: 6,
    padding: 14,
  },
  sendNowButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusPanel: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 28,
    padding: 20,
  },
  statusTitle: {
    color: '#f7fbff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusText: {
    color: '#b8c9e8',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
  },
  emergencyPanel: {
    backgroundColor: '#b71c1c',
    borderRadius: 18,
    marginBottom: 28,
    padding: 20,
  },
  emergencyLabel: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  emergencyText: {
    color: '#fff',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  coordinates: {
    color: '#ffe9e9',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  shareButton: {
    backgroundColor: '#fff',
    borderRadius: 6,
    marginTop: 18,
    padding: 14,
  },
  shareButtonText: {
    color: '#b71c1c',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  stopButton: {
    borderColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
    padding: 16,
  },
  sectionTitle: {
    color: '#f7fbff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  sectionDescription: {
    color: '#9fb5d9',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  emptyText: {
    color: '#9fb5d9',
    fontSize: 14,
  },
  eventRow: {
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  eventDate: {
    color: '#f7fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  eventCoords: {
    color: '#9fb5d9',
    fontSize: 13,
    marginTop: 2,
  },
  checkpointOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  checkpointButton: {
    backgroundColor: 'rgba(88, 166, 255, 0.16)',
    borderColor: 'rgba(88, 166, 255, 0.28)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  checkpointButtonText: {
    color: '#a9d7ff',
    fontWeight: '800',
  },
  checkpointTimer: {
    color: '#f7fbff',
    fontSize: 34,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
  },
  goHomeHomeText: {
    color: '#b8c9e8',
    fontSize: 14,
    marginBottom: 12,
  },
  goHomeActions: {
    gap: 10,
  },
  goHomeActive: {
    gap: 10,
  },
  goHomeTimer: {
    color: '#f7fbff',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  goHomeEstimate: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  goHomeNote: {
    color: '#9fb5d9',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  passphraseStatus: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  passphraseSavedText: {
    color: '#b8c9e8',
    fontSize: 14,
    marginBottom: 8,
  },
  passphraseTranscript: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#f7fbff',
    fontSize: 14,
    marginTop: 10,
    padding: 10,
  },
  passphraseError: {
    color: '#b71c1c',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  passphraseActions: {
    gap: 10,
    marginTop: 12,
  },
  passphraseListenState: {
    color: '#9fb5d9',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  goHomeStartButton: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    padding: 14,
  },
  goHomeStartText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  secondaryActionButton: {
    borderColor: 'rgba(168, 218, 255, 0.45)',
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  secondaryActionText: {
    color: '#bfe3ff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
    flex: 1,
  },
  drawer: {
    backgroundColor: '#091123',
    borderRightColor: 'rgba(255, 255, 255, 0.12)',
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    padding: 18,
    position: 'absolute',
    top: 0,
    width: 306,
  },
  drawerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  drawerTitle: {
    color: '#f7fbff',
    fontSize: 24,
    fontWeight: '900',
  },
  drawerClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  drawerCloseText: {
    color: '#dce9ff',
    fontSize: 18,
    fontWeight: '900',
  },
  drawerSectionLabel: {
    color: '#7d8fb2',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 8,
    marginTop: 16,
  },
  drawerItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  drawerItemText: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '800',
  },
  drawerItemDisabled: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  drawerItemDisabledText: {
    color: '#8ea1c5',
    fontSize: 15,
    fontWeight: '700',
  },
  drawerBadge: {
    color: '#b9c7e6',
    fontSize: 12,
    fontWeight: '800',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 28, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  checkpointModal: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 24,
    width: '100%',
  },
  modalTitle: {
    color: '#11181c',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalCountdown: {
    color: '#c62828',
    fontSize: 64,
    fontWeight: '900',
    marginVertical: 12,
    textAlign: 'center',
  },
  safeButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 6,
    padding: 14,
  },
  safeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});
