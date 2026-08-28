import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { BackendError } from '@/backend/errors/BackendError';
import {
  SOSNetworkPresenceRepository,
  SOSNetworkPresenceTimeoutError,
} from '@/backend/repositories/SOSNetworkPresenceRepository';
import {
  SOSNetworkBackgroundUnavailableError,
  SOSNetworkLocationServicesDisabledError,
  SOSNetworkLocationTimeoutError,
  SOSNetworkPermissionError,
  SOSNetworkPresenceService,
} from '@/services/SOSNetworkPresenceService';

export type SOSNetworkAvailabilityStatus =
  | 'loading'
  | 'off'
  | 'available'
  | 'foreground_permission_required'
  | 'background_permission_required'
  | 'notification_permission_required'
  | 'location_services_required'
  | 'offline'
  | 'error';

type SOSNetworkContextValue = {
  enabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  status: SOSNetworkAvailabilityStatus;
  message: string | null;
  setEnabled: (enabled: boolean) => Promise<void>;
};

const SOSNetworkContext = createContext<SOSNetworkContextValue | undefined>(undefined);
const FOREGROUND_REFRESH_MS = 10 * 60 * 1_000;

const userMessageForError = (error: unknown) => {
  if (error instanceof SOSNetworkPermissionError) {
    return error.message;
  }
  if (error instanceof SOSNetworkBackgroundUnavailableError) {
    return error.message;
  }
  if (
    error instanceof SOSNetworkLocationServicesDisabledError ||
    error instanceof SOSNetworkLocationTimeoutError ||
    error instanceof SOSNetworkPresenceTimeoutError ||
    error instanceof BackendError
  ) {
    return error.message;
  }
  return 'Disponibilità rete SOS temporaneamente non verificabile.';
};

