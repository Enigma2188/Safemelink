import { useEffect, useRef } from 'react';

import { useAuth } from '@/backend/auth/AuthProvider';
import { PushNotificationService } from '@/services/PushNotificationService';

export function PushTokenRegistrar() {
  const { session } = useAuth();
  const registrationInProgressForUser = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;

    if (!userId || registrationInProgressForUser.current === userId) {
      return;
    }

    registrationInProgressForUser.current = userId;

    void PushNotificationService.registerDeviceForUser(userId)
      .catch((error: unknown) => {
        console.warn('Registrazione Expo Push non riuscita.', error);
      })
      .finally(() => {
        if (registrationInProgressForUser.current === userId) {
          registrationInProgressForUser.current = null;
        }
      });
  }, [session?.user.id]);

  return null;
}
