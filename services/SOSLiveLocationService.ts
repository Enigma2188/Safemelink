import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { AuthService } from '@/backend/auth/AuthService';
import { SOSLiveLocationRepository } from '@/backend/repositories/SOSLiveLocationRepository';
import { SOSLifecycleRepository } from '@/backend/repositories/SOSLifecycleRepository';
import { requestSOSLocation } from '@/services/SOSLiveLocationRequest';
import { SOSLiveLocationStorage } from '@/storage/SOSLiveLocationStorage';

export const SOS_LIVE_LOCATION_TASK = 'SAFEMELINK_ACTIVE_SOS_LOCATION';
const SOS_LIVE_MIN_DISTANCE_METERS = 25;
const SOS_LIVE_MAX_ACCURACY_METERS = 100;
const SOS_LIVE_INITIAL_FIX_TIMEOUT_MS = 12_000;
const SOS_LIVE_MOVING_INTERVAL_MS = 20_000;
const SOS_LIVE_STILL_INTERVAL_MS = 90_000;
const SOS_LIVE_MOVING_SPEED_MPS = 1;

let foregroundSubscription: Location.LocationSubscription | null = null;
let activeOwner: { userId: string; sosId: string } | null = null;
let updateInFlight = false;
let lifecycleGeneration = 0;
let lifecycleQueue: Promise<void> = Promise.resolve();
let lastPublished: { latitude: number; longitude: number; at: number } | null = null;
let movementState: 'MOVING' | 'STILL' = 'STILL';
let lifecycleRequest = 0;
let publicationController: AbortController | null = null;
let desiredOwner: { userId: string; sosId: string } | null = null;
const stoppedUsers = new Set<string>();
const invalidatePublication = () => {
  lifecycleGeneration++;
  publicationController?.abort();
};

const distanceMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const enqueueLifecycleOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = lifecycleQueue.then(operation, operation);
  lifecycleQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const publishLocation = async (
  userId: string,
  sosId: string,
  location: Location.LocationObject,
) => {
  if (stoppedUsers.has(userId)) return 'ignored' as const;
  const accuracy = location.coords.accuracy;
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > SOS_LIVE_MAX_ACCURACY_METERS ||
    !Number.isFinite(location.timestamp) ||
    !Number.isFinite(location.coords.latitude) || Math.abs(location.coords.latitude) > 90 ||
    !Number.isFinite(location.coords.longitude) || Math.abs(location.coords.longitude) > 180) {
    console.info('[SafeMeLink SOS] LIVE_LOCATION_SKIPPED', { category: 'accuracy' });
    return 'ignored' as const;
  }
  const now = Date.now();
  const speed = typeof location.coords.speed === 'number' && location.coords.speed >= 0
    ? location.coords.speed
    : null;
  const moved = lastPublished
    ? distanceMeters(lastPublished, {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      }) >= SOS_LIVE_MIN_DISTANCE_METERS
    : true;
  movementState = speed !== null
    ? (speed >= SOS_LIVE_MOVING_SPEED_MPS ? 'MOVING' : 'STILL')
    : (moved ? 'MOVING' : 'STILL');
  const minimumInterval = movementState === 'MOVING'
    ? SOS_LIVE_MOVING_INTERVAL_MS
    : SOS_LIVE_STILL_INTERVAL_MS;
  if (lastPublished && now - lastPublished.at < minimumInterval) return 'ignored' as const;
  if (updateInFlight) return 'ignored' as const;
  updateInFlight = true;
  const generation = lifecycleGeneration;
  const controller = new AbortController();
  publicationController = controller;
  const current = () => generation === lifecycleGeneration && !stoppedUsers.has(userId);
  try {
    const session = await AuthService.getSession();
    if (session?.user.id !== userId || generation !== lifecycleGeneration) return 'ignored' as const;
    const outcome = await requestSOSLocation(async signal => {
      // Re-check identity for every retry; an old token/session is not authorization.
      if ((await AuthService.getSession())?.user.id !== userId || !current() || signal.aborted) throw new Error('GPS owner changed');
      return SOSLiveLocationRepository.update(sosId, {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy,
        observedAt: new Date(location.timestamp).toISOString(),
      }, signal);
    }, controller.signal, current);
    // An old response must not throttle a successor session. A stale fix was
    // NOT saved and must not consume its next opportunity to publish a fresh fix.
    if (generation !== lifecycleGeneration) return 'ignored' as const;
    if (outcome === 'updated') {
      lastPublished = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        at: now,
      };
    }
    return outcome;
  } finally {
    if (publicationController === controller) publicationController = null;
    updateInFlight = false;
  }
};