export function SOSNetworkPresenceProvider({ children }: PropsWithChildren) {
  const { session, isInitializing, isOffline } = useAuth();
  const userId = session?.user.id ?? null;
  const [enabled, setEnabledState] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<SOSNetworkAvailabilityStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const generationRef = useRef(0);
  const activeUserIdRef = useRef(userId);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  activeUserIdRef.current = userId;

  useEffect(() => {
    const generation = ++generationRef.current;
    let isCurrent = true;

    setEnabledState(false);
    setLoadedUserId(null);
    setMessage(null);

    if (isInitializing) {
      setIsLoading(true);
      setStatus('loading');
      return () => {
        isCurrent = false;
      };
    }

    if (!userId) {
      setIsLoading(false);
      setStatus('off');
      void SOSNetworkPresenceService.stopBackgroundUpdates().catch(() => undefined);
      return () => {
        isCurrent = false;
      };
    }

    if (isOffline) {
      setIsLoading(false);
      setStatus('offline');
      setMessage('Connettiti per verificare la disponibilità alla rete SOS.');
      return () => {
        isCurrent = false;
      };
    }

    setIsLoading(true);
    setStatus('loading');
    void SOSNetworkPresenceRepository.getPreference()
      .then((storedEnabled) => {
        if (!isCurrent || generation !== generationRef.current) {
          return;
        }
        setEnabledState(storedEnabled);
        setLoadedUserId(userId);
        setStatus(storedEnabled ? 'available' : 'off');
        console.info('[SafeMeLink Rete SOS] SOS_NETWORK_PREFERENCE_LOADED', {
          enabled: storedEnabled,
        });
      })
      .catch((loadError: unknown) => {
        if (!isCurrent || generation !== generationRef.current) {
          return;
        }
        setStatus('error');
        setMessage(userMessageForError(loadError));
      })
      .finally(() => {
        if (isCurrent && generation === generationRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
      generationRef.current += 1;
    };
  }, [isInitializing, isOffline, userId]);

  useEffect(() => {
    let isCurrent = true;
    let appState: AppStateStatus = AppState.currentState;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let operationInFlight = false;
    let consecutiveFailures = 0;
    const expectedUserId = userId;
    const shouldRun = Boolean(
      expectedUserId && loadedUserId === expectedUserId && enabled && !isOffline,
    );

    const clearRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const isOperationCurrent = () =>
      isCurrent &&
      appState === 'active' &&
      shouldRun &&
      activeUserIdRef.current === expectedUserId;

    const scheduleRefresh = (delayMs = FOREGROUND_REFRESH_MS) => {
      clearRefresh();
      if (!isOperationCurrent()) {
        return;
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshPresence();
      }, delayMs);
    };

    const refreshPresence = async () => {
      if (!expectedUserId || operationInFlight || !isOperationCurrent()) {
        return;
      }
      operationInFlight = true;
      let backgroundError: unknown = null;
      try {
        try {
          await SOSNetworkPresenceService.startBackgroundUpdates();
        } catch (startError: unknown) {
          backgroundError = startError;
        }
        const published = await SOSNetworkPresenceService.publishForegroundPresence(
          expectedUserId,
        );
        if (isOperationCurrent()) {
          const backgroundPermissionMissing =
            backgroundError instanceof SOSNetworkPermissionError;
          const notificationPermission =
            await SOSNetworkPresenceService.getNotificationPermissionState();
          if (!isOperationCurrent()) {
            return;
          }
          consecutiveFailures = published ? 0 : consecutiveFailures + 1;
          setStatus(
            backgroundPermissionMissing
              ? 'background_permission_required'
              : !notificationPermission.granted
                ? 'notification_permission_required'
                : backgroundError
                  ? 'error'
                  : 'available',
          );
          setMessage(
            backgroundPermissionMissing
              ? 'Presenza attiva mentre usi SafeMeLink. Consenti la posizione sempre per ricevere SOS anche in background.'
                : !notificationPermission.granted
                  ? 'Rete SOS attiva. Autorizza le notifiche per ricevere le richieste di aiuto.'
                : backgroundError
                ? 'Presenza foreground attiva. Aggiornamento background temporaneamente non disponibile.'
                : published
              ? 'Disponibile per ricevere richieste SOS nelle vicinanze.'
              : 'Posizione poco precisa: SafeMeLink riproverà più tardi.',
          );
        }
      } catch (refreshError: unknown) {
        consecutiveFailures += 1;
        if (isOperationCurrent()) {
          setStatus(
            refreshError instanceof SOSNetworkLocationServicesDisabledError
              ? 'location_services_required'
              : refreshError instanceof SOSNetworkPermissionError
                ? refreshError.permission === 'foreground'
                  ? 'foreground_permission_required'
                  : 'background_permission_required'
                : 'error',
          );
          setMessage(userMessageForError(refreshError));
          console.warn('[SafeMeLink Rete SOS] Disponibilità non aggiornata.', {
            category: refreshError instanceof Error ? refreshError.name : 'unknown',
          });
        }
      } finally {
        operationInFlight = false;
        const retryDelay =
          consecutiveFailures > 0 && consecutiveFailures <= 3
            ? 30_000 * 2 ** (consecutiveFailures - 1)
            : FOREGROUND_REFRESH_MS;
        scheduleRefresh(retryDelay);
      }
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      clearRefresh();
      if (nextState === 'active') {
        void refreshPresence();
      }
    });

    if (shouldRun && appState === 'active') {
      void refreshPresence();
    } else if (!shouldRun) {
      clearRefresh();
      void SOSNetworkPresenceService.stopBackgroundUpdates().catch(() => undefined);
    }

    return () => {
      isCurrent = false;
      clearRefresh();
      subscription.remove();
    };
  }, [enabled, isOffline, loadedUserId, userId]);

  const setEnabled = useCallback(
    (nextEnabled: boolean) => {
      if (saveInFlightRef.current) {
        return saveInFlightRef.current;
      }
      if (!userId || isOffline) {
        return Promise.reject(new Error('Connessione e sessione necessarie.'));
      }

      const expectedUserId = userId;
      const request = (async () => {
        setIsSaving(true);
        setMessage(null);

        if (nextEnabled) {
          console.info('[SafeMeLink Rete SOS] SOS_NETWORK_OPT_IN_REQUESTED');
          const permissionState = await SOSNetworkPresenceService.requestPermissions();
          await SOSNetworkPresenceRepository.updatePreference(true);
          console.info('[SafeMeLink Rete SOS] SOS_NETWORK_OPT_IN_ENABLED');
          if (activeUserIdRef.current !== expectedUserId) {
            await SOSNetworkPresenceService.stopBackgroundUpdates().catch(() => undefined);
            return;
          }
          setEnabledState(true);
          setLoadedUserId(expectedUserId);

          let backgroundStarted = false;
          if (permissionState.backgroundGranted) {
            try {
              await SOSNetworkPresenceService.startBackgroundUpdates();
              backgroundStarted = true;
            } catch (startError: unknown) {
              console.warn('[SafeMeLink Rete SOS] Task background non avviato.', {
                category: startError instanceof Error ? startError.name : 'unknown',
              });
            }
          }
          const published = await SOSNetworkPresenceService.publishForegroundPresence(
            expectedUserId,
          );
          const notificationPermission =
            await SOSNetworkPresenceService.getNotificationPermissionState();
          if (activeUserIdRef.current !== expectedUserId) {
            return;
          }
          setStatus(
            !permissionState.backgroundGranted || !backgroundStarted
              ? 'background_permission_required'
              : !notificationPermission.granted
                ? 'notification_permission_required'
                : 'available',
          );
          setMessage(
            !permissionState.backgroundGranted
              ? 'Presenza attiva mentre usi SafeMeLink. Consenti la posizione sempre per ricevere SOS anche in background.'
              : !backgroundStarted
                ? 'Presenza foreground attiva. Aggiornamento background temporaneamente non disponibile.'
                : !notificationPermission.granted
                  ? 'Rete SOS attiva. Autorizza le notifiche per ricevere le richieste di aiuto.'
                : published
              ? 'Disponibile per ricevere richieste SOS nelle vicinanze.'
              : 'Rete SOS attiva. La posizione verrà aggiornata appena sarà più precisa.',
          );
        } else {
          generationRef.current += 1;
          let stopError: unknown = null;
          try {
            await SOSNetworkPresenceService.stopBackgroundUpdates();
          } catch (backgroundStopError: unknown) {
            stopError = backgroundStopError;
          }
          await SOSNetworkPresenceRepository.updatePreference(false);
          await SOSNetworkPresenceRepository.deactivatePresence();
          if (activeUserIdRef.current !== expectedUserId) {
            return;
          }
          setEnabledState(false);
          setLoadedUserId(expectedUserId);
          setStatus('off');
          setMessage('Disponibilità alla rete SOS disattivata.');
          if (stopError) {
            console.warn('[SafeMeLink Rete SOS] Arresto task non confermato.', {
              category: stopError instanceof Error ? stopError.name : 'unknown',
            });
          }
        }
      })()
        .catch((saveError: unknown) => {
          if (activeUserIdRef.current === expectedUserId) {
            setStatus(
              saveError instanceof SOSNetworkLocationServicesDisabledError
                ? 'location_services_required'
                : saveError instanceof SOSNetworkPermissionError
                  ? saveError.permission === 'foreground'
                    ? 'foreground_permission_required'
                    : 'background_permission_required'
                  : 'error',
            );
            setMessage(userMessageForError(saveError));
            console.warn('[SafeMeLink Rete SOS] SOS_NETWORK_OPT_IN_FAILURE', {
              category: saveError instanceof Error ? saveError.name : 'unknown',
            });
          }
          throw saveError;
        })
        .finally(() => {
          if (saveInFlightRef.current === request) {
            saveInFlightRef.current = null;
          }
          if (activeUserIdRef.current === expectedUserId) {
            setIsSaving(false);
          }
        });

      saveInFlightRef.current = request;
      return request;
    },
    [isOffline, userId],
  );

  const value = useMemo<SOSNetworkContextValue>(
    () => ({ enabled, isLoading, isSaving, message, setEnabled, status }),
    [enabled, isLoading, isSaving, message, setEnabled, status],
  );

  return <SOSNetworkContext.Provider value={value}>{children}</SOSNetworkContext.Provider>;
}

export function useSOSNetworkPresence() {
  const context = useContext(SOSNetworkContext);
  if (!context) {
    throw new Error('useSOSNetworkPresence deve essere usato nel relativo provider.');
  }
  return context;
}
