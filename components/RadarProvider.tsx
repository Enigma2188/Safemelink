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
import { RadarRequestTimeoutError } from '@/backend/repositories/RadarRepository';
import {
  LocationPermissionError,
  LocationService,
  LocationTimeoutError,
  LocationUnavailableError,
} from '@/services/LocationService';
import {
  RadarService,
  canParticipateInRadar,
  type NearbyUser,
  type RadarPreferences,
} from '@/services/RadarService';

export type RadarViewStatus =
  | 'loading_preferences'
  | 'off'
  | 'visibility_required'
  | 'searching'
  | 'ready'
  | 'empty'
  | 'permission_required'
  | 'position_unavailable'
  | 'accuracy_insufficient'
  | 'unauthenticated'
  | 'error';

type RadarPreferenceChanges = Partial<Omit<RadarPreferences, 'updatedAt'>>;
type RadarPreferenceSave = {
  userId: string;
  promise: Promise<RadarPreferences>;
};
type RadarPresenceDeactivation = {
  userId: string;
  promise: Promise<void>;
};

type RadarContextValue = {
  users: NearbyUser[];
  status: RadarViewStatus;
  error: string | null;
  preferences: RadarPreferences | null;
  isSavingPreferences: boolean;
  setRadarScreenActive: (active: boolean) => void;
  refreshRadar: () => void;
  updatePreferences: (changes: RadarPreferenceChanges) => Promise<RadarPreferences>;
};

const RadarContext = createContext<RadarContextValue | undefined>(undefined);
const RADAR_PRESENCE_REFRESH_MS = 4 * 60 * 1_000;
const RADAR_PREFERENCES_MAX_RETRIES = 5;

const clearRadarState = (
  setUsers: (users: NearbyUser[]) => void,
  setError: (error: string | null) => void,
) => {
  setUsers([]);
  setError(null);
};

const areNearbyUsersEqual = (current: NearbyUser[], next: NearbyUser[]) =>
  current.length === next.length &&
  current.every((user, index) => {
    const nextUser = next[index];
    return (
      nextUser !== undefined &&
      user.anonymousId === nextUser.anonymousId &&
      user.publicNickname === nextUser.publicNickname &&
      user.distanceMeters === nextUser.distanceMeters &&
      user.category === nextUser.category &&
      user.recentlyActive === nextUser.recentlyActive
    );
  });

