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

const MIN_RESTART_DELAY_MS = 1_500;
const MAX_RESTART_DELAY_MS = 30_000;
const RAPID_TERMINATION_MS = 3_000;
const MAX_CONSECUTIVE_FAILURES = 5;

export function VoiceProtectionLifecycle() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);
  const activeUserIdRef = useRef(userId);
  const passphraseRef = useRef('');
  const cachedSettingsRef = useRef<Awaited<ReturnType<typeof VoiceProtectionStorage.get>> | null>(null);
  const recognitionReadyRef = useRef(false);
  const shouldListenRef = useRef(false);
  const recognitionStartedRef = useRef(false);
  const recognitionGenerationRef = useRef(0);
  const recognitionStartedAtRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const sosRequestedForSessionRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeUserIdRef.current = userId;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    recognitionGenerationRef.current += 1;
    clearRestartTimer();
    recognitionStartedRef.current = false;
    sosRequestedForSessionRef.current = false;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }, [clearRestartTimer]);

  const disableProtection = useCallback(async (
    targetUserId: string,
    category: 'permission' | 'readiness' | 'start' | 'circuit_breaker',
  ) => {
    shouldListenRef.current = false;
    cachedSettingsRef.current = null;
    recognitionReadyRef.current = false;
    stopRecognition();

    try {
      await VoiceProtectionService.stop();
      const storedSettings = await VoiceProtectionStorage.get(targetUserId);
      await VoiceProtectionStorage.save(targetUserId, {
        ...storedSettings,
        enabled: false,
        enabledAt: null,
        expiresAt: null,
      });
      VoiceProtectionRuntime.notifySettingsChanged(targetUserId);
    } catch {
      console.warn('[VoiceProtection] disattivazione automatica incompleta', { category });
      return;
    }

    console.warn('[VoiceProtection] protezione disattivata automaticamente', { category });
  }, [stopRecognition]);

  const startRecognition = useCallback(async (targetUserId: string, refreshConfiguration = false) => {
    const recognitionGeneration = recognitionGenerationRef.current + 1;
    recognitionGenerationRef.current = recognitionGeneration;
    if (
      activeUserIdRef.current !== targetUserId ||
      AppState.currentState !== 'active'
    ) {
      return;
    }

    let storedSettings = cachedSettingsRef.current;
    if (refreshConfiguration || !storedSettings) {
      try {
        storedSettings = await VoiceProtectionStorage.get(targetUserId);
        cachedSettingsRef.current = storedSettings;
      } catch {
        console.warn('[VoiceProtection] impostazioni locali non disponibili');
        return;
      }
    }
    if (
      recognitionGenerationRef.current !== recognitionGeneration ||
      activeUserIdRef.current !== targetUserId ||
      AppState.currentState !== 'active'
    ) {
      return;
    }
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
    const readiness = recognitionReadyRef.current
      ? 'ready'
      : await VoiceProtectionService.getRecognitionReadiness('it-IT');
    if (
      recognitionGenerationRef.current !== recognitionGeneration ||
      activeUserIdRef.current !== targetUserId ||
      AppState.currentState !== 'active'
    ) {
      return;
    }
    if (readiness !== 'ready' && readiness !== 'model_status_unknown') {
      console.warn('[VoiceProtection] ascolto locale non disponibile', { readiness });
      void disableProtection(targetUserId, 'readiness');
      return;
    }
    recognitionReadyRef.current = true;

    let permission;
    try {
      permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    } catch {
      console.warn('[VoiceProtection] verifica permesso microfono non riuscita');
      void disableProtection(targetUserId, 'permission');
      return;
    }
    if (recognitionGenerationRef.current !== recognitionGeneration) {
      return;
    }
    if (!permission.granted) {
      console.warn('[VoiceProtection] permesso microfono non disponibile');
      void disableProtection(targetUserId, 'permission');
      return;
    }
    if (recognitionStartedRef.current) {
      return;
    }

    recognitionStartedRef.current = true;
    sosRequestedForSessionRef.current = false;
    recognitionStartedAtRef.current = Date.now();
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'it-IT',
        interimResults: true,
        maxAlternatives: 3,
        continuous: true,
        contextualStrings: [storedSettings.passphrase],
        requiresOnDeviceRecognition: true,
      });
    } catch {
      recognitionStartedRef.current = false;
      console.warn('[VoiceProtection] avvio ascolto protetto fallito', {
        category: 'native_start',
      });
      void disableProtection(targetUserId, 'start');
    }
  }, [disableProtection, stopRecognition]);

  const scheduleRestart = useCallback((rapidTermination: boolean) => {
    const currentUserId = activeUserIdRef.current;
    clearRestartTimer();
    if (
      !currentUserId ||
      !shouldListenRef.current ||
      AppState.currentState !== 'active'
    ) {
      return;
    }

    consecutiveFailuresRef.current = rapidTermination
      ? consecutiveFailuresRef.current + 1
      : 0;
    if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
      console.warn('[VoiceProtection] arresto dopo interruzioni consecutive');
      void disableProtection(currentUserId, 'circuit_breaker');
      return;
    }

    const delayMs = Math.min(
      MAX_RESTART_DELAY_MS,
      MIN_RESTART_DELAY_MS * 2 ** consecutiveFailuresRef.current,
    );

    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      void startRecognition(currentUserId, false);
    }, delayMs);
  }, [clearRestartTimer, disableProtection, startRecognition]);

  useSpeechRecognitionEvent('start', () => {
    recognitionStartedAtRef.current = Date.now();
    const currentUserId = activeUserIdRef.current;
    if (currentUserId && shouldListenRef.current && recognitionStartedRef.current) {
      VoiceProtectionRuntime.notifyRecognitionStarted(currentUserId);
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (
      !shouldListenRef.current ||
      !event.isFinal
    ) {
      return;
    }

    consecutiveFailuresRef.current = 0;

    const expected = passphraseRef.current;
    const matches = event.results.some((result) => {
      const recognized = normalizePassphrase(result.transcript ?? '');
      return Boolean(
        expected &&
        recognized &&
        (recognized === expected || ` ${recognized} `.includes(` ${expected} `)),
      );
    });
    if (matches && !sosRequestedForSessionRef.current) {
      console.info('[VoiceProtection Lifecycle] VOICE_MATCH_OK');
      sosRequestedForSessionRef.current = true;
      const currentUserId = activeUserIdRef.current;
      if (currentUserId) {
        VoiceProtectionRuntime.requestSOS(currentUserId);
      }
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (
      !shouldListenRef.current ||
      !recognitionStartedRef.current
    ) {
      return;
    }
    console.warn('[VoiceProtection] ascolto protetto interrotto', {
      code: event.error,
    });
    recognitionStartedRef.current = false;
    if (
      event.error === 'language-not-supported' ||
      event.error === 'not-allowed' ||
      event.error === 'service-not-allowed'
    ) {
      const currentUserId = activeUserIdRef.current;
      if (currentUserId) {
        void disableProtection(
          currentUserId,
          event.error === 'language-not-supported' ? 'readiness' : 'permission',
        );
      }
      return;
    }
    scheduleRestart(Date.now() - recognitionStartedAtRef.current < RAPID_TERMINATION_MS);
  });

  useSpeechRecognitionEvent('end', () => {
    if (
      !shouldListenRef.current ||
      !recognitionStartedRef.current
    ) {
      return;
    }
    recognitionStartedRef.current = false;
    scheduleRestart(Date.now() - recognitionStartedAtRef.current < RAPID_TERMINATION_MS);
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
      try {
        await VoiceProtectionService.stop();
        const previousSettings = await VoiceProtectionStorage.get(previousUserId);
        await VoiceProtectionStorage.save(previousUserId, {
          ...previousSettings,
          enabled: false,
          enabledAt: null,
          expiresAt: null,
        });
      } catch {
        console.warn('[VoiceProtection] cleanup cambio account non completato');
      }
    })();
  }, [isInitializing, userId]);

  useEffect(() => {
    if (isInitializing || !userId) {
      shouldListenRef.current = false;
      stopRecognition();
      return;
    }

    cachedSettingsRef.current = null;
    recognitionReadyRef.current = false;
    consecutiveFailuresRef.current = 0;
    void startRecognition(userId, true);
    const removeSettingsListener = VoiceProtectionRuntime.onSettingsChanged(
      (changedUserId) => {
        if (changedUserId === activeUserIdRef.current) {
          stopRecognition();
          cachedSettingsRef.current = null;
          recognitionReadyRef.current = false;
          consecutiveFailuresRef.current = 0;
          void startRecognition(changedUserId, true);
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
          cachedSettingsRef.current = null;
          recognitionReadyRef.current = false;
          consecutiveFailuresRef.current = 0;
          void startRecognition(currentUserId, true);
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
