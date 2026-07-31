import { useEffect, useRef } from 'react';

import { useAuth } from '@/backend/auth/AuthProvider';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { VoiceProtectionStorage } from '@/storage/VoiceProtectionStorage';

export function VoiceProtectionLifecycle() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    const previousUserId = previousUserIdRef.current;
    previousUserIdRef.current = userId;

    if (!previousUserId || previousUserId === userId) {
      return;
    }

    void (async () => {
      await VoiceProtectionService.stop();
      const previousSettings = await VoiceProtectionStorage.get(previousUserId);
      await VoiceProtectionStorage.save(previousUserId, {
        ...previousSettings,
        enabled: false,
        enabledAt: null,
        expiresAt: null,
      });
    })();
  }, [isInitializing, userId]);

  return null;
}
