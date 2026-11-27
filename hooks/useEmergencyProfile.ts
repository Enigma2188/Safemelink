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
  const [savedSharing, setSavedSharing] = useState<{ medical: boolean; ice: boolean } | null>(null);
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);
  const [loadedOwnerId, setLoadedOwnerId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isFocusedRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(session?.user.id ?? null);
  const loadGenerationRef = useRef(0);
  const loadRequestKeyRef = useRef('');
  const saveInFlightRef = useRef<{
    userId: string;
    promise: Promise<EmergencyProfile>;
  } | null>(null);
  activeUserIdRef.current = session?.user.id ?? null;

  useFocusEffect(
    useCallback(() => {
      const loadGeneration = loadGenerationRef.current + 1;
      loadGenerationRef.current = loadGeneration;
      const loadRequestKey = `${session?.user.id ?? 'anonymous'}:${reloadToken}:${loadGeneration}`;
      loadRequestKeyRef.current = loadRequestKey;
      isFocusedRef.current = true;

      if (isInitializing) {
        setHasLoadedProfile(false);
        setLoadedOwnerId(null);
        setSavedSharing(null);
        setStatus('loading');
        return () => {
          isFocusedRef.current = false;
        };
      }

      if (!session) {
        setDraft(EMPTY_EMERGENCY_PROFILE);
        setSavedSharing(null);
        setLoadedOwnerId(null);
        setHasLoadedProfile(false);
        setStatus('unauthenticated');
        setError(null);
        return () => {
          isFocusedRef.current = false;
        };
      }

      setHasLoadedProfile(false);
      setLoadedOwnerId(null);
      setSavedSharing(null);
      setStatus('loading');
      setError(null);

      void EmergencyProfileService.getCurrent()
        .then((profile) => {
          if (
            isFocusedRef.current &&
            activeUserIdRef.current === session.user.id &&
            loadGenerationRef.current === loadGeneration &&
            loadRequestKeyRef.current === loadRequestKey
          ) {
            setDraft(profile);
            setLoadedOwnerId(session.user.id);
            setSavedSharing({ medical: profile.shareMedicalDataDuringSOS, ice: profile.shareICEContactDuringSOS });
            setHasLoadedProfile(true);
            setLastSavedAt(profile.updatedAt);
            setStatus('ready');
          }
        })
        .catch((loadError: unknown) => {
          if (
            isFocusedRef.current &&
            activeUserIdRef.current === session.user.id &&
            loadGenerationRef.current === loadGeneration &&
            loadRequestKeyRef.current === loadRequestKey
          ) {
            setStatus('error');
            setLoadedOwnerId(null);
            setSavedSharing(null);
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
    if (!session || !hasLoadedProfile || loadedOwnerId !== session.user.id || isInitializing) {
      throw new Error('Verifica il Profilo di Emergenza con il tuo account prima di salvarlo.');
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
        activeUserIdRef.current === userId &&
        loadGenerationRef.current === saveGeneration
      ) {
        setDraft(savedProfile);
        setSavedSharing({ medical: savedProfile.shareMedicalDataDuringSOS, ice: savedProfile.shareICEContactDuringSOS });
        setLastSavedAt(savedProfile.updatedAt);
        setStatus('ready');
      }

      return savedProfile;
    } catch (saveError: unknown) {
      if (
        isFocusedRef.current &&
        activeUserIdRef.current === userId &&
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
  }, [draft, hasLoadedProfile, isInitializing, loadedOwnerId, session]);

  // A new account must never see or save the previous account's draft, even
  // during the render before focus-effect cleanup and a fresh server response.
  const ownerVisible = !isInitializing && !!session && loadedOwnerId === session.user.id && hasLoadedProfile;

  return {
    draft: ownerVisible ? draft : EMPTY_EMERGENCY_PROFILE,
    setDraft,
    status: !isInitializing && !session ? 'unauthenticated' : !ownerVisible && status === 'ready' ? 'loading' : status,
    error: ownerVisible ? error : null,
    lastSavedAt: ownerVisible ? lastSavedAt : null,
    savedSharing: ownerVisible ? savedSharing : null,
    hasLoadedProfile: ownerVisible,
    reload: () => setReloadToken((current) => current + 1),
    save,
  };
}
