import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { BackendError } from '@/backend/errors/BackendError';
import { RadarRequestTimeoutError } from '@/backend/repositories/RadarRepository';
import {
  LocationPermissionError,
  LocationService,
  LocationTimeoutError,
  LocationUnavailableError,
  LocationWatchStartupTimeoutError,
  type LocationWatchSubscription,
  type SOSLocation,
} from '@/services/LocationService';
import {
  RADAR_CACHED_LOCATION_MAX_AGE_MS,
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
  const lastPublishedRef = useRef<RadarPresenceSnapshot | null>(null);
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
    lastPublishedRef.current = null;
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
    let locationWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let networkRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let locationSubscription: LocationWatchSubscription | null = null;
    let locationWatchStarting = false;
    let locationWatchGeneration = 0;
    let fallbackUsed = false;
    let fallbackPending = false;
    let watchRestartAttempted = false;
    let activityGeneration = 0;
    let activeCycleToken: symbol | null = null;
    let lastCycleStartedAt = 0;
    let lastKnownLocation: SOSLocation | null = null;
    let lastLocationObservedAt = 0;
    const canParticipate = Boolean(
      userId &&
        preferencesUserId === userId &&
        participationEnabled &&
        isRadarScreenActive,
    );

    const isActiveRadarContext = () =>
      isCurrent &&
      appState === 'active' &&
      canParticipate &&
      activeUserIdRef.current === userId;

    const stopLocationWatchdog = () => {
      if (locationWatchdogTimer) {
        clearTimeout(locationWatchdogTimer);
        locationWatchdogTimer = null;
      }
    };

    const stopNetworkRefresh = () => {
      if (networkRefreshTimer) {
        clearTimeout(networkRefreshTimer);
        networkRefreshTimer = null;
      }
    };

    const stopLocationWatch = () => {
      locationWatchGeneration += 1;
      stopLocationWatchdog();
      stopNetworkRefresh();
      locationSubscription?.remove();
      locationSubscription = null;
      locationWatchStarting = false;
    };

    const setLocationFailure = (locationError: unknown) => {
      if (!isActiveRadarContext()) {
        return;
      }

      stopNetworkRefresh();
      lastKnownLocation = null;
      lastLocationObservedAt = 0;
      setUsers([]);
      if (locationError instanceof LocationPermissionError) {
        setStatus('permission_required');
        setError(null);
      } else {
        setStatus('position_unavailable');
        setError(
          locationError instanceof LocationTimeoutError ||
            locationError instanceof LocationUnavailableError ||
            locationError instanceof LocationWatchStartupTimeoutError
            ? locationError.message
            : 'Posizione temporaneamente non disponibile. Riprova.',
        );
      }
      void deactivate();
    };

    function scheduleNetworkRefresh(delayMs = RADAR_REFRESH_INTERVAL_MS) {
      if (networkRefreshTimer || !lastKnownLocation || !isActiveRadarContext()) {
        return;
      }

      networkRefreshTimer = setTimeout(() => {
        networkRefreshTimer = null;
        if (lastKnownLocation) {
          void runCycle(lastKnownLocation, {
            force: true,
            freshObservation: false,
            source: 'refresh',
          });
        }
      }, delayMs);
    }

    async function runCycle(
      suppliedLocation?: SOSLocation,
      options: {
        force?: boolean;
        freshObservation?: boolean;
        source: 'watch' | 'fallback' | 'refresh' | 'manual';
      } = { source: 'watch' },
    ) {
      if (!isActiveRadarContext()) {
        return;
      }

      if (suppliedLocation && options.freshObservation) {
        if (!RadarService.isLocationAccurateEnough(suppliedLocation)) {
          if (!lastKnownLocation) {
            clearRadarState(setUsers, setError);
            setStatus('accuracy_insufficient');
          }
          return;
        }

        lastKnownLocation = suppliedLocation;
        lastLocationObservedAt = Date.now();
        stopLocationWatchdog();
      }

      const cycleStartedAt = Date.now();
      if (activeCycleToken) {
        scheduleNetworkRefresh();
        return;
      }

      if (
        !options.force &&
        lastCycleStartedAt > 0 &&
        cycleStartedAt - lastCycleStartedAt < RADAR_REFRESH_INTERVAL_MS
      ) {
        scheduleNetworkRefresh(
          RADAR_REFRESH_INTERVAL_MS - (cycleStartedAt - lastCycleStartedAt),
        );
        return;
      }

      const cycleToken = Symbol('radar-cycle');
      const cycleGeneration = activityGeneration;
      const isCycleCurrent = () =>
        activeCycleToken === cycleToken &&
        cycleGeneration === activityGeneration &&
        isActiveRadarContext();

      activeCycleToken = cycleToken;
      lastCycleStartedAt = cycleStartedAt;
      setStatus((current) =>
        current === 'ready' || current === 'empty' ? current : 'searching',
      );
      setError(null);

      try {
        await deactivationInFlightRef.current;
        if (!isCycleCurrent()) {
          return;
        }

        const location =
          suppliedLocation ??
          (await LocationService.getCurrentLocation({ timeoutMs: 15_000 }));
        if (!isCycleCurrent()) {
          return;
        }

        if (!RadarService.isLocationAccurateEnough(location)) {
          if (!lastKnownLocation) {
            clearRadarState(setUsers, setError);
            setStatus('accuracy_insufficient');
            void deactivate();
          }
          return;
        }

        if (!suppliedLocation) {
          lastKnownLocation = location;
          lastLocationObservedAt = Date.now();
          stopLocationWatchdog();
        }

        const now = Date.now();
        const cachedLocationIsFresh =
          now - lastLocationObservedAt <= RADAR_CACHED_LOCATION_MAX_AGE_MS;

        if (
          cachedLocationIsFresh &&
          shouldPublishRadarPresence(lastPublishedRef.current, location, now)
        ) {
          await enqueuePresenceMutation(() => RadarService.publishPresence(location));
          if (!isCycleCurrent()) {
            return;
          }

          lastPublishedRef.current = { location, publishedAt: now };
          console.info('[SafeMeLink Radar] Presenza pubblicata.', {
            source: options.source,
          });
        }

        const nearbyUsers = await RadarService.findNearbyUsers();
        if (!isCycleCurrent()) {
          return;
        }

        setUsers((currentUsers) =>
          areNearbyUsersEqual(currentUsers, nearbyUsers) ? currentUsers : nearbyUsers,
        );
        setStatus(nearbyUsers.length > 0 ? 'ready' : 'empty');
        setError(null);
      } catch (cycleError: unknown) {
        if (!isCycleCurrent()) {
          return;
        }

        if (
          cycleError instanceof LocationPermissionError ||
          cycleError instanceof LocationTimeoutError ||
          cycleError instanceof LocationUnavailableError ||
          cycleError instanceof LocationWatchStartupTimeoutError
        ) {
          setLocationFailure(cycleError);
        } else {
          setUsers([]);
          setStatus('error');
          setError(
            cycleError instanceof BackendError ||
              cycleError instanceof RadarRequestTimeoutError
              ? cycleError.message
              : 'Errore temporaneo durante la ricerca Radar.',
          );
        }
      } finally {
        if (activeCycleToken === cycleToken) {
          const cycleContextStillActive =
            cycleGeneration === activityGeneration && isActiveRadarContext();
          activeCycleToken = null;
          if (fallbackPending && cycleContextStillActive) {
            fallbackPending = false;
            fallbackUsed = false;
            runSingleLocationFallback();
          } else if (cycleContextStillActive && lastKnownLocation) {
            scheduleNetworkRefresh();
          }
        }
      }
    }

    function runSingleLocationFallback() {
      if (fallbackUsed || !isActiveRadarContext()) {
        return;
      }

      fallbackUsed = true;
      stopLocationWatchdog();
      if (activeCycleToken) {
        fallbackPending = true;
        return;
      }

      return runCycle(undefined, {
        force: true,
        freshObservation: true,
        source: 'fallback',
      });
    }

    const armLocationWatchdog = () => {
      if (
        locationWatchdogTimer ||
        fallbackUsed ||
        lastKnownLocation ||
        !isActiveRadarContext()
      ) {
        return;
      }

      locationWatchdogTimer = setTimeout(() => {
        locationWatchdogTimer = null;
        runSingleLocationFallback();
      }, RADAR_LOCATION_FALLBACK_INTERVAL_MS);
    };

    const startLocationWatch = () => {
      if (
        !isActiveRadarContext() ||
        locationSubscription ||
        locationWatchStarting
      ) {
        return;
      }

      locationWatchStarting = true;
      const watchGeneration = ++locationWatchGeneration;
      armLocationWatchdog();

      void LocationService.watchRadarLocation(
        (location) => {
          if (!isActiveRadarContext() || watchGeneration !== locationWatchGeneration) {
            return;
          }

          void runCycle(location, {
            freshObservation: true,
            source: 'watch',
          });
        },
        (watchError) => {
          if (!isActiveRadarContext() || watchGeneration !== locationWatchGeneration) {
            return;
          }

          locationSubscription?.remove();
          locationSubscription = null;
          locationWatchStarting = false;
          locationWatchGeneration += 1;
          const fallbackAlreadyUsed = fallbackUsed;
          runSingleLocationFallback();
          if (fallbackAlreadyUsed && !activeCycleToken) {
            setLocationFailure(watchError);
          }
          console.warn('[SafeMeLink Radar] Watcher GPS interrotto.', {
            category: watchError.name,
          });
        },
      )
        .then((subscription) => {
          if (
            !isActiveRadarContext() ||
            watchGeneration !== locationWatchGeneration
          ) {
            subscription.remove();
            return;
          }

          locationWatchStarting = false;
          locationSubscription = subscription;
          armLocationWatchdog();
        })
        .catch((watchError: unknown) => {
          if (
            !isActiveRadarContext() ||
            watchGeneration !== locationWatchGeneration
          ) {
            return;
          }

          locationWatchStarting = false;
          console.warn('[SafeMeLink Radar] Avvio monitoraggio GPS non riuscito.', {
            category: watchError instanceof Error ? watchError.name : 'unknown',
          });

          if (
            watchError instanceof LocationPermissionError ||
            watchError instanceof LocationUnavailableError
          ) {
            stopLocationWatchdog();
            setLocationFailure(watchError);
          } else {
            const fallbackRequest = runSingleLocationFallback();
            if (
              fallbackRequest &&
              watchError instanceof LocationWatchStartupTimeoutError &&
              !watchRestartAttempted
            ) {
              watchRestartAttempted = true;
              void fallbackRequest.finally(() => {
                if (isActiveRadarContext()) {
                  startLocationWatch();
                }
              });
            }
          }
        });
    };

    const startRadar = () => {
      if (!isActiveRadarContext()) {
        return;
      }

      startLocationWatch();
      if (
        lastKnownLocation &&
        Date.now() - lastLocationObservedAt <= RADAR_CACHED_LOCATION_MAX_AGE_MS
      ) {
        void runCycle(lastKnownLocation, {
          force: true,
          freshObservation: false,
          source: 'refresh',
        });
      }
    };

    manualRefreshRef.current = () => {
      if (!isActiveRadarContext()) {
        return;
      }

      fallbackUsed = false;
      stopNetworkRefresh();
      setStatus('searching');
      setError(null);

      if (lastKnownLocation) {
        void runCycle(lastKnownLocation, {
          force: true,
          freshObservation: false,
          source: 'manual',
        });
        startLocationWatch();
        return;
      }

      stopLocationWatch();
      void runCycle(undefined, {
        force: true,
        freshObservation: true,
        source: 'manual',
      }).finally(() => {
        if (isActiveRadarContext()) {
          startLocationWatch();
        }
      });
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;
      activityGeneration += 1;
      activeCycleToken = null;

      if (nextState === 'active') {
        lastCycleStartedAt = 0;
        startRadar();
      } else if (wasActive) {
        stopLocationWatch();
        fallbackUsed = false;
        fallbackPending = false;
        lastCycleStartedAt = 0;
        void deactivate();
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
      manualRefreshRef.current = () => undefined;
      stopLocationWatch();
      appStateSubscription.remove();

      if (canParticipate && activeUserIdRef.current === userId) {
        void deactivate();
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
