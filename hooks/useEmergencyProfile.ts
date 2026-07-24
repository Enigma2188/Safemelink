import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useAuth } from '@/backend/auth/AuthProvider';
import {
  EMPTY_EMERGENCY_PROFILE,
  EmergencyProfileService,
  type EmergencyProfile,
  type EmergencyProfileDraft,
} from '@/services/EmergencyProfileService';

export type EmergencyProfileStatus =
  | 'loading'
  | 'ready'
  | 'saving'
  | 'unauthenticated'
  | 'error';

export function useEmergencyProfile() {
  const { session, isInitializing } = useAuth();
  const [draft, setDraft] = useState<EmergencyProfileDraft>(EMPTY_EMERGENCY_PROFILE);
  const [status, setStatus] = useState<EmergencyProfileStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const isFocusedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const loadRequestKeyRef = useRef('');
  const saveInFlightRef = useRef<{
    userId: string;
    promise: Promise<EmergencyProfile>;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      const loadGeneration = loadGenerationRef.current + 1;
      loadGenerationRef.current = loadGeneration;
      const loadRequestKey = `${session?.user.id ?? 'anonymous'}:${reloadToken}:${loadGeneration}`;
      loadRequestKeyRef.current = loadRequestKey;
      isFocusedRef.current = true;

      if (isInitializing) {
        setHasLoadedProfile(false);
        setStatus('loading');
        return () => {
          isFocusedRef.current = false;
        };
      }

      if (!session) {
        setDraft(EMPTY_EMERGENCY_PROFILE);
        setHasLoadedProfile(false);
        setStatus('unauthenticated');
        setError(null);
        return () => {
          isFocusedRef.current = false;
        };
      }

      setHasLoadedProfile(false);
      setStatus('loading');
      setError(null);

      void EmergencyProfileService.getCurrent()
        .then((profile) => {
          if (
            isFocusedRef.current &&
            loadGenerationRef.current === loadGeneration &&
            loadRequestKeyRef.current === loadRequestKey
          ) {
            setDraft(profile);
            setHasLoadedProfile(true);
            setLastSavedAt(profile.updatedAt);
            setStatus('ready');
          }
        })
        .catch((loadError: unknown) => {
          if (
            isFocusedRef.current &&
            loadGenerationRef.current === loadGeneration &&
            loadRequestKeyRef.current === loadRequestKey
          ) {
            setStatus('error');
            setError(
              loadError instanceof Error
                ? loadError.message
                : 'Caricamento del Profilo di Emergenza non riuscito.',
            );
          }
        });

      return () => {
        isFocusedRef.current = false;
      };
    }, [isInitializing, reloadToken, session]),
  );

  const save = useCallback(async () => {
    if (!session) {
      throw new Error('Accedi per salvare il Profilo di Emergenza.');
    }

    if (saveInFlightRef.current?.userId === session.user.id) {
      return saveInFlightRef.current.promise;
    }

    const userId = session.user.id;
    const saveGeneration = loadGenerationRef.current;
    const request = EmergencyProfileService.save(draft);
    saveInFlightRef.current = { userId, promise: request };
    setStatus('saving');
    setError(null);

    try {
      const savedProfile = await request;

      if (
        isFocusedRef.current &&
        loadGenerationRef.current === saveGeneration
      ) {
        setDraft(savedProfile);
        setLastSavedAt(savedProfile.updatedAt);
        setStatus('ready');
      }

      return savedProfile;
    } catch (saveError: unknown) {
      if (
        isFocusedRef.current &&
        loadGenerationRef.current === saveGeneration
      ) {
        setStatus('error');
        setError(
          saveError instanceof Error
            ? saveError.message
            : 'Salvataggio del Profilo di Emergenza non riuscito.',
        );
      }

      throw saveError;
    } finally {
      if (saveInFlightRef.current?.promise === request) {
        saveInFlightRef.current = null;
      }
    }
  }, [draft, session]);

  return {
    draft,
    setDraft,
    status,
    error,
    lastSavedAt,
    hasLoadedProfile,
    reload: () => setReloadToken((current) => current + 1),
    save,
  };
}
