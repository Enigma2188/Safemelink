import { type Href, Link, useFocusEffect, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, BackHandler, Easing, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import type { SOSDeliveryResult } from '@/backend/functions/SOSPushService';
import { SafeNetworkBackground } from '@/components/SafeNetworkBackground';
import { useSOSNetworkPresence } from '@/components/SOSNetworkPresenceProvider';
import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import type { SOSLocalDeliveryResult } from '@/services/SOSAlertService';
import type { SOSAutomaticSmsResult } from '@/services/SOSAutomaticSmsService';
import {
  INTERACTIVE_LOCATION_TIMEOUT_MS,
  LocationPermissionError,
  LocationUnavailableError,
  LocationService,
} from '@/services/LocationService';
import {
  getSOSLifecycleDiagnosticError,
  SOSLifecycleDiagnosticError,
  SOSLifecycleService,
} from '@/services/SOSLifecycleService';
import {
  VoiceProtectionRuntime,
  VOICE_SOS_COUNTDOWN_MS,
} from '@/services/VoiceProtectionRuntime';
import {
  SOSService,
  type ActiveSOSEvent,
  type SOSCompletionResult,
  type SOSEvent,
  type SOSTerminalStatus,
} from '@/services/SOSService';
import { CheckpointStorage } from '@/storage/CheckpointStorage';
import {
  GoHomeStorage,
  type ActiveGoHomeSession,
  type GoHomeSession,
  type GoHomeTransportMode,
  type HomeLocation,
} from '@/storage/GoHomeStorage';
import { SOSStorage } from '@/storage/SOSStorage';

const SAFETY_TIMER_SECONDS = VOICE_SOS_COUNTDOWN_MS / 1_000;
const CHECKPOINT_CONFIRM_SECONDS = 30;
const CHECKPOINT_MAX_HOURS = 12;
const CHECKPOINT_MAX_DURATION_MINUTES = CHECKPOINT_MAX_HOURS * 60 + 59;
const CHECKPOINT_QUICK_DURATIONS = [15, 30, 60] as const;
const GO_HOME_CONFIRM_SECONDS = 30;
const GO_HOME_SAFETY_MARGIN = 1.3;
const GO_HOME_SPEED_KM_H: Record<GoHomeTransportMode, number> = {
  walking: 5,
  cycling: 15,
  driving: 35,
};
const GO_HOME_TRANSPORT_OPTIONS: readonly {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  mode: GoHomeTransportMode;
}[] = [
  { icon: 'walk-outline', label: 'A piedi', mode: 'walking' },
  { icon: 'bicycle-outline', label: 'In bici', mode: 'cycling' },
  { icon: 'car-outline', label: 'In auto', mode: 'driving' },
];
const GO_HOME_STORAGE_TIMEOUT_MS = 8_000;
const GO_HOME_GPS_TIMEOUT_MS = INTERACTIVE_LOCATION_TIMEOUT_MS + 5_000;
const SOS_LOCAL_FINALIZE_TIMEOUT_MS = 8_000;

const getSOSDeliveryNotice = (
  result: SOSDeliveryResult,
  localResult: SOSLocalDeliveryResult,
  automaticSmsResult: SOSAutomaticSmsResult,
) => {
  const automaticSmsNotice = automaticSmsResult.status === 'sent'
    ? `SMS automatici inviati ai contatti fidati: ${automaticSmsResult.sentCount}.`
    : null;
  if (result.notificationsSent > 0) {
    return [
      'SOS attivo. La notifica SafeMeLink è stata accettata per l’invio.',
      automaticSmsNotice,
    ].filter(Boolean).join(' ');
  }

  const fallbackNotice = automaticSmsNotice ?? (
    localResult.status === 'sms_opened'
      ? 'Fallback SMS avviato.'
      : automaticSmsResult.status === 'consent_required'
        ? 'Gli SMS automatici non sono autorizzati; puoi inviarli manualmente dalla schermata SOS.'
        : automaticSmsResult.status === 'permission_required'
          ? 'Il permesso SMS non è disponibile; puoi inviarli manualmente dalla schermata SOS.'
          : automaticSmsResult.status === 'unavailable'
            ? 'Nessun numero fidato valido è disponibile per l’invio automatico.'
            : localResult.status === 'no_channel'
              ? 'Nessun canale SMS utilizzabile. Verifica i contatti fidati e le app disponibili.'
              : 'L’invio SMS non è disponibile per un problema tecnico.'
  );

  if (
    result.reason === 'no_eligible_recipients' ||
    result.reason === 'no_linked_recipients'
  ) {
    return `SOS attivo. Nessun contatto fidato o utente vicino della rete SafeMeLink risulta disponibile. ${fallbackNotice}`;
  }

  if (result.reason === 'recipients_without_active_tokens') {
    return `SOS attivo. I destinatari SafeMeLink individuati non hanno notifiche disponibili. ${fallbackNotice}`;
  }

  if (result.reason === 'rate_limited') {
    return `SOS attivo. L’invio SafeMeLink è temporaneamente limitato per sicurezza. ${fallbackNotice}`;
  }

  if (result.reason === 'already_dispatched') {
    return `SOS attivo. Questo evento era già stato inoltrato alla rete SafeMeLink. ${fallbackNotice}`;
  }

  if (result.reason === 'in_progress' || result.reason === 'attempt_in_progress') {
    return `SOS attivo. L’invio alla rete SafeMeLink è già in elaborazione. ${fallbackNotice}`;
  }

  if (result.reason === 'remote_creation_timeout' || result.reason === 'remote_creation_error') {
    return `SOS attivo, ma il servizio SafeMeLink non ha salvato l’evento remoto. ${fallbackNotice}`;
  }

  if (result.reason === 'edge_function_unauthorized') {
    return `SOS attivo, ma la sessione non ha autorizzato l’invio SafeMeLink. ${fallbackNotice}`;
  }

  if (
    result.reason === 'edge_function_timeout' ||
    result.reason === 'edge_function_unavailable'
  ) {
    return `SOS attivo, ma il servizio notifiche SafeMeLink non è temporaneamente raggiungibile. ${fallbackNotice}`;
  }

  if (result.errors.length > 0 || result.notificationsFailed > 0) {
    return `SOS attivo, ma l’invio SafeMeLink ha incontrato un problema tecnico. ${fallbackNotice}`;
  }

  return `SOS attivo, ma Expo non ha accettato notifiche SafeMeLink. ${fallbackNotice}`;
};

type SOSStatus = 'idle' | 'countdown' | 'sending' | 'active';
type CheckpointStatus = 'idle' | 'running' | 'confirming';
type GoHomeStatus = 'idle' | 'estimating' | 'running' | 'confirming';
type GoHomeErrorAction = 'retry' | 'location-settings' | null;
type HomePanel = 'home' | 'checkpoint' | 'goHome';

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

const getGoHomeTransportLabel = (mode: GoHomeTransportMode) =>
  GO_HOME_TRANSPORT_OPTIONS.find((option) => option.mode === mode)?.label ?? 'A piedi';

const estimateGoHomeMinutes = (distanceKm: number, mode: GoHomeTransportMode) =>
  Math.max(
    1,
    Math.round((distanceKm / GO_HOME_SPEED_KM_H[mode]) * 60 * GO_HOME_SAFETY_MARGIN),
  );

const runGoHomeStepWithTimeout = async <T,>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getCheckpointDurationMinutes = (hours: number, minutes: number) => {
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > CHECKPOINT_MAX_HOURS ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const durationMinutes = hours * 60 + minutes;
  return durationMinutes >= 1 && durationMinutes <= CHECKPOINT_MAX_DURATION_MINUTES
    ? durationMinutes
    : null;
};

const formatCheckpointDuration = (hours: number, minutes: number) => {
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'ora' : 'ore'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`);
  }
  return parts.length > 0 ? `Checkpoint tra ${parts.join(' e ')}` : 'Seleziona una durata';
};

const runSOSLocalStepWithTimeout = async <T,>(operation: Promise<T>) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('La cronologia locale non risponde.')),
          SOS_LOCAL_FINALIZE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export default function HomeScreen() {
  const { session, isInitializing, isOffline, isSubmitting, logout } = useAuth();
  const sosNetwork = useSOSNetworkPresence();
  const router = useRouter();
  const isHomeFocused = useIsFocused();
  const userId = session?.user.id ?? null;
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [lastEvents, setLastEvents] = useState<SOSEvent[]>([]);
  const [activeEvent, setActiveEvent] = useState<ActiveSOSEvent | null>(null);
  const [pushDeliveryNotice, setPushDeliveryNotice] = useState<string | null>(null);
  const [isEndingSOS, setIsEndingSOS] = useState(false);
  const [status, setStatus] = useState<SOSStatus>('idle');
  const [remainingSeconds, setRemainingSeconds] = useState(SAFETY_TIMER_SECONDS);
  const [checkpointStatus, setCheckpointStatus] = useState<CheckpointStatus>('idle');
  const [checkpointMinutes, setCheckpointMinutes] = useState<number>(
    CHECKPOINT_QUICK_DURATIONS[0],
  );
  const [checkpointHoursDraft, setCheckpointHoursDraft] = useState(0);
  const [checkpointMinutesDraft, setCheckpointMinutesDraft] = useState(15);
  const [checkpointRemainingSeconds, setCheckpointRemainingSeconds] = useState(0);
  const [checkpointConfirmSeconds, setCheckpointConfirmSeconds] = useState(CHECKPOINT_CONFIRM_SECONDS);
  const [checkpointExpiresAt, setCheckpointExpiresAt] = useState<string | null>(null);
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);
  const [goHomeTransportMode, setGoHomeTransportMode] =
    useState<GoHomeTransportMode>('walking');
  const [goHomeStatus, setGoHomeStatus] = useState<GoHomeStatus>('idle');
  const [goHomeSession, setGoHomeSession] = useState<
    ActiveGoHomeSession | GoHomeSession | null
  >(null);
  const [goHomeExpiresAt, setGoHomeExpiresAt] = useState<string | null>(null);
  const [goHomeRemainingSeconds, setGoHomeRemainingSeconds] = useState(0);
  const [goHomeConfirmSeconds, setGoHomeConfirmSeconds] = useState(GO_HOME_CONFIRM_SECONDS);
  const [goHomeError, setGoHomeError] = useState('');
  const [goHomeErrorAction, setGoHomeErrorAction] = useState<GoHomeErrorAction>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<HomePanel>('home');
  const goHomeEstimateGenerationRef = useRef(0);
  const goHomeEstimateInFlightRef = useRef(false);
  const goHomeOperationGenerationRef = useRef(0);
  const goHomeExpirationHandledRef = useRef<string | null>(null);
  const goHomeOwnerUserIdRef = useRef<string | null>(userId);
  const goHomeStatusRef = useRef<GoHomeStatus>('idle');
  const goHomeStorageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const homeCaptureInFlightRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(userId);
  const statusRef = useRef<SOSStatus>('idle');
  const voiceCountdownPendingRef = useRef(false);
  const sosTriggerSourceRef = useRef<'manual' | 'voice'>('manual');
  const countdownExpiresAtRef = useRef<number | null>(null);
  const countdownCompletionHandledRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const sosCompletionInFlightRef = useRef(false);
  const sosEndingInFlightRef = useRef(false);
  const checkpointStartInFlightRef = useRef(false);
  const checkpointOperationGenerationRef = useRef(0);
  const checkpointExpirationHandledRef = useRef<string | null>(null);
  const checkpointOwnerUserIdRef = useRef<string | null>(userId);
  const checkpointStatusRef = useRef<CheckpointStatus>('idle');
  const checkpointStorageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const drawerNavigationInFlightRef = useRef(false);
  const pendingDrawerRouteRef = useRef<Href | null>(null);
  const drawerNavigationStartedAtRef = useRef(0);
  const logoGlowPulse = useRef(new Animated.Value(0)).current;
  const sosGlowPulse = useRef(new Animated.Value(0)).current;

  const latestEvent = useMemo(() => lastEvents[0], [lastEvents]);
  activeUserIdRef.current = userId;
  statusRef.current = status;
  checkpointStatusRef.current = checkpointStatus;
  goHomeStatusRef.current = goHomeStatus;

  useFocusEffect(
    useCallback(() => {
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

      logoAnimation.start();
      sosAnimation.start();

      return () => {
        logoAnimation.stop();
        sosAnimation.stop();
      };
    }, [logoGlowPulse, sosGlowPulse]),
  );

  const clearPersistedCheckpoint = useCallback((targetUserId: string | null) => {
    if (!targetUserId) {
      return Promise.resolve();
    }
    const cleanup = checkpointStorageQueueRef.current
      .catch(() => {})
      .then(() => CheckpointStorage.clearActive(targetUserId))
      .catch(() => {
        console.warn('[Checkpoint] cleanup sessione locale non completato');
      });
    checkpointStorageQueueRef.current = cleanup;
    return cleanup;
  }, []);

  const enterCheckpointConfirmation = useCallback((expiresAt: string) => {
    if (
      checkpointExpirationHandledRef.current === expiresAt ||
      checkpointStatusRef.current === 'confirming'
    ) {
      return;
    }
    checkpointExpirationHandledRef.current = expiresAt;
    checkpointStatusRef.current = 'confirming';
    setCheckpointRemainingSeconds(0);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
    setCheckpointStatus('confirming');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, []);

  const clearPersistedGoHome = useCallback((targetUserId: string | null) => {
    if (!targetUserId) {
      return Promise.resolve();
    }
    const cleanup = goHomeStorageQueueRef.current
      .catch(() => {})
      .then(() => GoHomeStorage.clearActive(targetUserId))
      .catch(() => {
        console.warn('[TornoACasa] cleanup sessione locale non completato');
      });
    goHomeStorageQueueRef.current = cleanup;
    return cleanup;
  }, []);

  const enterGoHomeConfirmation = useCallback((expiresAt: string) => {
    if (
      goHomeExpirationHandledRef.current === expiresAt ||
      goHomeStatusRef.current === 'confirming'
    ) {
      return;
    }
    goHomeExpirationHandledRef.current = expiresAt;
    goHomeStatusRef.current = 'confirming';
    setGoHomeRemainingSeconds(0);
    setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
    setGoHomeStatus('confirming');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, []);

  const startSOSCountdown = useCallback((
    source: 'manual' | 'voice' = 'manual',
    requestedExpiresAt?: number,
  ) => {
    loadGenerationRef.current += 1;
    statusRef.current = 'countdown';
    checkpointOperationGenerationRef.current += 1;
    checkpointStartInFlightRef.current = false;
    void clearPersistedCheckpoint(checkpointOwnerUserIdRef.current);
    checkpointOwnerUserIdRef.current = null;
    checkpointExpirationHandledRef.current = null;
    checkpointStatusRef.current = 'idle';
    setCheckpointExpiresAt(null);
    setCheckpointStatus('idle');
    setCheckpointRemainingSeconds(0);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
    goHomeEstimateGenerationRef.current += 1;
    goHomeEstimateInFlightRef.current = false;
    goHomeOperationGenerationRef.current += 1;
    void clearPersistedGoHome(goHomeOwnerUserIdRef.current);
    goHomeOwnerUserIdRef.current = null;
    goHomeExpirationHandledRef.current = null;
    goHomeStatusRef.current = 'idle';
    setGoHomeExpiresAt(null);
    setGoHomeStatus('idle');
    setGoHomeSession(null);
    setGoHomeRemainingSeconds(0);
    setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
    setGoHomeError('');
    setGoHomeErrorAction(null);
    countdownExpiresAtRef.current =
      source === 'voice' && requestedExpiresAt
        ? requestedExpiresAt
        : Date.now() + SAFETY_TIMER_SECONDS * 1_000;
    countdownCompletionHandledRef.current = false;
    sosTriggerSourceRef.current = source;
    setRemainingSeconds(SAFETY_TIMER_SECONDS);
    setActiveEvent(null);
    setPushDeliveryNotice(null);
    setStatus('countdown');
  }, [clearPersistedCheckpoint, clearPersistedGoHome]);

  useEffect(
    () =>
      VoiceProtectionRuntime.onSOSRequested((requestUserId) => {
        if (requestUserId !== activeUserIdRef.current) {
          VoiceProtectionRuntime.cancelScheduledSOS(requestUserId);
          console.info('[VoiceProtection Home] VOICE_TRIGGER_BLOCKED', {
            category: 'account_mismatch',
          });
          return;
        }
        if (statusRef.current !== 'idle') {
          VoiceProtectionRuntime.cancelScheduledSOS(requestUserId);
          console.info('[VoiceProtection Home] VOICE_TRIGGER_BLOCKED', {
            category: 'sos_already_active',
          });
          return;
        }

        console.info('[VoiceProtection Home] VOICE_LISTENER_RECEIVED');
        voiceCountdownPendingRef.current = true;
        const scheduledSOS = VoiceProtectionRuntime.getScheduledSOS(requestUserId);
        startSOSCountdown('voice', scheduledSOS?.expiresAt);
        if (AppState.currentState === 'active') {
          router.dismissTo('/(tabs)');
        }
      }),
    [router, startSOSCountdown],
  );

  const resetSensitiveState = useCallback(() => {
    if (activeUserIdRef.current) {
      VoiceProtectionRuntime.cancelScheduledSOS(activeUserIdRef.current);
    }
    statusRef.current = 'idle';
    voiceCountdownPendingRef.current = false;
    sosTriggerSourceRef.current = 'manual';
    countdownExpiresAtRef.current = null;
    countdownCompletionHandledRef.current = false;
    setContacts([]);
    setLastEvents([]);
    setActiveEvent(null);
    setPushDeliveryNotice(null);
    sosCompletionInFlightRef.current = false;
    sosEndingInFlightRef.current = false;
    setIsEndingSOS(false);
    setStatus('idle');
    setRemainingSeconds(SAFETY_TIMER_SECONDS);
    checkpointOperationGenerationRef.current += 1;
    checkpointStartInFlightRef.current = false;
    checkpointOwnerUserIdRef.current = null;
    checkpointExpirationHandledRef.current = null;
    checkpointStatusRef.current = 'idle';
    setCheckpointExpiresAt(null);
    setCheckpointStatus('idle');
    setCheckpointRemainingSeconds(0);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
    setHomeLocation(null);
    setGoHomeTransportMode('walking');
    goHomeEstimateGenerationRef.current += 1;
    goHomeEstimateInFlightRef.current = false;
    goHomeOperationGenerationRef.current += 1;
    goHomeExpirationHandledRef.current = null;
    goHomeStatusRef.current = 'idle';
    homeCaptureInFlightRef.current = false;
    setGoHomeStatus('idle');
    setGoHomeSession(null);
    setGoHomeExpiresAt(null);
    setGoHomeRemainingSeconds(0);
    setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
    setGoHomeError('');
    setGoHomeErrorAction(null);
  }, []);

  const loadSOSData = useCallback(async () => {
    const loadUserId = userId;
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;

    if (isInitializing || !loadUserId) {
      return;
    }

    try {
      const [
        storedContacts,
        storedEvents,
        storedHomeLocation,
        storedTransportMode,
        storedCheckpoint,
        storedGoHome,
      ] =
        await Promise.all([
          isOffline ? ContactsService.listCached(loadUserId) : ContactsService.list(),
          SOSStorage.listEvents(loadUserId),
          GoHomeStorage.getHomeLocation(loadUserId),
          GoHomeStorage.getTransportMode(loadUserId),
          CheckpointStorage.getActive(loadUserId),
          GoHomeStorage.getActive(loadUserId),
        ]);
      let nextEvents = storedEvents;
      let restoredActiveEvent: ActiveSOSEvent | null = null;
      const latestStoredEvent = storedEvents[0];

      const latestEventWasActive =
        latestStoredEvent?.isActive === true ||
        latestStoredEvent?.remoteStatus === 'open' ||
        latestStoredEvent?.remoteStatus === 'accepted';

      if (latestStoredEvent?.location && latestStoredEvent.message && latestEventWasActive) {
        const restoreLatestEvent = () => {
          restoredActiveEvent = {
            ...latestStoredEvent,
            isActive: true,
            location: latestStoredEvent.location!,
            message: latestStoredEvent.message!,
          };
        };

        if (!latestStoredEvent.remoteSosId || isOffline) {
          restoreLatestEvent();
          if (latestStoredEvent.remoteSosId && isOffline) {
            console.info('[SafeMeLink SOS] Ripristino locale in modalit\u00e0 offline.', {
              category: 'offline_cached_state',
            });
          }
        } else {
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
              isActive: true,
              location: latestStoredEvent.location,
              message: latestStoredEvent.message,
              remoteStatus: remoteState.sos_status,
            };
          } else {
            try {
              nextEvents = await runSOSLocalStepWithTimeout(
                SOSStorage.finalizeEvent(
                  loadUserId,
                  latestStoredEvent.id,
                  remoteState.sos_status,
                ),
              );
            } catch {
              nextEvents = storedEvents.map((event) =>
                event.id === latestStoredEvent.id
                  ? {
                      ...event,
                      contactIds: [],
                      isActive: false,
                      location: null,
                      message: null,
                      remoteStatus: remoteState.sos_status,
                    }
                  : event,
              );
              console.warn('[SafeMeLink SOS] Stato terminale non salvato localmente.', {
                category: 'local_storage_unavailable',
              });
            }
          }
        } catch {
          restoreLatestEvent();
          console.warn('[SafeMeLink SOS] Stato remoto temporaneamente non disponibile.', {
            category: 'remote_status_unavailable',
          });
        }
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
      setGoHomeTransportMode(storedTransportMode);
      if (statusRef.current === 'idle') {
        setActiveEvent(restoredActiveEvent);
        setStatus(restoredActiveEvent ? 'active' : 'idle');
      } else {
        console.info('[SafeMeLink SOS] Snapshot locale ignorato durante lifecycle attivo.', {
          lifecycle: statusRef.current,
        });
      }
      if (restoredActiveEvent) {
        if (storedCheckpoint) {
          void clearPersistedCheckpoint(loadUserId);
        }
        if (storedGoHome) {
          void clearPersistedGoHome(loadUserId);
        }
      } else if (checkpointStatusRef.current === 'idle' && storedCheckpoint) {
        if (storedGoHome) {
          void clearPersistedGoHome(loadUserId);
        }
        const expiresAtMs = Date.parse(storedCheckpoint.expiresAt);
        const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
        checkpointOwnerUserIdRef.current = loadUserId;
        checkpointExpirationHandledRef.current = null;
        setCheckpointMinutes(storedCheckpoint.durationMinutes);
        setCheckpointExpiresAt(storedCheckpoint.expiresAt);
        if (remainingSeconds > 0) {
          checkpointStatusRef.current = 'running';
          setCheckpointRemainingSeconds(remainingSeconds);
          setCheckpointStatus('running');
        } else {
          enterCheckpointConfirmation(storedCheckpoint.expiresAt);
        }
      } else if (goHomeStatusRef.current === 'idle' && storedGoHome) {
        const remainingSeconds = Math.max(
          0,
          Math.ceil((Date.parse(storedGoHome.expiresAt) - Date.now()) / 1000),
        );
        goHomeOwnerUserIdRef.current = loadUserId;
        goHomeExpirationHandledRef.current = null;
        setGoHomeSession(storedGoHome);
        setGoHomeTransportMode(storedGoHome.transportMode);
        setGoHomeExpiresAt(storedGoHome.expiresAt);
        if (remainingSeconds > 0) {
          goHomeStatusRef.current = 'running';
          setGoHomeRemainingSeconds(remainingSeconds);
          setGoHomeStatus('running');
        } else {
          enterGoHomeConfirmation(storedGoHome.expiresAt);
        }
      }
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
  }, [
    clearPersistedCheckpoint,
    clearPersistedGoHome,
    enterCheckpointConfirmation,
    enterGoHomeConfirmation,
    isInitializing,
    isOffline,
    userId,
  ]);

  useEffect(() => {
    const previousCheckpointUserId = checkpointOwnerUserIdRef.current;
    const previousGoHomeUserId = goHomeOwnerUserIdRef.current;
    if (previousCheckpointUserId && previousCheckpointUserId !== userId) {
      void clearPersistedCheckpoint(previousCheckpointUserId);
    }
    checkpointOwnerUserIdRef.current = null;
    if (previousGoHomeUserId && previousGoHomeUserId !== userId) {
      void clearPersistedGoHome(previousGoHomeUserId);
    }
    goHomeOwnerUserIdRef.current = null;
    loadGenerationRef.current += 1;
    resetSensitiveState();
  }, [clearPersistedCheckpoint, clearPersistedGoHome, resetSensitiveState, userId]);

  useEffect(() => {
    if (status === 'countdown' && voiceCountdownPendingRef.current) {
      voiceCountdownPendingRef.current = false;
      console.info('[VoiceProtection Home] VOICE_COUNTDOWN_STARTED');
    }
  }, [status]);

  useFocusEffect(
    useCallback(() => {
      void loadSOSData();

      return () => {
        loadGenerationRef.current += 1;
        goHomeEstimateGenerationRef.current += 1;
        goHomeEstimateInFlightRef.current = false;
        homeCaptureInFlightRef.current = false;
      };
    }, [loadSOSData]),
  );

  useFocusEffect(
    useCallback(() => {
      const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (drawerVisible) {
          if (pendingDrawerRouteRef.current) {
            console.info('[SafeMeLink Navigation] navigazione drawer annullata.', {
              origin: '/(tabs)',
              destination: String(pendingDrawerRouteRef.current),
            });
            pendingDrawerRouteRef.current = null;
            drawerNavigationInFlightRef.current = false;
          }
          setDrawerVisible(false);
          return true;
        }

        if (activePanel !== 'home') {
          if (activePanel === 'goHome' && goHomeStatus === 'estimating') {
            goHomeEstimateGenerationRef.current += 1;
            goHomeEstimateInFlightRef.current = false;
            setGoHomeStatus('idle');
          }
          setActivePanel('home');
          return true;
        }

        if (status === 'countdown') {
          setRemainingSeconds(SAFETY_TIMER_SECONDS);
          setStatus('idle');
          return true;
        }

        return false;
      });

      return () => backSubscription.remove();
    }, [activePanel, drawerVisible, goHomeStatus, status]),
  );

  const cancelSOS = () => {
    if (userId) {
      VoiceProtectionRuntime.cancelScheduledSOS(userId);
    }
    sosTriggerSourceRef.current = 'manual';
    countdownExpiresAtRef.current = null;
    countdownCompletionHandledRef.current = false;
    setRemainingSeconds(SAFETY_TIMER_SECONDS);
    setStatus('idle');
  };

  const startCheckpoint = async (minutes: number) => {
    if (
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > CHECKPOINT_MAX_DURATION_MINUTES
    ) {
      Alert.alert('Checkpoint', 'Seleziona una durata valida prima di avviare il Checkpoint.');
      return false;
    }
    if (status !== 'idle') {
      Alert.alert('Checkpoint', 'Puoi avviare un checkpoint solo quando non ci sono SOS attivi.');
      return false;
    }
    if (goHomeStatus !== 'idle') {
      Alert.alert('Checkpoint', 'Concludi o annulla Torno a casa prima di avviare un Checkpoint.');
      return false;
    }
    if (!userId) {
      Alert.alert('Checkpoint', 'Accedi prima di avviare un Checkpoint.');
      return false;
    }

    const operationGeneration = checkpointOperationGenerationRef.current + 1;
    checkpointOperationGenerationRef.current = operationGeneration;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const expiresAt = new Date(startedAtMs + minutes * 60_000).toISOString();

    try {
      await checkpointStorageQueueRef.current.catch(() => {});
      if (
        checkpointOperationGenerationRef.current !== operationGeneration ||
        activeUserIdRef.current !== userId
      ) {
        return false;
      }
      await CheckpointStorage.saveActive(userId, {
        active: true,
        durationMinutes: minutes,
        expiresAt,
        startedAt,
      });
    } catch {
      Alert.alert('Checkpoint', 'Non riesco a salvare il Checkpoint sul dispositivo. Riprova.');
      return false;
    }

    if (
      checkpointOperationGenerationRef.current !== operationGeneration ||
      activeUserIdRef.current !== userId ||
      statusRef.current !== 'idle' ||
      goHomeStatus !== 'idle'
    ) {
      void clearPersistedCheckpoint(userId);
      return false;
    }

    checkpointOwnerUserIdRef.current = userId;
    checkpointExpirationHandledRef.current = null;
    checkpointStatusRef.current = 'running';
    setCheckpointMinutes(minutes);
    setCheckpointExpiresAt(expiresAt);
    setCheckpointRemainingSeconds(Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
    setCheckpointStatus('running');
    return true;
  };

  const setCheckpointDurationDraft = (totalMinutes: number) => {
    const boundedMinutes = Math.min(
      CHECKPOINT_MAX_DURATION_MINUTES,
      Math.max(0, Math.trunc(totalMinutes)),
    );
    setCheckpointHoursDraft(Math.floor(boundedMinutes / 60));
    setCheckpointMinutesDraft(boundedMinutes % 60);
  };

  const adjustCheckpointDuration = (deltaMinutes: number) => {
    const currentDuration = checkpointHoursDraft * 60 + checkpointMinutesDraft;
    setCheckpointDurationDraft(currentDuration + deltaMinutes);
  };

  const startSelectedCheckpoint = async () => {
    if (checkpointStartInFlightRef.current) {
      return;
    }
    checkpointStartInFlightRef.current = true;
    const selectedDuration = getCheckpointDurationMinutes(
      checkpointHoursDraft,
      checkpointMinutesDraft,
    );
    if (selectedDuration === null || !(await startCheckpoint(selectedDuration))) {
      checkpointStartInFlightRef.current = false;
    }
  };

  const cancelCheckpoint = useCallback(() => {
    checkpointOperationGenerationRef.current += 1;
    checkpointStartInFlightRef.current = false;
    void clearPersistedCheckpoint(checkpointOwnerUserIdRef.current);
    checkpointOwnerUserIdRef.current = null;
    checkpointExpirationHandledRef.current = null;
    checkpointStatusRef.current = 'idle';
    setCheckpointExpiresAt(null);
    setCheckpointStatus('idle');
    setCheckpointRemainingSeconds(0);
    setCheckpointConfirmSeconds(CHECKPOINT_CONFIRM_SECONDS);
  }, [clearPersistedCheckpoint]);

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

  const captureCurrentLocationAsHome = async () => {
    if (!userId) {
      Alert.alert('Torno a casa', 'Accedi prima di salvare la posizione Casa.');
      return;
    }
    if (homeCaptureInFlightRef.current) {
      return;
    }

    const requestGeneration = goHomeEstimateGenerationRef.current + 1;
    goHomeEstimateGenerationRef.current = requestGeneration;
    homeCaptureInFlightRef.current = true;

    try {
      const actionUserId = userId;
      const location = await LocationService.getCurrentLocation({
        timeoutMs: INTERACTIVE_LOCATION_TIMEOUT_MS,
      });

      if (
        activeUserIdRef.current !== actionUserId ||
        goHomeEstimateGenerationRef.current !== requestGeneration
      ) {
        return;
      }

      const savedLocation = await GoHomeStorage.saveHomeLocation(actionUserId, location);

      if (
        activeUserIdRef.current !== actionUserId ||
        goHomeEstimateGenerationRef.current !== requestGeneration
      ) {
        return;
      }

      setHomeLocation(savedLocation);
      Alert.alert('Torno a casa', 'Posizione Casa salvata su questo dispositivo.');
    } catch (error) {
      if (goHomeEstimateGenerationRef.current === requestGeneration) {
        Alert.alert(
          'Torno a casa',
          error instanceof Error ? error.message : 'Non riesco a salvare la posizione Casa.',
        );
      }
    } finally {
      homeCaptureInFlightRef.current = false;
    }
  };

  const confirmHomeLocationChange = () => {
    if (!userId) {
      Alert.alert('Torno a casa', 'Accedi prima di salvare la posizione Casa.');
      return;
    }

    Alert.alert(
      homeLocation ? 'Modifica casa' : 'Imposta casa',
      homeLocation
        ? 'Vuoi sostituire la posizione Casa salvata con la posizione in cui ti trovi ora?'
        : 'Vuoi impostare come Casa la posizione in cui ti trovi ora?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: homeLocation ? 'Modifica' : 'Imposta',
          onPress: () => void captureCurrentLocationAsHome(),
        },
      ],
    );
  };

  const cancelGoHome = useCallback(() => {
    goHomeEstimateGenerationRef.current += 1;
    goHomeEstimateInFlightRef.current = false;
    goHomeOperationGenerationRef.current += 1;
    void clearPersistedGoHome(goHomeOwnerUserIdRef.current);
    goHomeOwnerUserIdRef.current = null;
    goHomeExpirationHandledRef.current = null;
    goHomeStatusRef.current = 'idle';
    setGoHomeExpiresAt(null);
    setGoHomeStatus('idle');
    setGoHomeError('');
    setGoHomeErrorAction(null);
    setGoHomeSession(null);
    setGoHomeRemainingSeconds(0);
    setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
  }, [clearPersistedGoHome]);

  const selectGoHomeTransportMode = async (mode: GoHomeTransportMode) => {
    const actionUserId = userId;
    setGoHomeTransportMode(mode);

    if (!actionUserId) {
      return;
    }

    try {
      await GoHomeStorage.saveTransportMode(actionUserId, mode);
    } catch {
      if (activeUserIdRef.current === actionUserId) {
        Alert.alert(
          'Torno a casa',
          'Modalità selezionata per questa sessione, ma non è stato possibile ricordarla.',
        );
      }
    }
  };

  const openGoHomeLocationSettings = async () => {
    try {
      if (Platform.OS === 'android') {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
        return;
      }

      await Linking.openSettings();
    } catch (error) {
      console.warn('[TornoACasa] apertura impostazioni posizione non riuscita', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      await Linking.openSettings();
    }
  };

  const startGoHome = async () => {
    if (goHomeEstimateInFlightRef.current) {
      console.info('[TornoACasa] richiesta ignorata: calcolo già in corso');
      return;
    }

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

    const requestGeneration = goHomeEstimateGenerationRef.current + 1;
    goHomeEstimateGenerationRef.current = requestGeneration;
    goHomeEstimateInFlightRef.current = true;
    setGoHomeStatus('estimating');
    setGoHomeError('');
    setGoHomeErrorAction(null);
    const startedAt = Date.now();
    console.info('[TornoACasa] inizio operazione');

    try {
      const actionUserId = userId;
      console.info('[TornoACasa] lettura casa salvata avviata');
      const savedHomeLocation = await runGoHomeStepWithTimeout(
        GoHomeStorage.getHomeLocation(actionUserId),
        GO_HOME_STORAGE_TIMEOUT_MS,
        'La lettura della posizione Casa non risponde. Riprova.',
      );
      console.info('[TornoACasa] lettura casa salvata completata', {
        found: Boolean(savedHomeLocation),
      });

      if (
        activeUserIdRef.current !== actionUserId ||
        goHomeEstimateGenerationRef.current !== requestGeneration
      ) {
        return;
      }

      if (!savedHomeLocation) {
        setGoHomeError('Salva prima la posizione Casa.');
        setGoHomeErrorAction(null);
        Alert.alert('Torno a casa', 'Salva prima la posizione Casa.');
        return;
      }

      console.info('[TornoACasa] richiesta GPS avviata');
      const startLocation = await runGoHomeStepWithTimeout(
        LocationService.getCurrentLocation({
          timeoutMs: INTERACTIVE_LOCATION_TIMEOUT_MS,
        }),
        GO_HOME_GPS_TIMEOUT_MS,
        'La richiesta GPS non risponde. Controlla la posizione e riprova.',
      );
      console.info('[TornoACasa] posizione GPS ricevuta');

      if (
        activeUserIdRef.current !== actionUserId ||
        goHomeEstimateGenerationRef.current !== requestGeneration
      ) {
        return;
      }

      const distanceKm = calculateDistanceKm(startLocation, savedHomeLocation);
      const transportMode = goHomeTransportMode;
      const estimatedMinutes = estimateGoHomeMinutes(distanceKm, transportMode);
      console.info('[TornoACasa] stima percorso completata');
      Alert.alert(
        'Torno a casa',
        `Modalità: ${getGoHomeTransportLabel(transportMode)}\nDistanza stimata: ${distanceKm.toFixed(2)} km\nTempo indicativo: ${estimatedMinutes} min\n\nStima lineare di sicurezza: non considera strade, traffico o deviazioni.`,
        [
          {
            text: 'Annulla',
            style: 'cancel',
            onPress: () => {
              if (goHomeEstimateGenerationRef.current === requestGeneration) {
                setGoHomeStatus('idle');
              }
            },
          },
          {
            text: 'Avvia',
            onPress: () => void (async () => {
              if (
                activeUserIdRef.current !== actionUserId ||
                goHomeEstimateGenerationRef.current !== requestGeneration
              ) {
                return;
              }
              const operationGeneration = goHomeOperationGenerationRef.current + 1;
              goHomeOperationGenerationRef.current = operationGeneration;
              const startedAtMs = Date.now();
              const startedAt = new Date(startedAtMs).toISOString();
              const expiresAt = new Date(
                startedAtMs + estimatedMinutes * 60_000,
              ).toISOString();
              const session: ActiveGoHomeSession = {
                active: true,
                id: `${startedAtMs}`,
                createdAt: startedAt,
                distanceKm,
                estimatedMinutes,
                expiresAt,
                startedAt,
                transportMode,
              };
              const runtimeSession: GoHomeSession = {
                ...session,
                homeLocation: savedHomeLocation,
                startLocation,
              };
              try {
                if (
                  activeUserIdRef.current !== actionUserId ||
                  goHomeEstimateGenerationRef.current !== requestGeneration ||
                  goHomeOperationGenerationRef.current !== operationGeneration
                ) {
                  return;
                }
                const saveOperation = goHomeStorageQueueRef.current
                  .catch(() => {})
                  .then(() => GoHomeStorage.saveActive(actionUserId, session));
                goHomeStorageQueueRef.current = saveOperation
                  .then(() => undefined)
                  .catch(() => {});
                await saveOperation;
              } catch {
                if (
                  activeUserIdRef.current === actionUserId &&
                  goHomeOperationGenerationRef.current === operationGeneration
                ) {
                  Alert.alert(
                    'Torno a casa',
                    'Non riesco a salvare la sessione sul dispositivo. Riprova.',
                  );
                  setGoHomeStatus('idle');
                }
                return;
              }

              if (
                activeUserIdRef.current !== actionUserId ||
                goHomeEstimateGenerationRef.current !== requestGeneration ||
                goHomeOperationGenerationRef.current !== operationGeneration ||
                statusRef.current !== 'idle' ||
                checkpointStatusRef.current !== 'idle'
              ) {
                void clearPersistedGoHome(actionUserId);
                return;
              }

              goHomeOwnerUserIdRef.current = actionUserId;
              goHomeExpirationHandledRef.current = null;
              goHomeStatusRef.current = 'running';
              setGoHomeSession(runtimeSession);
              setGoHomeExpiresAt(expiresAt);
              setGoHomeRemainingSeconds(
                Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)),
              );
              setGoHomeConfirmSeconds(GO_HOME_CONFIRM_SECONDS);
              setGoHomeStatus('running');
            })(),
          },
        ]
      );
    } catch (error) {
      if (goHomeEstimateGenerationRef.current !== requestGeneration) {
        console.info('[TornoACasa] risultato ignorato: operazione annullata', {
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Non riesco ad avviare Torno a casa.';
      console.error('[TornoACasa] errore operazione', {
        durationMs: Date.now() - startedAt,
        category: error instanceof Error ? error.name : 'unknown',
      });

      if (error instanceof LocationPermissionError) {
        setGoHomeError(errorMessage);
        setGoHomeErrorAction('location-settings');
        Alert.alert(
          'Posizione non autorizzata',
          'Consenti a SafeMeLink di usare la posizione nelle impostazioni e poi riprova.',
          [
            { text: 'Annulla', style: 'cancel' },
            { text: 'Apri impostazioni', onPress: () => void openGoHomeLocationSettings() },
          ],
        );
      } else if (error instanceof LocationUnavailableError) {
        setGoHomeError(errorMessage);
        setGoHomeErrorAction('location-settings');
        Alert.alert(
          'GPS non disponibile',
          errorMessage,
          [
            { text: 'Annulla', style: 'cancel' },
            {
              text: 'Apri impostazioni',
              onPress: () => void openGoHomeLocationSettings(),
            },
          ],
        );
      } else {
        setGoHomeError(errorMessage);
        setGoHomeErrorAction('retry');
        Alert.alert(
          'Torno a casa',
          errorMessage,
          [
            { text: 'Annulla', style: 'cancel' },
            {
              text: 'Riprova',
              onPress: () => void startGoHome(),
            },
          ],
        );
      }
    } finally {
      if (goHomeEstimateGenerationRef.current === requestGeneration) {
        goHomeEstimateInFlightRef.current = false;
        setGoHomeStatus((current) => (current === 'estimating' ? 'idle' : current));
      }
      console.info('[TornoACasa] termine operazione', {
        cancelled: goHomeEstimateGenerationRef.current !== requestGeneration,
        durationMs: Date.now() - startedAt,
      });
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

  const applySOSCompletion = useCallback((
    result: SOSCompletionResult,
    actionUserId: string,
  ) => {
    if (activeUserIdRef.current !== actionUserId) {
      return;
    }

    setActiveEvent(result.event);
    setLastEvents(result.events);
    const deliveryNotice = getSOSDeliveryNotice(
      result.pushResult,
      result.localDeliveryResult,
      result.automaticSmsResult,
    );
    const persistenceNotice = result.localPersistenceFailed
      ? 'SOS attivo, ma la cronologia locale non è stata salvata. Mantieni aperta l’app fino alla conclusione.'
      : null;
    setPushDeliveryNotice(
      [persistenceNotice, deliveryNotice].filter(Boolean).join(' ') || null,
    );
    setStatus('active');
  }, []);

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
    if (
      sosTriggerSourceRef.current === 'voice' &&
      !VoiceProtectionRuntime.cancelScheduledSOS(actionUserId)
    ) {
      return;
    }
    countdownCompletionHandledRef.current = true;
    countdownExpiresAtRef.current = null;
    sosCompletionInFlightRef.current = true;
    setStatus('sending');

    try {
      const result = await SOSService.completeSOS(actionUserId, {
        allowRemoteDelivery: !isOffline,
        allowRecentNetworkLocation: sosTriggerSourceRef.current === 'voice',
      });

      applySOSCompletion(result, actionUserId);
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
  }, [applySOSCompletion, isOffline, userId]);

  useEffect(() => {
    const removeStartedListener = VoiceProtectionRuntime.onSOSExecutionStarted(
      (executionUserId) => {
        if (executionUserId === activeUserIdRef.current) {
          countdownCompletionHandledRef.current = true;
          countdownExpiresAtRef.current = null;
          setStatus('sending');
        }
      },
    );
    const removeCompletedListener = VoiceProtectionRuntime.onSOSCompleted(
      (executionUserId, result) => {
        if (executionUserId === activeUserIdRef.current) {
          applySOSCompletion(result, executionUserId);
        }
      },
    );
    const removeFailedListener = VoiceProtectionRuntime.onSOSFailed(
      (executionUserId) => {
        if (executionUserId !== activeUserIdRef.current) {
          return;
        }
        setStatus('idle');
        const message = 'Non è stato possibile completare l’SOS. Controlla posizione e connessione.';
        if (AppState.currentState === 'active') {
          Alert.alert('SOS non inviato', message);
        } else {
          setPushDeliveryNotice('SOS non completato. Riapri SafeMeLink e riprova.');
        }
      },
    );

    return () => {
      removeStartedListener();
      removeCompletedListener();
      removeFailedListener();
    };
  }, [applySOSCompletion]);

  useEffect(() => {
    const trackedEvent = activeEvent;
    const trackedUserId = userId;

    if (!isHomeFocused || !trackedEvent?.remoteSosId || !trackedUserId || status !== 'active') {
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

        let nextEvents: SOSEvent[];
        try {
          nextEvents = await runSOSLocalStepWithTimeout(
            SOSStorage.finalizeEvent(
              trackedUserId,
              trackedEvent.id,
              remoteState.sos_status,
            ),
          );
        } catch {
          nextEvents = lastEvents.map((event) =>
            event.id === trackedEvent.id
              ? {
                  ...event,
                  contactIds: [],
                  isActive: false,
                  location: null,
                  message: null,
                  remoteStatus: remoteState.sos_status,
                }
              : event,
          );
          console.warn('[SafeMeLink SOS] Stato terminale non salvato localmente.', {
            category: 'local_storage_unavailable',
          });
        }

        if (isCurrent && activeUserIdRef.current === trackedUserId) {
          setLastEvents(nextEvents);
          setActiveEvent(null);
          setRemainingSeconds(SAFETY_TIMER_SECONDS);
          setStatus('idle');
        }
      } catch {
        console.warn('[SafeMeLink SOS] Aggiornamento stato remoto non riuscito.', {
          category: 'remote_status_unavailable',
        });
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
  }, [activeEvent, isHomeFocused, lastEvents, status, userId]);

  useEffect(() => {
    if (status !== 'countdown' || countdownExpiresAtRef.current === null) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let appState = AppState.currentState;

    const clearCountdownTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const synchronizeCountdown = () => {
      clearCountdownTimer();
      const expiresAt = countdownExpiresAtRef.current;
      if (expiresAt === null || statusRef.current !== 'countdown') {
        return;
      }

      const remainingMs = Math.max(0, expiresAt - Date.now());
      setRemainingSeconds(Math.ceil(remainingMs / 1_000));

      if (remainingMs <= 0) {
        if (!countdownCompletionHandledRef.current) {
          countdownCompletionHandledRef.current = true;
          if (
            sosTriggerSourceRef.current === 'voice' &&
            activeUserIdRef.current &&
            VoiceProtectionRuntime.expediteScheduledSOS(activeUserIdRef.current)
          ) {
            return;
          }
          void completeSOS();
        }
        return;
      }

      timeoutId = setTimeout(
        synchronizeCountdown,
        appState === 'active' ? Math.min(1_000, remainingMs) : remainingMs,
      );
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      synchronizeCountdown();
    });
    synchronizeCountdown();

    return () => {
      clearCountdownTimer();
      subscription.remove();
    };
  }, [completeSOS, status]);

  useEffect(() => {
    if (checkpointStatus !== 'running' || !checkpointExpiresAt) {
      return;
    }

    const expiresAtMs = Date.parse(checkpointExpiresAt);
    const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
    if (remainingSeconds <= 0) {
      enterCheckpointConfirmation(checkpointExpiresAt);
      return;
    }
    if (remainingSeconds !== checkpointRemainingSeconds) {
      setCheckpointRemainingSeconds(remainingSeconds);
    }

    const timeoutId = setTimeout(() => {
      const nextRemainingSeconds = Math.max(
        0,
        Math.ceil((expiresAtMs - Date.now()) / 1000),
      );
      setCheckpointRemainingSeconds(nextRemainingSeconds);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [
    checkpointExpiresAt,
    checkpointRemainingSeconds,
    checkpointStatus,
    enterCheckpointConfirmation,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        nextState !== 'active' ||
        checkpointStatusRef.current !== 'running' ||
        !checkpointExpiresAt
      ) {
        return;
      }
      const remainingSeconds = Math.max(
        0,
        Math.ceil((Date.parse(checkpointExpiresAt) - Date.now()) / 1000),
      );
      setCheckpointRemainingSeconds(remainingSeconds);
      if (remainingSeconds === 0) {
        enterCheckpointConfirmation(checkpointExpiresAt);
      }
    });
    return () => subscription.remove();
  }, [checkpointExpiresAt, enterCheckpointConfirmation]);

  useEffect(() => {
    if (checkpointStatus !== 'confirming') {
      return;
    }

    if (checkpointConfirmSeconds <= 0) {
      const expiringUserId = checkpointOwnerUserIdRef.current;
      cancelCheckpoint();
      void checkpointStorageQueueRef.current.finally(() => {
        if (
          expiringUserId &&
          activeUserIdRef.current === expiringUserId &&
          statusRef.current === 'idle'
        ) {
          startSOSCountdown();
        }
      });
      return;
    }

    const timeoutId = setTimeout(() => {
      setCheckpointConfirmSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [cancelCheckpoint, checkpointConfirmSeconds, checkpointStatus, startSOSCountdown]);

  useEffect(() => {
    if (goHomeStatus !== 'running' || !goHomeExpiresAt) {
      return;
    }

    const expiresAtMs = Date.parse(goHomeExpiresAt);
    const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
    if (remainingSeconds <= 0) {
      enterGoHomeConfirmation(goHomeExpiresAt);
      return;
    }
    if (remainingSeconds !== goHomeRemainingSeconds) {
      setGoHomeRemainingSeconds(remainingSeconds);
    }

    const timeoutId = setTimeout(() => {
      setGoHomeRemainingSeconds(
        Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)),
      );
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [
    enterGoHomeConfirmation,
    goHomeExpiresAt,
    goHomeRemainingSeconds,
    goHomeStatus,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        nextState !== 'active' ||
        goHomeStatusRef.current !== 'running' ||
        !goHomeExpiresAt
      ) {
        return;
      }
      const remainingSeconds = Math.max(
        0,
        Math.ceil((Date.parse(goHomeExpiresAt) - Date.now()) / 1000),
      );
      setGoHomeRemainingSeconds(remainingSeconds);
      if (remainingSeconds === 0) {
        enterGoHomeConfirmation(goHomeExpiresAt);
      }
    });
    return () => subscription.remove();
  }, [enterGoHomeConfirmation, goHomeExpiresAt]);

  useEffect(() => {
    if (goHomeStatus !== 'confirming') {
      return;
    }

    if (goHomeConfirmSeconds <= 0) {
      const expiringUserId = goHomeOwnerUserIdRef.current;
      cancelGoHome();
      void goHomeStorageQueueRef.current.finally(() => {
        if (
          expiringUserId &&
          activeUserIdRef.current === expiringUserId &&
          statusRef.current === 'idle' &&
          checkpointStatusRef.current === 'idle'
        ) {
          startSOSCountdown();
        }
      });
      return;
    }

    const timeoutId = setTimeout(() => {
      setGoHomeConfirmSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [cancelGoHome, goHomeConfirmSeconds, goHomeStatus, startSOSCountdown]);

  const finishSOS = async (terminalStatus: SOSTerminalStatus) => {
    if (sosEndingInFlightRef.current || !activeEvent) {
      if (sosEndingInFlightRef.current) {
        console.info('[SafeMeLink SOS] Chiusura duplicata ignorata.');
        Alert.alert(
          'Chiusura SOS in corso',
          'La richiesta è già stata inviata. Attendi la risposta del server.',
        );
      }
      return;
    }

    const eventToFinish = activeEvent;
    const actionUserId = userId;

    if (!actionUserId) {
      const diagnosticError = new SOSLifecycleDiagnosticError('auth');
      Alert.alert(
        'SOS ancora attivo',
        `${diagnosticError.message}\n\nCodice diagnostico: ${diagnosticError.category}`,
      );
      return;
    }

    const startedAt = Date.now();
    sosEndingInFlightRef.current = true;
    setIsEndingSOS(true);
    console.info('[SafeMeLink SOS] Chiusura avviata.', {
      terminalStatus,
      hasRemoteSos: Boolean(eventToFinish.remoteSosId),
    });

    try {
      if (eventToFinish.remoteSosId) {
        console.info('[SafeMeLink SOS] Aggiornamento stato remoto avviato.');
        const remoteState =
          terminalStatus === 'closed'
            ? await SOSLifecycleService.close(eventToFinish.remoteSosId)
            : await SOSLifecycleService.cancel(eventToFinish.remoteSosId);

        if (remoteState.sos_status !== terminalStatus) {
          throw new SOSLifecycleDiagnosticError('unexpected_status');
        }
        console.info('[SafeMeLink SOS] Stato remoto confermato.', { terminalStatus });
      }

      let nextEvents: SOSEvent[];

      try {
        nextEvents = await runSOSLocalStepWithTimeout(
          SOSStorage.finalizeEvent(actionUserId, eventToFinish.id, terminalStatus),
        );
      } catch {
        console.warn('[SafeMeLink SOS] Cronologia locale non aggiornata.', {
          category: 'local_storage_unavailable',
        });
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
      setPushDeliveryNotice(null);
      setRemainingSeconds(SAFETY_TIMER_SECONDS);
      setStatus('idle');
      console.info('[SafeMeLink SOS] Chiusura completata.', {
        durationMs: Date.now() - startedAt,
        terminalStatus,
      });
    } catch (finishError: unknown) {
      const diagnosticError = getSOSLifecycleDiagnosticError(finishError);
      console.warn('[SafeMeLink SOS] Chiusura non completata.', {
        durationMs: Date.now() - startedAt,
        category: diagnosticError.category,
        terminalStatus,
      });
      if (activeUserIdRef.current === actionUserId) {
        Alert.alert(
          'SOS ancora attivo',
          `${diagnosticError.message}\n\nCodice diagnostico: ${diagnosticError.category}`,
        );
      }
    } finally {
      sosEndingInFlightRef.current = false;
      if (activeUserIdRef.current === actionUserId) {
        setIsEndingSOS(false);
      }
    }
  };

  const deactivateSOS = () => {
    if (isEndingSOS || sosEndingInFlightRef.current) {
      Alert.alert(
        'Chiusura SOS in corso',
        'La richiesta è già stata inviata. Attendi la risposta del server.',
      );
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
      await SOSService.sendSmsFallback(activeEvent, contacts);
    } catch {
      Alert.alert('Condivisione SOS', 'Non riesco ad aprire il messaggio SMS.');
    }
  };

  const toggleSOSNetwork = async () => {
    try {
      await sosNetwork.setEnabled(!sosNetwork.enabled);
    } catch {
      Alert.alert(
        'Rete SafeMeLink',
        'Non è possibile aggiornare ora la partecipazione. Controlla connessione e permessi.',
      );
    }
  };

  const openPanel = (panel: HomePanel) => {
    setActivePanel(panel);
    setDrawerVisible(false);
  };

  const closeDrawer = () => {
    if (pendingDrawerRouteRef.current) {
      console.info('[SafeMeLink Navigation] navigazione drawer annullata.', {
        origin: '/(tabs)',
        destination: String(pendingDrawerRouteRef.current),
      });
      pendingDrawerRouteRef.current = null;
      drawerNavigationInFlightRef.current = false;
    }
    setDrawerVisible(false);
  };

  const navigateFromDrawer = (destination: Href) => {
    if (drawerNavigationInFlightRef.current) {
      console.info('[SafeMeLink Navigation] navigazione duplicata ignorata.', {
        origin: '/(tabs)',
        destination: String(destination),
      });
      return;
    }

    drawerNavigationInFlightRef.current = true;
    pendingDrawerRouteRef.current = destination;
    drawerNavigationStartedAtRef.current = Date.now();
    console.info('[SafeMeLink Navigation] inizio navigazione drawer.', {
      origin: '/(tabs)',
      destination: String(destination),
    });
    setDrawerVisible(false);
  };

  useEffect(() => {
    if (drawerVisible || !pendingDrawerRouteRef.current) {
      return;
    }

    const destination = pendingDrawerRouteRef.current;
    const navigationFrame = requestAnimationFrame(() => {
      if (pendingDrawerRouteRef.current !== destination) {
        return;
      }

      try {
        router.navigate(destination);
        console.info('[SafeMeLink Navigation] fine navigazione drawer.', {
          origin: '/(tabs)',
          destination: String(destination),
          durationMs: Date.now() - drawerNavigationStartedAtRef.current,
        });
      } catch (error) {
        console.error('[SafeMeLink Navigation] errore navigazione drawer.', {
          origin: '/(tabs)',
          destination: String(destination),
          durationMs: Date.now() - drawerNavigationStartedAtRef.current,
          error: error instanceof Error ? error.message : 'Errore sconosciuto.',
        });
      } finally {
        pendingDrawerRouteRef.current = null;
        drawerNavigationInFlightRef.current = false;
      }
    });

    return () => {
      cancelAnimationFrame(navigationFrame);
      if (pendingDrawerRouteRef.current === destination) {
        console.info('[SafeMeLink Navigation] navigazione drawer annullata nel cleanup.', {
          origin: '/(tabs)',
          destination: String(destination),
          durationMs: Date.now() - drawerNavigationStartedAtRef.current,
        });
        pendingDrawerRouteRef.current = null;
        drawerNavigationInFlightRef.current = false;
      }
    };
  }, [drawerVisible, router]);

  const activeSafetyMode =
    status !== 'idle'
      ? 'SOS attivo'
      : checkpointStatus !== 'idle'
        ? 'Checkpoint attivo'
        : goHomeStatus !== 'idle'
          ? 'Torno a casa attivo'
          : 'Nessuna modalita attiva';
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
      <SafeNetworkBackground />

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => setDrawerVisible(true)}>
          <Ionicons color="#F7FAFF" name="menu-outline" size={25} />
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
              <Text style={styles.summaryValue}>{contacts.length} salvati</Text>
            </View>
            <Link href={"/(tabs)/contacts" as any} asChild>
              <Pressable style={styles.manageContactsButton}>
                <Text style={styles.manageContactsText}>Gestisci</Text>
              </Pressable>
            </Link>
          </View>
          <View style={styles.networkSummary}>
            <View style={styles.networkSummaryCopy}>
              <Text style={styles.summaryLabel}>Rete SafeMeLink</Text>
              <Text style={styles.networkSummaryValue}>
                {sosNetwork.isLoading
                  ? 'VERIFICA…'
                  : sosNetwork.enabled
                    ? 'ATTIVA'
                    : 'DISATTIVA'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={
                sosNetwork.enabled
                  ? 'Disattiva Rete SafeMeLink'
                  : 'Attiva Rete SafeMeLink'
              }
              accessibilityRole="button"
              disabled={sosNetwork.isLoading || sosNetwork.isSaving || !userId}
              onPress={() => void toggleSOSNetwork()}
              style={[
                styles.networkToggle,
                sosNetwork.enabled && styles.networkToggleActive,
                (sosNetwork.isLoading || sosNetwork.isSaving || !userId) && styles.disabledButton,
              ]}>
              <Text
                style={[
                  styles.networkToggleText,
                  sosNetwork.enabled && styles.networkToggleTextActive,
                ]}>
                {sosNetwork.isSaving
                  ? 'ATTENDI…'
                  : sosNetwork.enabled
                    ? 'LASCIA'
                    : 'ATTIVA'}
              </Text>
            </Pressable>
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
          {pushDeliveryNotice ? (
            <View style={styles.pushDeliveryNotice}>
              <Text style={styles.pushDeliveryNoticeText}>{pushDeliveryNotice}</Text>
              <Pressable
                accessibilityLabel="Chiudi avviso notifiche"
                onPress={() => setPushDeliveryNotice(null)}
                style={styles.pushDeliveryNoticeDismiss}>
                <Text style={styles.pushDeliveryNoticeDismissText}>Chiudi</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable style={styles.shareButton} onPress={shareActiveSOS}>
            <Text style={styles.shareButtonText}>Invia di nuovo via SMS</Text>
          </Pressable>
          <Pressable
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
            <View style={styles.sosOuterRing} />
            <View style={styles.sosInnerRing} />
            <Pressable style={({ pressed }) => [styles.sosButton, pressed && styles.sosButtonPressed]} onPress={() => startSOSCountdown()}>
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
          <View style={styles.checkpointDurationCard}>
            <Text style={styles.checkpointPrompt}>CONTROLLAMI TRA</Text>
            <View style={styles.checkpointDurationSelector}>
              <View style={styles.checkpointDurationColumn}>
                <Pressable
                  accessibilityLabel="Aumenta ore"
                  accessibilityRole="button"
                  disabled={checkpointHoursDraft >= CHECKPOINT_MAX_HOURS}
                  hitSlop={8}
                  onPress={() => adjustCheckpointDuration(60)}
                  style={styles.checkpointStepButton}>
                  <Ionicons color="#a9d7ff" name="chevron-up" size={24} />
                </Pressable>
                <Text style={styles.checkpointDurationValue}>
                  {String(checkpointHoursDraft).padStart(2, '0')}
                </Text>
                <Text style={styles.checkpointDurationUnit}>ORE</Text>
                <Pressable
                  accessibilityLabel="Diminuisci ore"
                  accessibilityRole="button"
                  disabled={checkpointHoursDraft === 0 && checkpointMinutesDraft < 60}
                  hitSlop={8}
                  onPress={() => adjustCheckpointDuration(-60)}
                  style={styles.checkpointStepButton}>
                  <Ionicons color="#a9d7ff" name="chevron-down" size={24} />
                </Pressable>
              </View>
              <Text style={styles.checkpointDurationSeparator}>:</Text>
              <View style={styles.checkpointDurationColumn}>
                <Pressable
                  accessibilityLabel="Aumenta minuti"
                  accessibilityRole="button"
                  disabled={
                    checkpointHoursDraft * 60 + checkpointMinutesDraft >=
                    CHECKPOINT_MAX_DURATION_MINUTES
                  }
                  hitSlop={8}
                  onPress={() => adjustCheckpointDuration(1)}
                  style={styles.checkpointStepButton}>
                  <Ionicons color="#a9d7ff" name="chevron-up" size={24} />
                </Pressable>
                <Text style={styles.checkpointDurationValue}>
                  {String(checkpointMinutesDraft).padStart(2, '0')}
                </Text>
                <Text style={styles.checkpointDurationUnit}>MINUTI</Text>
                <Pressable
                  accessibilityLabel="Diminuisci minuti"
                  accessibilityRole="button"
                  disabled={checkpointHoursDraft === 0 && checkpointMinutesDraft === 0}
                  hitSlop={8}
                  onPress={() => adjustCheckpointDuration(-1)}
                  style={styles.checkpointStepButton}>
                  <Ionicons color="#a9d7ff" name="chevron-down" size={24} />
                </Pressable>
              </View>
            </View>
            <View style={styles.checkpointMinuteSteps}>
              <Pressable
                accessibilityLabel="Diminuisci di cinque minuti"
                accessibilityRole="button"
                onPress={() => adjustCheckpointDuration(-5)}
                style={styles.checkpointCompactButton}>
                <Text style={styles.checkpointCompactButtonText}>− 5 min</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Aumenta di cinque minuti"
                accessibilityRole="button"
                onPress={() => adjustCheckpointDuration(5)}
                style={styles.checkpointCompactButton}>
                <Text style={styles.checkpointCompactButtonText}>+ 5 min</Text>
              </Pressable>
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.checkpointDurationSummary}>
              {formatCheckpointDuration(checkpointHoursDraft, checkpointMinutesDraft)}
            </Text>
            <View style={styles.checkpointOptions}>
              {CHECKPOINT_QUICK_DURATIONS.map((minutes) => (
                <Pressable
                  accessibilityLabel={`Imposta durata ${minutes} minuti`}
                  accessibilityRole="button"
                  key={minutes}
                  onPress={() => setCheckpointDurationDraft(minutes)}
                  style={styles.checkpointButton}>
                  <Text style={styles.checkpointButtonText}>
                    {minutes === 60 ? '1 ora' : `${minutes} min`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={
                getCheckpointDurationMinutes(
                  checkpointHoursDraft,
                  checkpointMinutesDraft,
                ) === null
              }
              onPress={() => void startSelectedCheckpoint()}
              style={({ pressed }) => [
                styles.checkpointStartButton,
                pressed && styles.checkpointStartButtonPressed,
                getCheckpointDurationMinutes(
                  checkpointHoursDraft,
                  checkpointMinutesDraft,
                ) === null && styles.disabledButton,
              ]}>
              <Text style={styles.checkpointStartButtonText}>AVVIA CHECKPOINT</Text>
            </Pressable>
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
            <View style={styles.goHomeActiveMode}>
              <Ionicons
                color="#8fd5ff"
                name={
                  GO_HOME_TRANSPORT_OPTIONS.find(
                    (option) => option.mode === goHomeSession.transportMode,
                  )?.icon ?? 'walk-outline'
                }
                size={20}
              />
              <Text style={styles.goHomeActiveModeText}>
                {getGoHomeTransportLabel(goHomeSession.transportMode)}
              </Text>
            </View>
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
            <Text style={styles.goHomeModeTitle}>Come ti stai spostando?</Text>
            <View style={styles.goHomeModeOptions}>
              {GO_HOME_TRANSPORT_OPTIONS.map((option) => {
                const selected = option.mode === goHomeTransportMode;

                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    disabled={goHomeStatus === 'estimating'}
                    key={option.mode}
                    onPress={() => void selectGoHomeTransportMode(option.mode)}
                    style={[
                      styles.goHomeModeButton,
                      selected && styles.goHomeModeButtonSelected,
                    ]}>
                    <Ionicons
                      color={selected ? '#f7fbff' : '#9fb5d9'}
                      name={option.icon}
                      size={23}
                    />
                    <Text
                      style={[
                        styles.goHomeModeButtonText,
                        selected && styles.goHomeModeButtonTextSelected,
                      ]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable style={styles.secondaryActionButton} onPress={confirmHomeLocationChange}>
              <Text style={styles.secondaryActionText}>
                {homeLocation ? 'Modifica casa' : 'Imposta casa'}
              </Text>
            </Pressable>
            <Pressable
              disabled={goHomeStatus === 'estimating'}
              style={[styles.goHomeStartButton, goHomeStatus === 'estimating' && styles.disabledButton]}
              onPress={startGoHome}>
              <Text style={styles.goHomeStartText}>{goHomeStatus === 'estimating' ? 'Calcolo...' : 'Avvia Torno a casa'}</Text>
            </Pressable>
            {goHomeError && goHomeErrorAction ? (
              <View>
                <Text style={styles.goHomeNote}>{goHomeError}</Text>
                <Pressable
                  style={styles.secondaryActionButton}
                  onPress={() =>
                    void (goHomeErrorAction === 'location-settings'
                      ? openGoHomeLocationSettings()
                      : startGoHome())
                  }>
                  <Text style={styles.secondaryActionText}>
                    {goHomeErrorAction === 'location-settings'
                      ? 'Apri impostazioni'
                      : 'Riprova'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
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

      <Modal visible={drawerVisible} transparent animationType="fade" onRequestClose={closeDrawer}>
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerScrim} onPress={closeDrawer} />
          <SafeAreaView style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerBrand}>
                <View style={styles.drawerBrandIcon}>
                  <Ionicons color="#45B7FF" name="link-outline" size={22} />
                </View>
                <View style={styles.drawerBrandCopy}>
                  <Text style={styles.drawerTitle}>SafeMeLink</Text>
                  <View style={styles.drawerUserStatus}>
                    <View
                      style={[
                        styles.drawerStatusDot,
                        session && !isOffline
                          ? styles.drawerStatusOnline
                          : styles.drawerStatusOffline,
                      ]}
                    />
                    <Text numberOfLines={1} style={styles.drawerUserText}>
                      {session
                        ? `${session.user.email ?? 'Account SafeMeLink'}${isOffline ? ' · Offline' : ''}`
                        : 'Utente non autenticato'}
                    </Text>
                  </View>
                </View>
              </View>
              <Pressable style={styles.drawerClose} onPress={closeDrawer}>
                <Ionicons color="#A8B5D1" name="close-outline" size={24} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.drawerContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              overScrollMode="always"
              showsVerticalScrollIndicator={false}
              style={styles.drawerScroll}>
            <Text style={styles.drawerSectionLabel}>EMERGENZA</Text>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('home')}>
              <Ionicons color="#FF607A" name="alert-circle-outline" size={20} />
              <Text style={styles.drawerItemText}>SOS</Text>
            </Pressable>
            <Pressable
              style={styles.drawerItem}
              onPress={() => navigateFromDrawer('/(tabs)/contacts' as unknown as Href)}>
              <Ionicons color="#45B7FF" name="people-outline" size={20} />
              <Text style={styles.drawerItemText}>Contatti fidati</Text>
            </Pressable>
            <View style={styles.drawerSeparator} />
            <Text style={styles.drawerSectionLabel}>SICUREZZA PREVENTIVA</Text>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('checkpoint')}>
              <Ionicons color="#45B7FF" name="checkmark-circle-outline" size={20} />
              <Text style={styles.drawerItemText}>Checkpoint</Text>
            </Pressable>
            <Pressable style={styles.drawerItem} onPress={() => openPanel('goHome')}>
              <Ionicons color="#7868FF" name="navigate-outline" size={20} />
              <Text style={styles.drawerItemText}>Torno a casa</Text>
            </Pressable>
            <Pressable
              style={styles.drawerItem}
              onPress={() => navigateFromDrawer('/voice-protection' as unknown as Href)}>
              <Ionicons color="#A78BFA" name="mic-outline" size={20} />
              <Text style={styles.drawerItemText}>Protezione Vocale</Text>
            </Pressable>

            <View style={styles.drawerSeparator} />
            <Text style={styles.drawerSectionLabel}>COMMUNITY</Text>
            <Pressable
              style={styles.drawerItem}
              onPress={() => navigateFromDrawer('/radar' as unknown as Href)}>
              <Ionicons color="#45B7FF" name="people-circle-outline" size={20} />
              <Text style={styles.drawerItemText}>Rete SafeMeLink</Text>
            </Pressable>
            <View style={styles.drawerItemDisabled}>
              <View style={styles.drawerDisabledCopy}>
                <Ionicons color="#687898" name="shield-checkmark-outline" size={20} />
                <Text style={styles.drawerItemDisabledText}>Guardian</Text>
              </View>
              <Text style={styles.drawerBadge}>In arrivo</Text>
            </View>
            <View style={styles.drawerItemDisabled}>
              <View style={styles.drawerDisabledCopy}>
                <Ionicons color="#687898" name="location-outline" size={20} />
                <Text style={styles.drawerItemDisabledText}>Punti Safe</Text>
              </View>
              <Text style={styles.drawerBadge}>In arrivo</Text>
            </View>

            <View style={styles.drawerSeparator} />
            <Text style={styles.drawerSectionLabel}>ACCOUNT</Text>
            <Pressable
              style={styles.drawerItem}
              onPress={() => navigateFromDrawer('/emergency-profile' as unknown as Href)}>
              <Ionicons color="#A78BFA" name="person-circle-outline" size={20} />
              <Text style={styles.drawerItemText}>Profilo</Text>
            </Pressable>
            {!session ? (
              <Pressable
                style={styles.drawerItem}
                onPress={() => navigateFromDrawer('/login' as unknown as Href)}>
                <Ionicons color="#45B7FF" name="log-in-outline" size={20} />
                <Text style={styles.drawerItemText}>Accesso</Text>
              </Pressable>
            ) : (
              <Pressable
                disabled={isSubmitting}
                style={styles.drawerItem}
                onPress={() => {
                  setDrawerVisible(false);
                  void logout();
                }}>
                <Ionicons color="#FF8BA1" name="log-out-outline" size={20} />
                <Text style={styles.drawerItemText}>Disconnessione</Text>
              </Pressable>
            )}
            <View style={styles.drawerItemDisabled}>
              <View style={styles.drawerDisabledCopy}>
                <Ionicons color="#687898" name="settings-outline" size={20} />
                <Text style={styles.drawerItemDisabledText}>Impostazioni</Text>
              </View>
              <Text style={styles.drawerBadge}>In arrivo</Text>
            </View>
            </ScrollView>
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
  container: {
    flexGrow: 1,
    padding: 18,
    paddingBottom: 42,
    paddingTop: 14,
  },
  header: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 20, 48, 0.68)',
    borderColor: 'rgba(124, 145, 255, 0.2)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    padding: 10,
    shadowColor: '#7868FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  topTitleWrap: {
    alignItems: 'center',
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(69, 183, 255, 0.12)',
    borderColor: 'rgba(69, 183, 255, 0.25)',
    borderRadius: 14,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonGhost: {
    height: 44,
    width: 44,
  },
  appName: {
    color: '#F7FAFF',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: '#A8B5D1',
    fontSize: 12,
    marginTop: 2,
  },
  homePanel: {
    alignItems: 'center',
  },
  logoStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    width: '100%',
  },
  logoGlow: {
    backgroundColor: '#7868FF',
    borderRadius: 140,
    height: 130,
    position: 'absolute',
    width: 230,
  },
  logo: {
    alignSelf: 'center',
    height: 166,
    maxWidth: 380,
    width: '100%',
  },
  contactsSummary: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 20, 48, 0.72)',
    borderColor: 'rgba(69, 183, 255, 0.2)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    padding: 17,
    shadowColor: '#45B7FF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    width: '100%',
  },
  networkSummary: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 20, 48, 0.68)',
    borderColor: 'rgba(120, 104, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingHorizontal: 16,
    paddingVertical: 13,
    width: '100%',
  },
  networkSummaryCopy: {
    gap: 3,
  },
  networkSummaryValue: {
    color: '#F7FAFF',
    fontSize: 15,
    fontWeight: '900',
  },
  networkToggle: {
    alignItems: 'center',
    borderColor: 'rgba(69, 183, 255, 0.45)',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 12,
  },
  networkToggleActive: {
    backgroundColor: 'rgba(53, 228, 135, 0.12)',
    borderColor: 'rgba(53, 228, 135, 0.5)',
  },
  networkToggleText: {
    color: '#45B7FF',
    fontSize: 12,
    fontWeight: '900',
  },
  networkToggleTextActive: {
    color: '#35E487',
  },
  summaryLabel: {
    color: '#A8B5D1',
    fontSize: 13,
  },
  summaryValue: {
    color: '#F7FAFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  manageContactsButton: {
    backgroundColor: 'rgba(69, 183, 255, 0.14)',
    borderColor: 'rgba(69, 183, 255, 0.32)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  manageContactsText: {
    color: '#45B7FF',
    fontWeight: '800',
  },
  sosPanel: {
    alignItems: 'center',
    marginBottom: 28,
  },
  sosStage: {
    alignItems: 'center',
    height: 188,
    justifyContent: 'center',
    width: 188,
  },
  sosGlow: {
    backgroundColor: '#FF3B5C',
    borderColor: 'rgba(255, 143, 179, 0.7)',
    borderRadius: 94,
    borderWidth: 2,
    elevation: 12,
    height: 188,
    position: 'absolute',
    shadowColor: '#FF3B5C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.82,
    shadowRadius: 42,
    width: 188,
  },
  sosOuterRing: {
    borderColor: 'rgba(255, 113, 145, 0.78)',
    borderRadius: 86,
    borderWidth: 2,
    height: 172,
    position: 'absolute',
    width: 172,
  },
  sosInnerRing: {
    borderColor: 'rgba(255, 255, 255, 0.62)',
    borderRadius: 74,
    borderWidth: 2,
    height: 148,
    position: 'absolute',
    width: 148,
  },
  sosButton: {
    alignItems: 'center',
    backgroundColor: '#FF244D',
    borderColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 64,
    borderWidth: 3,
    elevation: 18,
    height: 128,
    justifyContent: 'center',
    shadowColor: '#FF3B5C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 36,
    width: 128,
  },
  sosButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  sosButtonText: {
    color: '#F7FAFF',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 2,
  },
  helperText: {
    color: '#A8B5D1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  statusDock: {
    backgroundColor: 'rgba(12, 20, 48, 0.7)',
    borderColor: 'rgba(120, 104, 255, 0.22)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    marginTop: 22,
    padding: 16,
    shadowColor: '#7868FF',
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
    backgroundColor: 'rgba(42, 10, 28, 0.9)',
    borderColor: 'rgba(255, 59, 92, 0.55)',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 28,
    padding: 24,
    shadowColor: '#FF3B5C',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  countdownLabel: {
    color: '#F7FAFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  countdownValue: {
    color: '#FF607A',
    fontSize: 76,
    fontWeight: '900',
    textAlign: 'center',
  },
  countdownText: {
    color: '#D8C7D2',
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 14,
    borderWidth: 1,
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
    backgroundColor: '#FF3B5C',
    borderRadius: 14,
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
    backgroundColor: 'rgba(82, 12, 32, 0.94)',
    borderColor: '#FF3B5C',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 28,
    padding: 24,
    shadowColor: '#FF3B5C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 26,
  },
  emergencyLabel: {
    color: '#F7FAFF',
    fontSize: 30,
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
  pushDeliveryNotice: {
    backgroundColor: 'rgba(5, 8, 22, 0.58)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 14,
    padding: 12,
  },
  pushDeliveryNoticeText: {
    color: '#F7FAFF',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  pushDeliveryNoticeDismiss: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pushDeliveryNoticeDismissText: {
    color: '#A8DFFF',
    fontSize: 13,
    fontWeight: '800',
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
  checkpointDurationCard: {
    gap: 14,
  },
  checkpointPrompt: {
    color: '#a9d7ff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  checkpointDurationSelector: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  checkpointDurationColumn: {
    alignItems: 'center',
    minWidth: 112,
  },
  checkpointStepButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 64,
  },
  checkpointDurationValue: {
    color: '#f7fbff',
    fontSize: 52,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    lineHeight: 58,
  },
  checkpointDurationUnit: {
    color: '#7f97bd',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  checkpointDurationSeparator: {
    color: '#6384b8',
    fontSize: 42,
    fontWeight: '700',
    marginBottom: 20,
  },
  checkpointMinuteSteps: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  checkpointCompactButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(88, 166, 255, 0.1)',
    borderColor: 'rgba(88, 166, 255, 0.25)',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 96,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  checkpointCompactButtonText: {
    color: '#a9d7ff',
    fontWeight: '800',
  },
  checkpointDurationSummary: {
    color: '#d7e9ff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  checkpointStartButton: {
    alignItems: 'center',
    backgroundColor: '#426ef0',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  checkpointStartButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  checkpointStartButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  goHomeActiveMode: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(69, 183, 255, 0.12)',
    borderColor: 'rgba(69, 183, 255, 0.3)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  goHomeActiveModeText: {
    color: '#d9efff',
    fontSize: 14,
    fontWeight: '800',
  },
  goHomeModeTitle: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  goHomeModeOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  goHomeModeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 24, 52, 0.76)',
    borderColor: 'rgba(159, 181, 217, 0.24)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    minHeight: 70,
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  goHomeModeButtonSelected: {
    backgroundColor: 'rgba(69, 183, 255, 0.2)',
    borderColor: '#45b7ff',
  },
  goHomeModeButtonText: {
    color: '#9fb5d9',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  goHomeModeButtonTextSelected: {
    color: '#f7fbff',
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
    backgroundColor: 'rgba(7, 12, 32, 0.98)',
    borderRightColor: 'rgba(120, 104, 255, 0.28)',
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 18,
    position: 'absolute',
    top: 0,
    maxWidth: 340,
    minHeight: 0,
    width: '86%',
  },
  drawerContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  drawerScroll: {
    flex: 1,
    minHeight: 0,
  },
  drawerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  drawerBrand: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 11,
  },
  drawerBrandIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(69, 183, 255, 0.12)',
    borderColor: 'rgba(69, 183, 255, 0.25)',
    borderRadius: 15,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  drawerBrandCopy: {
    flex: 1,
  },
  drawerTitle: {
    color: '#F7FAFF',
    fontSize: 22,
    fontWeight: '900',
  },
  drawerUserStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 3,
  },
  drawerStatusDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  drawerStatusOnline: {
    backgroundColor: '#45D6A5',
  },
  drawerStatusOffline: {
    backgroundColor: '#7D8AA7',
  },
  drawerUserText: {
    color: '#A8B5D1',
    flex: 1,
    fontSize: 11,
  },
  drawerClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  drawerSectionLabel: {
    color: '#8492B3',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 8,
    marginTop: 8,
  },
  drawerItem: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderColor: 'rgba(167, 139, 250, 0.12)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  drawerItemText: {
    color: '#F7FAFF',
    fontSize: 15,
    fontWeight: '800',
  },
  drawerItemDisabled: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
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
    color: '#71809F',
    fontSize: 15,
    fontWeight: '700',
  },
  drawerBadge: {
    color: '#7E8BA6',
    fontSize: 12,
    fontWeight: '800',
  },
  drawerDisabledCopy: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  drawerSeparator: {
    backgroundColor: 'rgba(167, 139, 250, 0.14)',
    height: 1,
    marginVertical: 5,
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