export function RadarProvider({ children }: PropsWithChildren) {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const [users, setUsers] = useState<NearbyUser[]>([]);
  const [status, setStatus] = useState<RadarViewStatus>('loading_preferences');
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<RadarPreferences | null>(null);
  const [preferencesUserId, setPreferencesUserId] = useState<string | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isRadarScreenActive, setIsRadarScreenActive] = useState(false);
  const preferenceSaveRef = useRef<RadarPreferenceSave | null>(null);
  const deactivationInFlightRef = useRef<RadarPresenceDeactivation | null>(null);
  const presenceMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeUserIdRef = useRef<string | null>(userId);
  const manualRefreshRef = useRef<() => void>(() => undefined);
  const radarEnabled = preferences?.radarEnabled ?? false;
  const participationEnabled = canParticipateInRadar(preferences);
  activeUserIdRef.current = userId;

  const refreshRadar = useCallback(() => {
    manualRefreshRef.current();
  }, []);

  const enqueuePresenceMutation = useCallback((
    expectedUserId: string | null,
    operation: () => Promise<unknown>,
  ) => {
    const request = presenceMutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!expectedUserId || activeUserIdRef.current !== expectedUserId) {
          console.info('[SafeMeLink Radar] Operazione presenza obsoleta ignorata.');
          return;
        }

        await operation();
      });
    presenceMutationQueueRef.current = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }, []);

  const deactivate = useCallback((expectedUserId: string) => {
    if (deactivationInFlightRef.current?.userId === expectedUserId) {
      return deactivationInFlightRef.current.promise;
    }

    const request = enqueuePresenceMutation(
      expectedUserId,
      () => RadarService.deactivatePresence(),
    )
      .catch((deactivationError: unknown) => {
        console.warn('[SafeMeLink Radar] Disattivazione presenza non riuscita.', {
          category: deactivationError instanceof Error ? deactivationError.name : 'unknown',
        });
      })
      .finally(() => {
        if (deactivationInFlightRef.current?.promise === request) {
          deactivationInFlightRef.current = null;
        }
      });
    deactivationInFlightRef.current = {
      userId: expectedUserId,
      promise: request,
    };
    return request;
  }, [enqueuePresenceMutation]);

  useEffect(() => {
    let isCurrent = true;
    let preferencesLoaded = false;
    let requestInFlight = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    if (isInitializing) {
      return () => {
        isCurrent = false;
        clearRetryTimer();
      };
    }

    if (!userId) {
      setPreferences(null);
      setPreferencesUserId(null);
      setIsSavingPreferences(false);
      clearRadarState(setUsers, setError);
      setStatus('unauthenticated');
      return () => {
        isCurrent = false;
        clearRetryTimer();
      };
    }

    const schedulePreferencesRetry = () => {
      if (
        !isCurrent ||
        retryTimer ||
        retryAttempt >= RADAR_PREFERENCES_MAX_RETRIES ||
        AppState.currentState !== 'active'
      ) {
        return;
      }

      const delayMs = Math.min(60_000, 5_000 * 2 ** retryAttempt);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void loadPreferences();
      }, delayMs);
    };

    const loadPreferences = async () => {
      if (!isCurrent || requestInFlight || preferencesLoaded) {
        return;
      }

      requestInFlight = true;
      try {
        const storedPreferences = await RadarService.getPreferences();
        if (isCurrent) {
          preferencesLoaded = true;
          clearRetryTimer();
          console.info('[SafeMeLink Radar] RADAR_PREFS_ENABLED', {
            enabled: storedPreferences.radarEnabled,
          });
          console.info('[SafeMeLink Radar] RADAR_VISIBILITY_ENABLED', {
            enabled: storedPreferences.visibleToNearby,
          });
          setPreferences(storedPreferences);
          setPreferencesUserId(userId);
          setStatus(
            storedPreferences.radarEnabled
              ? storedPreferences.visibleToNearby
                ? 'searching'
                : 'visibility_required'
              : 'off',
          );
          setError(null);
        }
      } catch (loadError: unknown) {
        if (isCurrent) {
          setStatus('error');
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Impossibile caricare le preferenze Radar.',
          );
          schedulePreferencesRetry();
        }
      } finally {
        requestInFlight = false;
      }
    };

    setPreferences(null);
    setPreferencesUserId(null);
    setIsSavingPreferences(false);
    clearRadarState(setUsers, setError);
    setStatus('loading_preferences');

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || preferencesLoaded) {
        clearRetryTimer();
        return;
      }

      retryAttempt = 0;
      void loadPreferences();
    });

    void loadPreferences();

    return () => {
      isCurrent = false;
      clearRetryTimer();
      appStateSubscription.remove();
    };
  }, [isInitializing, userId]);

  useEffect(() => {
    let isCurrent = true;
    let appState: AppStateStatus = AppState.currentState;
    let attemptInFlight = false;
    let attemptGeneration = 0;
    let presenceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const canPublishPresence = Boolean(
      userId &&
        preferencesUserId === userId &&
        participationEnabled,
    );

    const clearPresenceRefresh = () => {
      if (presenceRefreshTimer) {
        clearTimeout(presenceRefreshTimer);
        presenceRefreshTimer = null;
      }
    };

    const isAttemptCurrent = (generation: number) =>
      isCurrent &&
      generation === attemptGeneration &&
      appState === 'active' &&
      canPublishPresence &&
      activeUserIdRef.current === userId;

    const schedulePresenceRefresh = () => {
      clearPresenceRefresh();
      if (!isCurrent || appState !== 'active' || !canPublishPresence) {
        return;
      }

      presenceRefreshTimer = setTimeout(() => {
        presenceRefreshTimer = null;
        void runOneShotRadar();
      }, RADAR_PRESENCE_REFRESH_MS);
    };

    const runOneShotRadar = async () => {
      if (
        attemptInFlight ||
        !isCurrent ||
        appState !== 'active' ||
        !canPublishPresence ||
        activeUserIdRef.current !== userId
      ) {
        return;
      }

      clearPresenceRefresh();
      attemptInFlight = true;
      const generation = ++attemptGeneration;
      let stage: 'location' | 'presence' | 'search' = 'location';
      if (isRadarScreenActive) {
        setStatus('searching');
        setError(null);
        console.info('[SafeMeLink Radar] RADAR_SEARCH_STARTED');
      } else {
        console.info('[SafeMeLink Radar] RADAR_PRESENCE_REFRESH_STARTED');
      }

      try {
        const location = await LocationService.getCurrentLocation({
          timeoutMs: 15_000,
          accuracy: 'balanced',
        });
        if (!isAttemptCurrent(generation)) {
          return;
        }

        console.info('[SafeMeLink Radar] RADAR_GPS_ACQUIRED');
        if (!RadarService.isLocationAccurateEnough(location)) {
          console.warn('[SafeMeLink Radar] RADAR_GPS_REJECTED_ACCURACY');
          if (isRadarScreenActive) {
            setUsers([]);
            setStatus('accuracy_insufficient');
          }
          return;
        }

        stage = 'presence';
        await enqueuePresenceMutation(
          userId,
          () => RadarService.publishPresence(location),
        );
        if (!isAttemptCurrent(generation)) {
          return;
        }
        console.info('[SafeMeLink Radar] RADAR_PRESENCE_PUBLISHED');

        if (!isRadarScreenActive) {
          return;
        }

        stage = 'search';
        const nearbyUsers = await RadarService.findNearbyUsers();
        if (!isAttemptCurrent(generation)) {
          return;
        }

        setUsers((currentUsers) =>
          areNearbyUsersEqual(currentUsers, nearbyUsers) ? currentUsers : nearbyUsers,
        );
        setStatus(nearbyUsers.length > 0 ? 'ready' : 'empty');
        setError(null);
        console.info('[SafeMeLink Radar] RADAR_SEARCH_RESULT_COUNT', {
          nearbyUserCount: nearbyUsers.length,
        });
      } catch (attemptError: unknown) {
        if (!isAttemptCurrent(generation)) {
          return;
        }

        if (isRadarScreenActive) {
          setUsers([]);
        }
        console.warn(
          stage === 'presence'
            ? '[SafeMeLink Radar] RADAR_PRESENCE_PUBLISH_FAILED'
            : '[SafeMeLink Radar] RADAR_SEARCH_FAILED',
          {
            stage,
            category: attemptError instanceof Error ? attemptError.name : 'unknown',
          },
        );
        if (!isRadarScreenActive) {
          return;
        }
        if (attemptError instanceof LocationPermissionError) {
          setStatus('permission_required');
          setError(null);
        } else if (
          attemptError instanceof LocationTimeoutError ||
          attemptError instanceof LocationUnavailableError
        ) {
          setStatus('position_unavailable');
          setError(attemptError.message);
        } else {
          setStatus('error');
          setError(
            attemptError instanceof BackendError ||
              attemptError instanceof RadarRequestTimeoutError
              ? attemptError.message
              : 'Errore temporaneo durante la ricerca Radar.',
          );
        }
      } finally {
        attemptInFlight = false;
        schedulePresenceRefresh();

        if (
          isCurrent &&
          generation !== attemptGeneration &&
          appState === 'active' &&
          canPublishPresence &&
          activeUserIdRef.current === userId
        ) {
          void runOneShotRadar();
        }
      }
    };

    manualRefreshRef.current = () => {
      void runOneShotRadar();
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      attemptGeneration += 1;
      clearPresenceRefresh();

      if (nextState === 'active') {
        void runOneShotRadar();
      }
    });

    if (userId && preferencesUserId !== userId) {
      clearRadarState(setUsers, setError);
      setStatus('loading_preferences');
    } else if (!participationEnabled) {
      clearRadarState(setUsers, setError);
      setStatus(userId ? (radarEnabled ? 'visibility_required' : 'off') : 'unauthenticated');

      if (userId && preferencesUserId === userId && preferences) {
        void deactivate(userId);
      }
    } else if (appState === 'active') {
      void runOneShotRadar();
    }

    return () => {
      isCurrent = false;
      attemptGeneration += 1;
      attemptInFlight = false;
      clearPresenceRefresh();
      manualRefreshRef.current = () => undefined;
      appStateSubscription.remove();
    };
  }, [
    deactivate,
    enqueuePresenceMutation,
    participationEnabled,
    preferences,
    preferencesUserId,
    radarEnabled,
    isRadarScreenActive,
    userId,
  ]);

  const updatePreferences = useCallback(
    async (changes: RadarPreferenceChanges) => {
      if (!userId || !preferences || preferencesUserId !== userId) {
        throw new Error('Preferenze Radar non disponibili.');
      }

      if (preferenceSaveRef.current?.userId === userId) {
        return preferenceSaveRef.current.promise;
      }

      const request = RadarService.updatePreferences({
        radarEnabled: changes.radarEnabled ?? preferences.radarEnabled,
        visibleToNearby: changes.visibleToNearby ?? preferences.visibleToNearby,
        showNickname: changes.showNickname ?? preferences.showNickname,
        publicNickname:
          changes.publicNickname === undefined
            ? preferences.publicNickname
            : changes.publicNickname,
      });

      const pendingSave = { userId, promise: request };
      preferenceSaveRef.current = pendingSave;
      setIsSavingPreferences(true);

      try {
        const savedPreferences = await request;

        if (activeUserIdRef.current === userId) {
          console.info('[SafeMeLink Radar] RADAR_PREFS_ENABLED', {
            enabled: savedPreferences.radarEnabled,
          });
          console.info('[SafeMeLink Radar] RADAR_VISIBILITY_ENABLED', {
            enabled: savedPreferences.visibleToNearby,
          });
          setPreferences(savedPreferences);
          setError(null);
        }

        return savedPreferences;
      } catch (saveError: unknown) {
        if (activeUserIdRef.current === userId) {
          setError(
            saveError instanceof Error ? saveError.message : 'Salvataggio Radar non riuscito.',
          );
        }

        throw saveError;
      } finally {
        if (preferenceSaveRef.current === pendingSave) {
          preferenceSaveRef.current = null;
        }

        if (activeUserIdRef.current === userId) {
          setIsSavingPreferences(false);
        }
      }
    },
    [preferences, preferencesUserId, userId],
  );

  const value = useMemo<RadarContextValue>(
    () => ({
      users,
      status,
      error,
      preferences,
      isSavingPreferences,
      refreshRadar,
      setRadarScreenActive: setIsRadarScreenActive,
      updatePreferences,
    }),
    [error, isSavingPreferences, preferences, refreshRadar, status, updatePreferences, users],
  );

  return <RadarContext.Provider value={value}>{children}</RadarContext.Provider>;
}

export function useRadar() {
  const context = useContext(RadarContext);

  if (!context) {
    throw new Error('useRadar deve essere usato all’interno di RadarProvider.');
  }

  return context;
}
