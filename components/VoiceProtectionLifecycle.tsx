import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { normalizePassphrase } from '@/storage/PassphraseStorage';
import { VoiceProtectionStorage } from '@/storage/VoiceProtectionStorage';

const RESTART_DELAY_MS = 600;

export function VoiceProtectionLifecycle() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);
  const activeUserIdRef = useRef(userId);
  const passphraseRef = useRef('');
  const shouldListenRef = useRef(false);
  const recognitionStartedRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeUserIdRef.current = userId;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    clearRestartTimer();
    recognitionStartedRef.current = false;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }, [clearRestartTimer]);

  const startRecognition = useCallback(async (targetUserId: string) => {
    if (activeUserIdRef.current !== targetUserId || AppState.currentState !== 'active') {
      return;
    }

    const storedSettings = await VoiceProtectionStorage.get(targetUserId);
    const expired =
      storedSettings.expiresAt !== null &&
      new Date(storedSettings.expiresAt).getTime() <= Date.now();
    const passphrase = normalizePassphrase(storedSettings.passphrase);
    shouldListenRef.current = storedSettings.enabled && !expired && Boolean(passphrase);
    passphraseRef.current = passphrase;

    if (!shouldListenRef.current) {
      stopRecognition();
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      console.warn('[VoiceProtection] riconoscimento vocale non disponibile');
      return;
    }
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      console.warn('[VoiceProtection] modello locale di riconoscimento non disponibile');
      return;
    }

    const permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!permission.granted) {
      console.warn('[VoiceProtection] permesso microfono non disponibile');
      return;
    }
    if (recognitionStartedRef.current) {
      return;
    }

    recognitionStartedRef.current = true;
    console.info('[VoiceProtection] ascolto protetto foreground avviato');
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'it-IT',
        interimResults: true,
        maxAlternatives: 3,
        continuous: true,
        contextualStrings: [storedSettings.passphrase],
        requiresOnDeviceRecognition: true,
      });
    } catch (error) {
      recognitionStartedRef.current = false;
      console.warn('[VoiceProtection] avvio ascolto protetto fallito', {
        message: error instanceof Error ? error.message : 'errore sconosciuto',
      });
    }
  }, [stopRecognition]);

  const scheduleRestart = useCallback(() => {
    const currentUserId = activeUserIdRef.current;
    clearRestartTimer();
    if (!currentUserId || !shouldListenRef.current || AppState.currentState !== 'active') {
      return;
    }

    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      void startRecognition(currentUserId);
    }, RESTART_DELAY_MS);
  }, [clearRestartTimer, startRecognition]);

  useSpeechRecognitionEvent('start', () => {
    if (shouldListenRef.current) {
      console.info('[VoiceProtection] microfono in ascolto');
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!shouldListenRef.current || !event.isFinal) {
      return;
    }

    const expected = passphraseRef.current;
    const recognized = normalizePassphrase(event.results[0]?.transcript ?? '');
    if (
      expected &&
      recognized &&
      (recognized === expected || recognized.includes(expected))
    ) {
      const currentUserId = activeUserIdRef.current;
      if (currentUserId) {
        VoiceProtectionRuntime.requestSOS(currentUserId);
      }
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!shouldListenRef.current || event.error === 'aborted') {
      return;
    }
    console.warn('[VoiceProtection] ascolto protetto interrotto', {
      code: event.error,
      message: event.message,
    });
  });

  useSpeechRecognitionEvent('end', () => {
    if (!shouldListenRef.current) {
      return;
    }
    recognitionStartedRef.current = false;
    scheduleRestart();
  });

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

  useEffect(() => {
    if (isInitializing || !userId) {
      shouldListenRef.current = false;
      stopRecognition();
      return;
    }

    void startRecognition(userId);
    const removeSettingsListener = VoiceProtectionRuntime.onSettingsChanged(
      (changedUserId) => {
        if (changedUserId === activeUserIdRef.current) {
          stopRecognition();
          void startRecognition(changedUserId);
        }
      },
    );
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState !== 'active') {
          stopRecognition();
          return;
        }
        const currentUserId = activeUserIdRef.current;
        if (currentUserId) {
          void startRecognition(currentUserId);
        }
      },
    );

    return () => {
      removeSettingsListener();
      appStateSubscription.remove();
      shouldListenRef.current = false;
      stopRecognition();
    };
  }, [isInitializing, startRecognition, stopRecognition, userId]);

  return null;
}
