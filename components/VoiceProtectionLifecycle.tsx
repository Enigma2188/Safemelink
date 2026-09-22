import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { logVoiceEngineError } from '@/services/VoiceRecognitionCapabilities';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { stopVoiceRecognition } from '@/services/VoiceRecognitionStop';
import { withSafetyTimeout } from '@/services/SafetyOperation';
import { normalizePassphrase } from '@/storage/PassphraseStorage';
import { VoiceProtectionStorage } from '@/storage/VoiceProtectionStorage';

const MIN_RESTART_DELAY_MS = 1_500;
const MAX_RESTART_DELAY_MS = 30_000;
const RAPID_TERMINATION_MS = 3_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const VOICE_TRIGGER_COOLDOWN_MS = 30_000;

export function VoiceProtectionLifecycle() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);
  const accountCleanupPromiseRef = useRef<Promise<void>>(Promise.resolve());
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
  const lastVoiceTriggerAtRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeStopRef = useRef<Promise<boolean> | null>(null);
  const recognitionConfirmedRef = useRef(false);
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
    recognitionConfirmedRef.current = false;
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    startTimerRef.current = null;
    sosRequestedForSessionRef.current = false;
    if (!nativeStopRef.current) {
      const stopping = stopVoiceRecognition();
      nativeStopRef.current = stopping;
      void stopping.then(() => {
        if (nativeStopRef.current === stopping) nativeStopRef.current = null;
      });
    }
    return nativeStopRef.current;
  }, [clearRestartTimer]);

  const disableProtection = useCallback(async (
    targetUserId: string,
    category: 'permission' | 'readiness' | 'start' | 'circuit_breaker',
  ) => {
    if (activeUserIdRef.current !== targetUserId) return;
    shouldListenRef.current = false;
    cachedSettingsRef.current = null;
    recognitionReadyRef.current = false;
    stopRecognition();
    VoiceProtectionRuntime.setRecognitionFailure(targetUserId, category);
    VoiceProtectionRuntime.setRecognitionState(targetUserId, 'error');
    const generation = recognitionGenerationRef.current;

    try {
      await VoiceProtectionService.stop();
      const storedSettings = await VoiceProtectionStorage.get(targetUserId);
      if (generation !== recognitionGenerationRef.current || activeUserIdRef.current !== targetUserId) return;
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
    if (Platform.OS !== 'android') return;
    if (recognitionStartedRef.current) return;
    const recognitionGeneration = recognitionGenerationRef.current + 1;
    recognitionGenerationRef.current = recognitionGeneration;
    if (activeUserIdRef.current !== targetUserId) {
      return;
    }

    if (nativeStopRef.current) {
      const stopped = await nativeStopRef.current;
      if (recognitionGenerationRef.current !== recognitionGeneration || activeUserIdRef.current !== targetUserId) return;
      if (!stopped) {
        await disableProtection(targetUserId, 'start');
        return;
      }
    }

    let storedSettings = cachedSettingsRef.current;
    if (refreshConfiguration || !storedSettings) {
      try {
        storedSettings = await withSafetyTimeout(VoiceProtectionStorage.get(targetUserId), 'voice_settings', 5_000);
      } catch {
        if (recognitionGenerationRef.current === recognitionGeneration && activeUserIdRef.current === targetUserId) {
          shouldListenRef.current = false;
          VoiceProtectionRuntime.setRecognitionState(targetUserId, 'error');
        }
        console.warn('[VoiceProtection] impostazioni locali non disponibili');
        return;
      }
    }
    if (
      recognitionGenerationRef.current !== recognitionGeneration ||
      activeUserIdRef.current !== targetUserId
    ) {
      return;
    }
    cachedSettingsRef.current = storedSettings;
    const expired =
      storedSettings.expiresAt !== null &&
      new Date(storedSettings.expiresAt).getTime() <= Date.now();
    const passphrase = normalizePassphrase(storedSettings.passphrase);
    shouldListenRef.current = storedSettings.enabled && !expired && Boolean(passphrase);
    passphraseRef.current = passphrase;

    if (!shouldListenRef.current) {
      stopRecognition();
      if (VoiceProtectionRuntime.getRecognitionState(targetUserId) !== 'error') {
        VoiceProtectionRuntime.setRecognitionState(targetUserId, 'off');
      }
      return;
    }
    VoiceProtectionRuntime.setRecognitionState(targetUserId, 'starting');
    if (!VoiceProtectionService.isRunning()) {
      console.warn('[VoiceProtection] servizio foreground non disponibile');
      void disableProtection(targetUserId, 'start');
      return;
    }
    const readiness = recognitionReadyRef.current
      ? 'ready'
      : await VoiceProtectionService.getRecognitionReadiness('it-IT').catch(() => 'recognition_unavailable' as const);
    if (
      recognitionGenerationRef.current !== recognitionGeneration ||
      activeUserIdRef.current !== targetUserId ||
      !VoiceProtectionService.isRunning()
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
      permission = await withSafetyTimeout(ExpoSpeechRecognitionModule.getPermissionsAsync(), 'voice_permission', 5_000);
    } catch {
      if (recognitionGenerationRef.current !== recognitionGeneration || activeUserIdRef.current !== targetUserId) return;
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
    recognitionConfirmedRef.current = false;
    sosRequestedForSessionRef.current = false;
    recognitionStartedAtRef.current = Date.now();
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      if (recognitionGenerationRef.current === recognitionGeneration && !recognitionConfirmedRef.current) {
        void disableProtection(targetUserId, 'start');
      }
    }, 5_000);
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
      !VoiceProtectionService.isRunning()
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

    VoiceProtectionRuntime.setRecognitionState(currentUserId, 'retrying');

    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      void startRecognition(currentUserId, false);
    }, delayMs);
  }, [clearRestartTimer, disableProtection, startRecognition]);

  useSpeechRecognitionEvent('start', () => {
    recognitionStartedAtRef.current = Date.now();
    const currentUserId = activeUserIdRef.current;
    if (currentUserId && shouldListenRef.current && recognitionStartedRef.current && !nativeStopRef.current) {
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
      recognitionConfirmedRef.current = true;
      VoiceProtectionRuntime.notifyRecognitionStarted(currentUserId);
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (
      !shouldListenRef.current ||
      !recognitionConfirmedRef.current ||
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
    const now = Date.now();
    if (
      matches &&
      !sosRequestedForSessionRef.current &&
      now - lastVoiceTriggerAtRef.current >= VOICE_TRIGGER_COOLDOWN_MS
    ) {
      console.info('[VoiceProtection Lifecycle] VOICE_MATCH_OK');
      sosRequestedForSessionRef.current = true;
      lastVoiceTriggerAtRef.current = now;
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
    logVoiceEngineError(event.error);
    recognitionStartedRef.current = false;
    recognitionConfirmedRef.current = false;
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    startTimerRef.current = null;
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
    stopRecognition();
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
    recognitionConfirmedRef.current = false;
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    startTimerRef.current = null;
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

    accountCleanupPromiseRef.current = (async () => {
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
    let disposed = false;
    void accountCleanupPromiseRef.current.then(() => {
      if (!disposed && activeUserIdRef.current === userId) {
        return startRecognition(userId, true);
      }
      return undefined;
    }).catch(() => {
      console.warn('[VoiceProtection] bootstrap account non completato');
    });
    const removeSettingsListener = VoiceProtectionRuntime.onSettingsChanged(
      (changedUserId) => {
        if (changedUserId === activeUserIdRef.current) {
          if (VoiceProtectionRuntime.getRecognitionState(changedUserId) !== 'error') {
            VoiceProtectionRuntime.setRecognitionState(changedUserId, 'starting');
          }
          stopRecognition();
          cachedSettingsRef.current = null;
          recognitionReadyRef.current = false;
          consecutiveFailuresRef.current = 0;
          void startRecognition(changedUserId, true);
        }
      },
    );
    const removeStopListener = VoiceProtectionRuntime.onRecognitionStopRequested((targetUserId) => {
      if (targetUserId !== activeUserIdRef.current) return;
      shouldListenRef.current = false;
      stopRecognition();
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState !== 'active') {
          if (!VoiceProtectionService.isRunning()) {
            stopRecognition();
          }
          return;
        }
        const currentUserId = activeUserIdRef.current;
        if (currentUserId) {
          const generation = recognitionGenerationRef.current;
          void (async () => {
            // Android can stop the engine while JS is suspended; verify once on resume.
            if (recognitionStartedRef.current) {
              const state = await withSafetyTimeout(
                ExpoSpeechRecognitionModule.getStateAsync(), 'voice_state', 2_000,
              ).catch(() => null);
              if (disposed || activeUserIdRef.current !== currentUserId || recognitionGenerationRef.current !== generation) return;
              if (VoiceProtectionService.isRunning() && (state === 'recognizing' || state === 'starting')) return;
              stopRecognition();
            }
            cachedSettingsRef.current = null;
            recognitionReadyRef.current = false;
            consecutiveFailuresRef.current = 0;
            await startRecognition(currentUserId, true);
          })().catch(() => {
            if (!disposed && activeUserIdRef.current === currentUserId) {
              void disableProtection(currentUserId, 'start');
            }
          });
        }
      },
    );
    return () => {
      disposed = true;
      removeSettingsListener();
      removeStopListener();
      appStateSubscription.remove();
      shouldListenRef.current = false;
      stopRecognition();
      VoiceProtectionRuntime.setRecognitionState(userId, 'off');
    };
  }, [disableProtection, isInitializing, startRecognition, stopRecognition, userId]);

  return null;
}