const publishInitialLocation = async (userId: string, sosId: string, generation: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Initial SOS location timeout.')),
          SOS_LIVE_INITIAL_FIX_TIMEOUT_MS,
        );
      }),
    ]);
    if (generation === lifecycleGeneration) await publishLocation(userId, sosId, location);
  } catch (error: unknown) {
    console.warn('[SafeMeLink SOS] LIVE_LOCATION_INITIAL_FIX_UNAVAILABLE', {
      category: error instanceof Error ? error.name : 'unknown',
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const stopTracking = async (userId?: string, clearSnapshot = true) => {
  invalidatePublication();
  const owner = activeOwner;
  activeOwner = null;
  lastPublished = null;
  movementState = 'STILL';
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  if (await Location.hasStartedLocationUpdatesAsync(SOS_LIVE_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(SOS_LIVE_LOCATION_TASK);
  }
  const storageUserId = userId ?? owner?.userId;
  if (storageUserId && clearSnapshot) {
    await SOSLiveLocationStorage.clear(storageUserId).catch(() => undefined);
  }
  if (owner) console.info('[SafeMeLink SOS] LIVE_LOCATION_STOPPED');
};

const startTracking = async (userId: string, sosId: string, request: number) => {
  if (activeOwner?.userId === userId && activeOwner.sosId === sosId) {
    const backgroundRunning = await Location.hasStartedLocationUpdatesAsync(
      SOS_LIVE_LOCATION_TASK,
    ).catch(() => false);
    if (backgroundRunning) return;
    const permission = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (foregroundSubscription && permission?.status !== 'granted') return;
  }
  if (request !== lifecycleRequest) return;
  await stopTracking(activeOwner?.userId);
  if (request !== lifecycleRequest) return;
  try {
    stoppedUsers.delete(userId);
    const generation = ++lifecycleGeneration;
    activeOwner = { userId, sosId };
    const current = () => generation === lifecycleGeneration && request === lifecycleRequest &&
      activeOwner?.userId === userId && activeOwner.sosId === sosId;
    await SOSLiveLocationStorage.save(userId, {
      sosId,
      startedAt: new Date().toISOString(),
    });
    if (generation !== lifecycleGeneration || activeOwner?.userId !== userId) return;

    const foregroundPermission = await Location.getForegroundPermissionsAsync();
    if (foregroundPermission.status !== 'granted') {
      await stopTracking(userId);
      return;
    }
    if (generation !== lifecycleGeneration || activeOwner?.userId !== userId) return;

    // The initial fix/upload must not delay the long-lived task or block stop().
    // Its captured generation prevents a late fix from publishing after stop.
    void publishInitialLocation(userId, sosId, generation);
    if (generation !== lifecycleGeneration || activeOwner?.userId !== userId) return;

    const backgroundPermission = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (!current()) return;
    let backgroundStarted = false;
    try {
      const canRunBackground =
        backgroundPermission?.status === 'granted' && (await TaskManager.isAvailableAsync());
      if (!current()) return;
      backgroundStarted =
        canRunBackground &&
        (await Location.hasStartedLocationUpdatesAsync(SOS_LIVE_LOCATION_TASK));
      if (!current()) return;
      if (canRunBackground && !backgroundStarted) {
        await Location.startLocationUpdatesAsync(SOS_LIVE_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          distanceInterval: SOS_LIVE_MIN_DISTANCE_METERS,
          timeInterval: SOS_LIVE_MOVING_INTERVAL_MS,
          deferredUpdatesDistance: SOS_LIVE_MIN_DISTANCE_METERS,
          deferredUpdatesInterval: SOS_LIVE_MOVING_INTERVAL_MS,
          pausesUpdatesAutomatically: false,
          foregroundService: {
            notificationTitle: 'SafeMeLink — SOS attivo',
            notificationBody: 'Aggiornamento della posizione dell’emergenza in corso.',
            notificationColor: '#FF3B5C',
            killServiceOnDestroy: false,
          },
        });
        backgroundStarted = true;
      }
    } catch (error: unknown) {
      console.warn('[SafeMeLink SOS] LIVE_LOCATION_BACKGROUND_UNAVAILABLE', {
        category: error instanceof Error ? error.name : 'unknown',
      });
    }
    if (!current()) return;
    if (!backgroundStarted) {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: SOS_LIVE_MIN_DISTANCE_METERS,
          timeInterval: SOS_LIVE_MOVING_INTERVAL_MS,
        },
        (location) => {
          if (generation === lifecycleGeneration && activeOwner?.userId === userId && activeOwner.sosId === sosId) {
            void publishLocation(userId, sosId, location).catch((error: unknown) => {
              console.warn('[SafeMeLink SOS] LIVE_LOCATION_UPDATE_FAILED', {
                category: error instanceof Error ? error.name : 'unknown',
              });
            });
          }
        },
      );
      if (generation !== lifecycleGeneration || activeOwner?.userId !== userId) {
        subscription.remove();
        return;
      }
      foregroundSubscription = subscription;
    }
    console.info('[SafeMeLink SOS] LIVE_LOCATION_STARTED');
  } catch (error) {
    if (activeOwner?.userId === userId && activeOwner.sosId === sosId) {
      // Keep the snapshot on startup failure; future recovery must still verify
      // ownership and active server status before retrying the native task.
      await stopTracking(userId, false).catch(() => undefined);
    }
    throw error;
  }
};

export const SOSLiveLocationService = {
  start(userId: string, sosId: string) {
    desiredOwner = { userId, sosId };
    const request = ++lifecycleRequest;
    if (!foregroundSubscription || activeOwner?.userId !== userId || activeOwner.sosId !== sosId) invalidatePublication();
    return enqueueLifecycleOperation(async () => {
      if (request === lifecycleRequest) await startTracking(userId, sosId, request);
    });
  },

  async restore(userId: string, sosId: string) {
    const request = lifecycleRequest;
    const stored = await SOSLiveLocationStorage.get(userId);
    if (stored?.sosId !== sosId || request !== lifecycleRequest || stoppedUsers.has(userId)) return;
    const state = await SOSLifecycleRepository.getStatus(sosId);
    const session = await AuthService.getSession();
    if (request !== lifecycleRequest || session?.user.id !== userId || state.sos_id !== sosId || state.is_owner !== true) return;
    if (state.sos_status === 'open' || state.sos_status === 'accepted') await this.start(userId, sosId);
    else if (state.sos_status === 'closed' || state.sos_status === 'cancelled') await this.stop(userId);
  },

  stop(userId?: string, expectedSosId?: string) {
    const ownerNow = desiredOwner ?? activeOwner;
    if (userId && ownerNow && ownerNow.userId !== userId) return SOSLiveLocationStorage.clear(userId);
    if (expectedSosId && ownerNow && ownerNow.sosId !== expectedSosId) return Promise.resolve();
    desiredOwner = null;
    const request = ++lifecycleRequest;
    const owner = userId ?? activeOwner?.userId;
    if (owner) stoppedUsers.add(owner);
    invalidatePublication();
    foregroundSubscription?.remove();
    foregroundSubscription = null;
    return enqueueLifecycleOperation(async () => {
      if (request === lifecycleRequest) await stopTracking(userId);
    });
  },

  publishBackgroundLocation: publishLocation,
};

let foregroundRecoveryInFlight = false;
AppState.addEventListener('change', state => {
  if (state !== 'active' || foregroundRecoveryInFlight) return;
  foregroundRecoveryInFlight = true;
  const request = lifecycleRequest;
  void (async () => {
    const session = await AuthService.getSession();
    if (!session || request !== lifecycleRequest || stoppedUsers.has(session.user.id)) return;
    const stored = await SOSLiveLocationStorage.get(session.user.id);
    if (stored && request === lifecycleRequest) await SOSLiveLocationService.restore(session.user.id, stored.sosId);
  })().catch(() => {
    console.warn('[SafeMeLink SOS] LIVE_LOCATION_RECOVERY_UNVERIFIED');
  }).finally(() => { foregroundRecoveryInFlight = false; });
});
