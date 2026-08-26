import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { AuthService } from '@/backend/auth/AuthService';
import {
  SOS_NETWORK_LOCATION_TASK,
  SOSNetworkPresenceService,
} from '@/services/SOSNetworkPresenceService';

type BackgroundLocationTaskData = {
  locations?: Location.LocationObject[];
};

TaskManager.defineTask<BackgroundLocationTaskData>(
  SOS_NETWORK_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.warn('[SafeMeLink Rete SOS] Aggiornamento background non riuscito.', {
        category: 'native_task',
      });
      return;
    }

    const latestLocation = data?.locations?.reduce<Location.LocationObject | null>(
      (latest, location) => (!latest || location.timestamp > latest.timestamp ? location : latest),
      null,
    );
    if (!latestLocation) {
      console.info('[SafeMeLink Rete SOS] Aggiornamento background senza posizione.');
      return;
    }

    try {
      console.info('[SafeMeLink Rete SOS] SOS_NETWORK_PRESENCE_ATTEMPT', {
        source: 'background',
      });
      let session = await AuthService.getSession();
      if (!session) {
        console.info('[SafeMeLink Rete SOS] Aggiornamento ignorato: sessione non disponibile.');
        return;
      }

      if ((session.expires_at ?? 0) * 1_000 <= Date.now() + 60_000) {
        session = await AuthService.refreshSession();
      }
      if (!session) {
        return;
      }

      await SOSNetworkPresenceService.publishBackgroundLocation(
        latestLocation,
        session.user.id,
      );
    } catch (taskError: unknown) {
      console.warn('[SafeMeLink Rete SOS] SOS_NETWORK_PRESENCE_FAILURE', {
        category: taskError instanceof Error ? taskError.name : 'unknown',
        source: 'background',
      });
    }
  },
);
