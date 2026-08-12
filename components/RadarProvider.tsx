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
  RADAR_LOCATION_FALLBACK_INTERVAL_MS,
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
  setRadarScreenActive: (active: boolean) => void;
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
  const userId = session?.user.id ?? null;
  const [users, setUsers] = useState<NearbyUser[]>([]);
  const [status, setStatus] = useState<RadarViewStatus>('loading_preferences');
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<RadarPreferences | null>(null);
  const [preferencesUserId, setPreferencesUserId] = useState<string | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isRadarScreenActive, setIsRadarScreenActive] = useState(false);
  const cycleInFlightRef = useRef(false);
  const lastCycleStartedAtRef = useRef(0);
  const preferenceSaveRef = useRef<RadarPreferenceSave | null>(null);
  const deactivationInFlightRef = useRef<Promise<void> | null>(null);
  const presenceMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeUserIdRef = useRef<string | null>(userId);
  const lastPublishedRef = useRef<RadarPresenceSnapshot | null>(null);
  const radarEnabled = preferences?.radarEnabled ?? false;
  const participationEnabled = canParticipateInRadar(preferences);
  activeUserIdRef.current = userId;

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
    lastPublishedRef.current = null;
    if (deactivationInFlightRef.current) {
      return deactivationInFlightRef.current;
    }

    const request = enqueuePresenceMutation(() => RadarService.deactivatePresence())
      .catch((deactivationError: unknown) => {
        console.warn('[SafeMeLink Radar] Disattivazione presenza non riuscita.', deactivationError);
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
    let locationFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let locationSubscription: LocationWatchSubscription | null = null;
    let locationWatchStarting = false;
    const canParticipate = Boolean(
      userId &&
        preferencesUserId === userId &&
        participationEnabled &&
        isRadarScreenActive,
    );

    const stopLocationFallback = () => {
      if (locationFallbackTimer) {
        clearTimeout(locationFallbackTimer);
        locationFallbackTimer = null;
      }
    };

    const stopLocationWatch = () => {
      stopLocationFallback();
      locationSubscription?.remove();
      locationSubscription = null;
      locationWatchStarting = false;
    };

    const runCycle = async (observedLocation?: SOSLocation) => {
      const cycleStartedAt = Date.now();
      if (
        !isCurrent ||
        appState !== 'active' ||
        !canParticipate ||
        cycleInFlightRef.current ||
        cycleStartedAt - lastCycleStartedAtRef.current < RADAR_REFRESH_INTERVAL_MS
      ) {
        return;
      }

      lastCycleStartedAtRef.current = cycleStartedAt;
      cycleInFlightRef.current = true;
      setStatus((current) => (current === 'ready' ? current : 'searching'));
      setError(null);

      try {
        await deactivationInFlightRef.current;

        if (!isCurrent || appState !== 'active') {
          return;
        }

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
          await enqueuePresenceMutation(() => RadarService.publishPresence(location));

          if (!isCurrent || appState !== 'active') {
            deactivate();
            return;
          }

          lastPublishedRef.current = { location, publishedAt: now };
          console.log('[SafeMeLink Radar] Presenza aggiornata automaticamente.', {
            accuracy: location.accuracy,
            source: observedLocation ? 'watch' : 'fallback',
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

    const scheduleLocationFallback = () => {
      stopLocationFallback();
      if (!isCurrent || appState !== 'active' || !canParticipate) {
        return;
      }

      locationFallbackTimer = setTimeout(() => {
        locationFallbackTimer = null;
        void runCycle().finally(scheduleLocationFallback);
      }, RADAR_LOCATION_FALLBACK_INTERVAL_MS);
    };

    const startLocationWatch = () => {
      if (!canParticipate || locationSubscription || locationWatchStarting) {
        return;
      }

      locationWatchStarting = true;
      void LocationService.watchRadarLocation(
        (location) => {
          if (isCurrent && appState === 'active') {
            scheduleLocationFallback();
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
          scheduleLocationFallback();
        })
        .catch((watchError: unknown) => {
          locationWatchStarting = false;

          if (!isCurrent) {
            return;
          }

          console.warn('[SafeMeLink Radar] Avvio monitoraggio GPS non riuscito.', watchError);
        });
    };

    const startRadar = () => {
      if (!canParticipate || locationSubscription || locationWatchStarting) {
        return;
      }
      startLocationWatch();
      scheduleLocationFallback();
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;

      if (nextState === 'active') {
        startRadar();
      } else if (wasActive) {
        stopLocationWatch();
        lastCycleStartedAtRef.current = 0;
        deactivate();
      }
    });

    if (userId && preferencesUserId !== userId) {
      clearRadarState(setUsers, setError);
      setStatus('loading_preferences');
      deactivate();
    } else if (!canParticipate) {
      clearRadarState(setUsers, setError);
      setStatus(
        userId
          ? radarEnabled
            ? participationEnabled
              ? 'searching'
              : 'visibility_required'
            : 'off'
          : 'unauthenticated',
      );

      if (userId && preferencesUserId === userId && preferences) {
        deactivate();
      } else {
        lastPublishedRef.current = null;
      }
    } else if (appState === 'active') {
      startRadar();
    }

    return () => {
      isCurrent = false;
      stopLocationWatch();
      lastCycleStartedAtRef.current = 0;
      appStateSubscription.remove();

      if (canParticipate) {
        deactivate();
      }
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
      setRadarScreenActive: setIsRadarScreenActive,
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
