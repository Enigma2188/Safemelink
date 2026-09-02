import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { AuthService } from '@/backend/auth/AuthService';
import { SOSLiveLocationRepository } from '@/backend/repositories/SOSLiveLocationRepository';
import { SOSLiveLocationStorage } from '@/storage/SOSLiveLocationStorage';

export const SOS_LIVE_LOCATION_TASK = 'SAFEMELINK_ACTIVE_SOS_LOCATION';
const SOS_LIVE_MIN_INTERVAL_MS = 60_000;
const SOS_LIVE_MIN_DISTANCE_METERS = 25;
const SOS_LIVE_MAX_ACCURACY_METERS = 100;

let foregroundSubscription: Location.LocationSubscription | null = null;
let activeOwner: { userId: string; sosId: string } | null = null;
let updateInFlight = false;
let lifecycleGeneration = 0;
let lifecycleQueue: Promise<void> = Promise.resolve();

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
    return updated ? ('updated' as const) : ('inactive' as const);
  } finally {
    updateInFlight = false;
  }
};

const stopTracking = async (userId?: string) => {
  lifecycleGeneration += 1;
  const owner = activeOwner;
  activeOwner = null;
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
          timeInterval: SOS_LIVE_MIN_INTERVAL_MS,
          deferredUpdatesDistance: SOS_LIVE_MIN_DISTANCE_METERS,
          deferredUpdatesInterval: SOS_LIVE_MIN_INTERVAL_MS,
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
          timeInterval: SOS_LIVE_MIN_INTERVAL_MS,
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
