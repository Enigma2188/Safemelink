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
  const deactivationInFlightRef = useRef<Promise<void> | null>(null);
  const presenceMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeUserIdRef = useRef<string | null>(userId);
  const manualRefreshRef = useRef<() => void>(() => undefined);
  const radarEnabled = preferences?.radarEnabled ?? false;
  const participationEnabled = canParticipateInRadar(preferences);
  activeUserIdRef.current = userId;

  const refreshRadar = useCallback(() => {
    manualRefreshRef.current();
  }, []);

  const enqueuePresenceMutation = useCallback(<T,>(operation: () => Promise<T>) => {
    const request = presenceMutationQueueRef.current
      .catch(() => undefined)
      .then(operation);
    presenceMutationQueueRef.current = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }, []);

  const deactivate = useCallback(() => {
    if (deactivationInFlightRef.current) {
      return deactivationInFlightRef.current;
    }

    const request = enqueuePresenceMutation(() => RadarService.deactivatePresence())
      .catch((deactivationError: unknown) => {
        console.warn('[SafeMeLink Radar] Disattivazione presenza non riuscita.', {
          category: deactivationError instanceof Error ? deactivationError.name : 'unknown',
        });
      })
      .finally(() => {
        if (deactivationInFlightRef.current === request) {
          deactivationInFlightRef.current = null;
        }
      });
    deactivationInFlightRef.current = request;
    return request;
  }, [enqueuePresenceMutation]);

  useEffect(() => {
    let isCurrent = true;

    if (isInitializing) {
      return () => {
        isCurrent = false;
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
      };
    }

    setPreferences(null);
    setPreferencesUserId(null);
    setIsSavingPreferences(false);
    clearRadarState(setUsers, setError);
    setStatus('loading_preferences');
    void RadarService.getPreferences()
      .then((storedPreferences) => {
        if (isCurrent) {
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
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setStatus('error');
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Impossibile caricare le preferenze Radar.',
          );
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [isInitializing, userId]);

  useEffect(() => {
    let isCurrent = true;
    let appState: AppStateStatus = AppState.currentState;
    let attemptInFlight = false;
    let attemptGeneration = 0;
    const canRunRadar = Boolean(
      userId &&
        preferencesUserId === userId &&
        participationEnabled &&
        isRadarScreenActive,
    );

    const isAttemptCurrent = (generation: number) =>
      isCurrent &&
      generation === attemptGeneration &&
      appState === 'active' &&
      canRunRadar &&
      activeUserIdRef.current === userId;

    const runOneShotRadar = async () => {
      if (
        attemptInFlight ||
        !isCurrent ||
        appState !== 'active' ||
        !canRunRadar ||
        activeUserIdRef.current !== userId
      ) {
        return;
      }

      attemptInFlight = true;
      const generation = ++attemptGeneration;
      setStatus('searching');
      setError(null);

      try {
        const location = await LocationService.getCurrentLocation({
          timeoutMs: 15_000,
          accuracy: 'balanced',
        });
        if (!isAttemptCurrent(generation)) {
          return;
        }

        if (!RadarService.isLocationAccurateEnough(location)) {
          setUsers([]);
          setStatus('accuracy_insufficient');
          return;
        }

        await enqueuePresenceMutation(() => RadarService.publishPresence(location));
        if (!isAttemptCurrent(generation)) {
          return;
        }

        const nearbyUsers = await RadarService.findNearbyUsers();
        if (!isAttemptCurrent(generation)) {
          return;
        }

        setUsers((currentUsers) =>
          areNearbyUsersEqual(currentUsers, nearbyUsers) ? currentUsers : nearbyUsers,
        );
        setStatus(nearbyUsers.length > 0 ? 'ready' : 'empty');
        setError(null);
        console.info('[SafeMeLink Radar] Ricerca one-shot completata.', {
          nearbyUserCount: nearbyUsers.length,
        });
      } catch (attemptError: unknown) {
        if (!isAttemptCurrent(generation)) {
          return;
        }

        setUsers([]);
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
        if (generation === attemptGeneration) {
          attemptInFlight = false;
        }
      }
    };

    manualRefreshRef.current = () => {
      void runOneShotRadar();
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;
      attemptGeneration += 1;
      attemptInFlight = false;

      if (nextState === 'active') {
        void runOneShotRadar();
      } else if (wasActive && participationEnabled) {
        void deactivate();
      }
    });

    if (userId && preferencesUserId !== userId) {
      clearRadarState(setUsers, setError);
      setStatus('loading_preferences');
    } else if (!participationEnabled) {
      clearRadarState(setUsers, setError);
      setStatus(userId ? (radarEnabled ? 'visibility_required' : 'off') : 'unauthenticated');

      if (userId && preferencesUserId === userId && preferences) {
        void deactivate();
      }
    } else if (isRadarScreenActive && appState === 'active') {
      void runOneShotRadar();
    }

    return () => {
      isCurrent = false;
      attemptGeneration += 1;
      attemptInFlight = false;
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
