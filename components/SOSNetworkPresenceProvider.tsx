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
import { SOSNetworkPresenceRepository } from '@/backend/repositories/SOSNetworkPresenceRepository';
import {
  SOSNetworkBackgroundUnavailableError,
  SOSNetworkPermissionError,
  SOSNetworkPresenceService,
} from '@/services/SOSNetworkPresenceService';

export type SOSNetworkAvailabilityStatus =
  | 'loading'
  | 'off'
  | 'available'
  | 'permission_required'
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

    const scheduleRefresh = () => {
      clearRefresh();
      if (!isOperationCurrent()) {
        return;
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshPresence();
      }, FOREGROUND_REFRESH_MS);
    };

    const refreshPresence = async () => {
      if (!expectedUserId || operationInFlight || !isOperationCurrent()) {
        return;
      }
      operationInFlight = true;
      try {
        await SOSNetworkPresenceService.startBackgroundUpdates();
        const published = await SOSNetworkPresenceService.publishForegroundPresence(
          expectedUserId,
        );
        if (isOperationCurrent()) {
          setStatus('available');
          setMessage(
            published
              ? 'Disponibile per ricevere richieste SOS nelle vicinanze.'
              : 'Posizione poco precisa: SafeMeLink riproverà più tardi.',
          );
        }
      } catch (refreshError: unknown) {
        if (isOperationCurrent()) {
          const permissionError = refreshError instanceof SOSNetworkPermissionError;
          setStatus(permissionError ? 'permission_required' : 'error');
          setMessage(userMessageForError(refreshError));
          console.warn('[SafeMeLink Rete SOS] Disponibilità non aggiornata.', {
            category: refreshError instanceof Error ? refreshError.name : 'unknown',
          });
        }
      } finally {
        operationInFlight = false;
        scheduleRefresh();
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
          await SOSNetworkPresenceService.requestPermissions();
          await SOSNetworkPresenceService.startBackgroundUpdates();
          try {
            await SOSNetworkPresenceRepository.updatePreference(true);
            const published = await SOSNetworkPresenceService.publishForegroundPresence(
              expectedUserId,
            );
            if (activeUserIdRef.current !== expectedUserId) {
              return;
            }
            setEnabledState(true);
            setLoadedUserId(expectedUserId);
            setStatus('available');
            setMessage(
              published
                ? 'Disponibile per ricevere richieste SOS nelle vicinanze.'
                : 'Rete SOS attiva. La posizione verrà aggiornata appena sarà più precisa.',
            );
          } catch (enableError) {
            await SOSNetworkPresenceService.stopBackgroundUpdates().catch(() => undefined);
            await SOSNetworkPresenceRepository.updatePreference(false).catch(() => undefined);
            throw enableError;
          }
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
            setStatus(saveError instanceof SOSNetworkPermissionError ? 'permission_required' : 'error');
            setMessage(userMessageForError(saveError));
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
