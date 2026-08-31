import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { AuthService } from '@/backend/auth/AuthService';
import {
  SOSNetworkPresenceRepository,
  type SOSNetworkPresenceSource,
} from '@/backend/repositories/SOSNetworkPresenceRepository';
import { SOSNetworkLocationStorage } from '@/storage/SOSNetworkLocationStorage';

export const SOS_NETWORK_LOCATION_TASK = 'SAFEMELINK_SOS_NETWORK_LOCATION';
export const SOS_NETWORK_MAX_ACCURACY_METERS = 100;
const BACKGROUND_UPDATE_INTERVAL_MS = 10 * 60 * 1_000;
const BACKGROUND_UPDATE_DISTANCE_METERS = 100;
const FOREGROUND_LOCATION_TIMEOUT_MS = 20_000;

export class SOSNetworkPermissionError extends Error {
  constructor(
    public readonly permission: 'foreground' | 'background',
  ) {
    super(
      permission === 'background'
        ? 'Consenti la posizione sempre per risultare disponibile alla rete SOS.'
        : 'Consenti la posizione per aderire alla rete SOS.',
    );
    this.name = 'SOSNetworkPermissionError';
  }
}

export class SOSNetworkBackgroundUnavailableError extends Error {
  constructor() {
    super('Gli aggiornamenti in background non sono disponibili su questo dispositivo.');
    this.name = 'SOSNetworkBackgroundUnavailableError';
  }
}

export class SOSNetworkLocationServicesDisabledError extends Error {
  constructor() {
    super('Attiva la posizione del dispositivo per renderti disponibile nella Rete SOS.');
    this.name = 'SOSNetworkLocationServicesDisabledError';
  }
}

export class SOSNetworkLocationTimeoutError extends Error {
  constructor() {
    super('La posizione non è arrivata in tempo. Controlla il GPS e riprova.');
    this.name = 'SOSNetworkLocationTimeoutError';
  }
}

export type SOSNetworkPermissionState = {
  foregroundGranted: boolean;
  backgroundGranted: boolean;
};

export type SOSNetworkNotificationPermissionState = {
  granted: boolean;
  canAskAgain: boolean;
};

let publicationInFlight: { userId: string; promise: Promise<boolean> } | null = null;

const publishLocation = async (
  location: Location.LocationObject,
  source: SOSNetworkPresenceSource,
  expectedUserId: string,
) => {
  const accuracy = location.coords.accuracy;
  if (
    accuracy === null ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > SOS_NETWORK_MAX_ACCURACY_METERS
  ) {
    console.info('[SafeMeLink Rete SOS] Posizione ignorata.', {
      category: 'accuracy_insufficient',
      source,
    });
    return false;
  }

  const session = await AuthService.getSession();
  if (session?.user.id !== expectedUserId) {
    console.info('[SafeMeLink Rete SOS] Pubblicazione obsoleta ignorata.', {
      category: 'account_changed',
      source,
    });
    return false;
  }

  await SOSNetworkPresenceRepository.updatePresence({
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy,
    observedAt: new Date(location.timestamp).toISOString(),
    source,
  });
  await SOSNetworkLocationStorage.save(expectedUserId, {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy,
    observedAt: new Date(location.timestamp).toISOString(),
  }).catch(() => {
    console.warn('[SafeMeLink Rete SOS] Cache posizione non aggiornata.', {
      category: 'local_storage',
    });
  });
  console.info('[SafeMeLink Rete SOS] SOS_NETWORK_PRESENCE_SUCCESS', { source });
  return true;
};

