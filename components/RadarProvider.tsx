import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { BackendError } from '@/backend/errors/BackendError';
import {
  LocationPermissionError,
  LocationService,
  type LocationWatchSubscription,
  type SOSLocation,
} from '@/services/LocationService';
import {
  RADAR_REFRESH_INTERVAL_MS,
  RadarService,
  canParticipateInRadar,
  shouldPublishRadarPresence,
  type NearbyUser,
  type RadarPreferences,
  type RadarPresenceSnapshot,
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

export function RadarProvider({ children }: PropsWithChildren) {
  const { session, isInitializing } = useAuth();
  const [users, setUsers] = useState<NearbyUser[]>([]);
  const [status, setStatus] = useState<RadarViewStatus>('loading_preferences');
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<RadarPreferences | null>(null);
  const [preferencesUserId, setPreferencesUserId] = useState<string | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const cycleInFlightRef = useRef(false);
  const preferenceSaveRef = useRef<RadarPreferenceSave | null>(null);
  const activeUserIdRef = useRef<string | null>(session?.user.id ?? null);
  const lastPublishedRef = useRef<RadarPresenceSnapshot | null>(null);
  const radarEnabled = preferences?.radarEnabled ?? false;
  const participationEnabled = canParticipateInRadar(preferences);
  activeUserIdRef.current = session?.user.id ?? null;

  const deactivate = useCallback(() => {
    lastPublishedRef.current = null;
    void RadarService.deactivatePresence().catch((deactivationError: unknown) => {
      console.warn('[SafeMeLink Radar] Disattivazione presenza non riuscita.', deactivationError);
    });
  }, []);

  useEffect(() => {
    let isCurrent = true;

    if (isInitializing) {
      return () => {
        isCurrent = false;
      };
    }

    if (!session) {
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
          setPreferencesUserId(session.user.id);
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
  }, [isInitializing, session]);

  useEffect(() => {
    let isCurrent = true;
    let appState: AppStateStatus = AppState.currentState;
    let interval: ReturnType<typeof setInterval> | null = null;
    let locationSubscription: LocationWatchSubscription | null = null;
    let locationWatchStarting = false;
    const canParticipate = Boolean(
      session &&
        preferencesUserId === session.user.id &&
        participationEnabled,
    );

    const stopInterval = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const stopLocationWatch = () => {
      locationSubscription?.remove();
      locationSubscription = null;
      locationWatchStarting = false;
    };

    const runCycle = async (observedLocation?: SOSLocation) => {
      if (
        !isCurrent ||
        appState !== 'active' ||
        !canParticipate ||
        cycleInFlightRef.current
      ) {
        return;
      }

      cycleInFlightRef.current = true;
      setStatus((current) => (current === 'ready' ? current : 'searching'));
      setError(null);

      try {
        const location = observedLocation ?? (await LocationService.getCurrentLocation());

        if (!isCurrent || appState !== 'active') {
          deactivate();
          return;
        }

        if (!RadarService.isLocationAccurateEnough(location)) {
          clearRadarState(setUsers, setError);
          setStatus('accuracy_insufficient');
          deactivate();
          return;
        }

        const now = Date.now();

        if (shouldPublishRadarPresence(lastPublishedRef.current, location, now)) {
          await RadarService.publishPresence(location);

          if (!isCurrent || appState !== 'active') {
            deactivate();
            return;
          }

          lastPublishedRef.current = { location, publishedAt: now };
          console.log('[SafeMeLink Radar] Presenza aggiornata automaticamente.', {
            accuracy: location.accuracy,
            source: observedLocation ? 'watch' : 'periodic',
          });
        }

        const nearbyUsers = await RadarService.findNearbyUsers();

        if (!isCurrent || appState !== 'active') {
          deactivate();
          return;
        }

        setUsers(nearbyUsers);
        setStatus(nearbyUsers.length > 0 ? 'ready' : 'empty');
      } catch (cycleError: unknown) {
        if (!isCurrent) {
          return;
        }

        setUsers([]);

        if (cycleError instanceof LocationPermissionError) {
          setStatus('permission_required');
          setError(null);
          deactivate();
        } else if (cycleError instanceof BackendError) {
          setStatus('error');
          setError(cycleError.message);
        } else {
          setStatus('position_unavailable');
          setError(
            cycleError instanceof Error
              ? cycleError.message
              : 'Posizione temporaneamente non disponibile.',
          );
          deactivate();
        }
      } finally {
        cycleInFlightRef.current = false;
      }
    };

    const startLocationWatch = () => {
      if (!canParticipate || locationSubscription || locationWatchStarting) {
        return;
      }

      locationWatchStarting = true;
      void LocationService.watchRadarLocation(
        (location) => {
          if (isCurrent && appState === 'active') {
            void runCycle(location);
          }
        },
        (watchError) => {
          if (!isCurrent || appState !== 'active') {
            return;
          }

          setStatus('position_unavailable');
          setError(watchError.message);
        },
      )
        .then((subscription) => {
          locationWatchStarting = false;

          if (!isCurrent || appState !== 'active' || !canParticipate) {
            subscription.remove();
            return;
          }

          locationSubscription = subscription;
        })
        .catch((watchError: unknown) => {
          locationWatchStarting = false;

          if (!isCurrent) {
            return;
          }

          console.warn('[SafeMeLink Radar] Avvio monitoraggio GPS non riuscito.', watchError);
        });
    };

    const startInterval = () => {
      if (!canParticipate || interval) {
        return;
      }

      void runCycle();
      interval = setInterval(() => void runCycle(), RADAR_REFRESH_INTERVAL_MS);
      startLocationWatch();
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;

      if (nextState === 'active') {
        startInterval();
      } else if (wasActive) {
        stopInterval();
        stopLocationWatch();
        deactivate();
      }
    });

    if (session && preferencesUserId !== session.user.id) {
      clearRadarState(setUsers, setError);
      setStatus('loading_preferences');
      deactivate();
    } else if (!canParticipate) {
      clearRadarState(setUsers, setError);
      setStatus(session ? (radarEnabled ? 'visibility_required' : 'off') : 'unauthenticated');

      if (session && preferencesUserId === session.user.id && preferences) {
        deactivate();
      } else {
        lastPublishedRef.current = null;
      }
    } else if (appState === 'active') {
      startInterval();
    }

    return () => {
      isCurrent = false;
      stopInterval();
      stopLocationWatch();
      appStateSubscription.remove();

      if (canParticipate) {
        deactivate();
      }
    };
  }, [
    deactivate,
    participationEnabled,
    preferences,
    preferencesUserId,
    radarEnabled,
    session,
  ]);

  const updatePreferences = useCallback(
    async (changes: RadarPreferenceChanges) => {
      const userId = session?.user.id;

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
    [preferences, preferencesUserId, session?.user.id],
  );

  const value = useMemo<RadarContextValue>(
    () => ({
      users,
      status,
      error,
      preferences,
      isSavingPreferences,
      updatePreferences,
    }),
    [error, isSavingPreferences, preferences, status, updatePreferences, users],
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
