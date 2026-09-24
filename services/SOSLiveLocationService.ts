import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { AuthService } from '@/backend/auth/AuthService';
import { SOSLiveLocationRepository } from '@/backend/repositories/SOSLiveLocationRepository';
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
  const accuracy = location.coords.accuracy;
  if (accuracy === null || accuracy < 0 || accuracy > SOS_LIVE_MAX_ACCURACY_METERS) {
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
  try {
    const session = await AuthService.getSession();
    if (session?.user.id !== userId) return 'ignored' as const;
    const updated = await SOSLiveLocationRepository.update(sosId, {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy,
      observedAt: new Date(location.timestamp).toISOString(),
    });
    if (updated) {
      lastPublished = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        at: now,
      };
    }
    return updated ? ('updated' as const) : ('inactive' as const);
  } finally {
    updateInFlight = false;
  }
};

const publishInitialLocation = async (userId: string, sosId: string) => {
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
    await publishLocation(userId, sosId, location);
  } catch (error: unknown) {
    console.warn('[SafeMeLink SOS] LIVE_LOCATION_INITIAL_FIX_UNAVAILABLE', {
      category: error instanceof Error ? error.name : 'unknown',
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const stopTracking = async (userId?: string) => {
  lifecycleGeneration += 1;
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
  if (storageUserId) {
    await SOSLiveLocationStorage.clear(storageUserId).catch(() => undefined);
  }
  if (owner) console.info('[SafeMeLink SOS] LIVE_LOCATION_STOPPED');
};

const startTracking = async (userId: string, sosId: string) => {
  if (activeOwner?.userId === userId && activeOwner.sosId === sosId) {
    const backgroundRunning = await Location.hasStartedLocationUpdatesAsync(
      SOS_LIVE_LOCATION_TASK,
    ).catch(() => false);
    if (foregroundSubscription || backgroundRunning) return;
  }
  await stopTracking(activeOwner?.userId);
  try {
    const generation = ++lifecycleGeneration;
    activeOwner = { userId, sosId };
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

    // Publish one bounded initial fix before starting the long-lived watcher/task.
    // A missing fix must not prevent the SOS itself or its later recovery attempts.
    await publishInitialLocation(userId, sosId);
    if (generation !== lifecycleGeneration || activeOwner?.userId !== userId) return;

    const backgroundPermission = await Location.getBackgroundPermissionsAsync();
    let backgroundStarted = false;
    try {
      const canRunBackground =
        backgroundPermission.status === 'granted' && (await TaskManager.isAvailableAsync());
      backgroundStarted =
        canRunBackground &&
        (await Location.hasStartedLocationUpdatesAsync(SOS_LIVE_LOCATION_TASK));
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
    if (!backgroundStarted) {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: SOS_LIVE_MIN_DISTANCE_METERS,
          timeInterval: SOS_LIVE_MOVING_INTERVAL_MS,
        },
        (location) => {
          if (activeOwner?.userId === userId && activeOwner.sosId === sosId) {
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
      await stopTracking(userId).catch(() => undefined);
    }
    throw error;
  }
};

export const SOSLiveLocationService = {
  start(userId: string, sosId: string) {
    return enqueueLifecycleOperation(() => startTracking(userId, sosId));
  },

  async restore(userId: string, sosId: string) {
    const stored = await SOSLiveLocationStorage.get(userId);
    if (stored?.sosId === sosId) {
      await this.start(userId, sosId);
    }
  },

  stop(userId?: string) {
    return enqueueLifecycleOperation(() => stopTracking(userId));
  },

  publishBackgroundLocation: publishLocation,
};