export const SOSNetworkPresenceService = {
  async requestPermissions(): Promise<SOSNetworkPermissionState> {
    const locationServicesEnabled = await Location.hasServicesEnabledAsync();
    if (!locationServicesEnabled) {
      console.info('[SafeMeLink Rete SOS] SOS_NETWORK_LOCATION_SERVICES', {
        enabled: false,
      });
      throw new SOSNetworkLocationServicesDisabledError();
    }
    console.info('[SafeMeLink Rete SOS] SOS_NETWORK_LOCATION_SERVICES', {
      enabled: true,
    });

    const foreground = await Location.requestForegroundPermissionsAsync();
    console.info('[SafeMeLink Rete SOS] SOS_NETWORK_PERMISSION_FOREGROUND', {
      granted: foreground.status === 'granted',
    });
    if (foreground.status !== 'granted') {
      throw new SOSNetworkPermissionError('foreground');
    }

    const background = await Location.requestBackgroundPermissionsAsync();
    console.info('[SafeMeLink Rete SOS] SOS_NETWORK_PERMISSION_BACKGROUND', {
      granted: background.status === 'granted',
    });
    return {
      foregroundGranted: true,
      backgroundGranted: background.status === 'granted',
    };
  },

  async getNotificationPermissionState(): Promise<SOSNetworkNotificationPermissionState> {
    const permission = await Notifications.getPermissionsAsync();
    return {
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
    };
  },

  async hasRequiredPermissions() {
    const [foreground, background] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    return foreground.status === 'granted' && background.status === 'granted';
  },

  async startBackgroundUpdates() {
    if (!(await TaskManager.isAvailableAsync())) {
      throw new SOSNetworkBackgroundUnavailableError();
    }

    if (!(await this.hasRequiredPermissions())) {
      throw new SOSNetworkPermissionError('background');
    }

    if (await Location.hasStartedLocationUpdatesAsync(SOS_NETWORK_LOCATION_TASK)) {
      return;
    }

    await Location.startLocationUpdatesAsync(SOS_NETWORK_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      activityType: Location.ActivityType.Other,
      distanceInterval: BACKGROUND_UPDATE_DISTANCE_METERS,
      timeInterval: BACKGROUND_UPDATE_INTERVAL_MS,
      deferredUpdatesDistance: BACKGROUND_UPDATE_DISTANCE_METERS,
      deferredUpdatesInterval: BACKGROUND_UPDATE_INTERVAL_MS,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
      ...(Platform.OS === 'android'
        ? {
            foregroundService: {
              notificationTitle: 'SafeMeLink — Rete SOS',
              notificationBody: 'Disponibilità occasionale alle emergenze nelle vicinanze attiva.',
              notificationColor: '#45B7FF',
              killServiceOnDestroy: false,
            },
          }
        : {}),
    });
  },

  async stopBackgroundUpdates() {
    if (await Location.hasStartedLocationUpdatesAsync(SOS_NETWORK_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(SOS_NETWORK_LOCATION_TASK);
    }
  },

  publishForegroundPresence(expectedUserId: string): Promise<boolean> {
    if (publicationInFlight) {
      if (publicationInFlight.userId === expectedUserId) {
        return publicationInFlight.promise;
      }
      return publicationInFlight.promise
        .catch(() => false)
        .then(() => this.publishForegroundPresence(expectedUserId));
    }

    const request = (async () => {
      console.info('[SafeMeLink Rete SOS] SOS_NETWORK_PRESENCE_ATTEMPT', {
        source: 'foreground',
      });
      const foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        throw new SOSNetworkPermissionError('foreground');
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        console.info('[SafeMeLink Rete SOS] SOS_NETWORK_LOCATION_SERVICES', {
          enabled: false,
        });
        throw new SOSNetworkLocationServicesDisabledError();
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let location: Location.LocationObject;
      try {
        location = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new SOSNetworkLocationTimeoutError()),
              FOREGROUND_LOCATION_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
      try {
        return await publishLocation(location, 'foreground', expectedUserId);
      } catch (error: unknown) {
        console.warn('[SafeMeLink Rete SOS] SOS_NETWORK_PRESENCE_FAILURE', {
          category: error instanceof Error ? error.name : 'unknown',
          source: 'foreground',
        });
        throw error;
      }
    })().finally(() => {
      if (publicationInFlight?.promise === request) {
        publicationInFlight = null;
      }
    });

    publicationInFlight = { userId: expectedUserId, promise: request };
    return request;
  },

  publishBackgroundLocation(location: Location.LocationObject, expectedUserId: string) {
    return publishLocation(location, 'background', expectedUserId);
  },
};
