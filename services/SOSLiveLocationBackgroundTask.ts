import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { AuthService } from '@/backend/auth/AuthService';
import {
  SOS_LIVE_LOCATION_TASK,
  SOSLiveLocationService,
} from '@/services/SOSLiveLocationService';
import { SOSLiveLocationStorage } from '@/storage/SOSLiveLocationStorage';

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  SOS_LIVE_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.warn('[SafeMeLink SOS] LIVE_LOCATION_TASK_FAILED', { category: 'native_task' });
      return;
    }
    const location = data?.locations?.at(-1);
    if (!location) return;
    try {
      const session = await AuthService.getSession();
      if (!session) return;
      const active = await SOSLiveLocationStorage.get(session.user.id);
      if (!active) return;
      const outcome = await SOSLiveLocationService.publishBackgroundLocation(
        session.user.id,
        active.sosId,
        location,
      );
      if (outcome === 'inactive') {
        await SOSLiveLocationService.stop(session.user.id);
      }
    } catch (taskError: unknown) {
      console.warn('[SafeMeLink SOS] LIVE_LOCATION_TASK_FAILED', {
        category: taskError instanceof Error ? taskError.name : 'unknown',
      });
    }
  },
);
