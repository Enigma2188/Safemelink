import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { logVoiceEngineError } from '@/services/VoiceRecognitionCapabilities';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { stopVoiceRecognition } from '@/services/VoiceRecognitionStop';
import { withSafetyTimeout } from '@/services/SafetyOperation';
import { normalizePassphrase } from '@/storage/PassphraseStorage';
import { VoiceProtectionStorage } from '@/storage/VoiceProtectionStorage';
import { SOSStorage } from '@/storage/SOSStorage';
import { VoiceSOSRecovery } from '@/services/VoiceSOSRecovery';

const MIN_RESTART_DELAY_MS = 1_500;
const MAX_RESTART_DELAY_MS = 30_000;
const RAPID_TERMINATION_MS = 3_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const VOICE_TRIGGER_COOLDOWN_MS = 30_000;
let recognitionOwnerSequence = 0;

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
  const postSOSRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionConfirmedRef = useRef(false);
  const sosSuspendedRef = useRef(false);
  const recognitionOwnerRef = useRef(0);
  const recognitionAccountRef = useRef<string | null>(null);
  const recoveryVerifiedRef = useRef(false);
  if (!recognitionOwnerRef.current) recognitionOwnerRef.current = ++recognitionOwnerSequence;
  activeUserIdRef.current = userId;
  // The local Android config plugin tags events at native emission time.
  // Events from a previous recognizer (including already queued bridge events)
  // are never authority for the current owner/generation.
  const isCurrentNativeEvent = (event: unknown) => {
    const generation = (event as { safemelinkGeneration?: unknown } | null)?.safemelinkGeneration;
    return recognitionAccountRef.current === activeUserIdRef.current && typeof generation === 'string' &&
      generation === recognitionOwnerRef.current + ':' + recognitionGenerationRef.current;
  };

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearPostSOSRecoveryTimer = useCallback(() => {
    if (postSOSRecoveryTimerRef.current) {
      clearTimeout(postSOSRecoveryTimerRef.current);
      postSOSRecoveryTimerRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    recognitionGenerationRef.current += 1;
    clearRestartTimer();
    clearPostSOSRecoveryTimer();
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
  }, [clearPostSOSRecoveryTimer, clearRestartTimer]);

  // Layout cleanup invalidates a queued native start before passive account effects.
  useLayoutEffect(() => {
    return () => { shouldListenRef.current = false; stopRecognition(); };
  }, [userId, stopRecognition]);

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
    VoiceProtectionRuntime.blockRecognition(targetUserId);
    VoiceProtectionRuntime.setRecognitionState(targetUserId, 'error');
    const generation = recognitionGenerationRef.current;

    try {
      await VoiceProtectionService.stop();
      if (generation !== recognitionGenerationRef.current || activeUserIdRef.current !== targetUserId) return;
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
    if (activeUserIdRef.current !== targetUserId) return;
    if (VoiceProtectionRuntime.isRecognitionStopped(targetUserId)) {
      shouldListenRef.current = false;
      stopRecognition();
      return;
    }
    if (recognitionStartedRef.current) return;
    const recognitionGeneration = recognitionGenerationRef.current + 1;
    recognitionGenerationRef.current = recognitionGeneration;
    const current = () => recognitionGenerationRef.current === recognitionGeneration &&
      activeUserIdRef.current === targetUserId && !VoiceProtectionRuntime.isRecognitionStopped(targetUserId);
    if (activeUserIdRef.current !== targetUserId) {
      return;
    }

    if (nativeStopRef.current) {
      const stopped = await nativeStopRef.current;
      if (!current()) return;
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
    // Normal engine restarts reuse this authorization; no network polling loop.
    if (refreshConfiguration || !recoveryVerifiedRef.current ||
      VoiceProtectionRuntime.isSOSSuspended(targetUserId) || sosSuspendedRef.current) {
      recoveryVerifiedRef.current = false;
      // Cold/remount recovery: fail closed if the persisted SOS state is unavailable.
      let events;
      try {
        events = await withSafetyTimeout(SOSStorage.listEvents(targetUserId), 'voice_sos_recovery', 5_000);
        if (!Array.isArray(events) || events.some(event => !event || typeof event.id !== 'string')) {
          throw new Error('Invalid SOS recovery state');
        }
      } catch {
        if (current()) { stopRecognition(); VoiceProtectionRuntime.setRecognitionState(targetUserId, 'error'); }
        return;
      }
      if (!current()) return;
      VoiceProtectionRuntime.setRecognitionState(targetUserId, 'verifying_sos');
      const recovery = await withSafetyTimeout(VoiceSOSRecovery.inspect(targetUserId, events), 'voice_server_recovery', 12_000)
        .catch(() => ({kind:'uncertain' as const,attemptId:null}));
      if (!current()) return;
      if ('attempt' in recovery && recovery.attempt) VoiceProtectionRuntime.restoreSOSAttempt(targetUserId, recovery.attempt);
      if (recovery.kind !== 'clear') {
        if ('remoteActiveId' in recovery && recovery.remoteActiveId) {
          VoiceProtectionRuntime.adoptVerifiedActive(targetUserId, recovery.remoteActiveId);
        }
        sosSuspendedRef.current = true;
        stopRecognition();
        VoiceProtectionRuntime.setRecognitionState(targetUserId, recovery.kind === 'active' ? 'sos_active' : 'sos_uncertain');
        return;
      }
      const released = await VoiceProtectionRuntime.clearVerifiedSuspension(targetUserId, recovery.attemptId).catch(() => false);
      if (!current()) return;
      if (!released) { VoiceProtectionRuntime.setRecognitionState(targetUserId, 'sos_uncertain'); return; }
      sosSuspendedRef.current = false;
      recoveryVerifiedRef.current = true;
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
      !current() ||
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
    if (!current() || !shouldListenRef.current || !VoiceProtectionService.isRunning()) {
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
    recognitionAccountRef.current = targetUserId;
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
        // Private metadata consumed/removed by withLocalSpeechRecognition;
        // it is NOT forwarded to Android's RecognizerIntent extras.
        androidIntentOptions: {
          safemelinkGeneration: recognitionOwnerRef.current + ':' + recognitionGeneration,
        } as unknown as ExpoSpeechRecognitionOptions['androidIntentOptions'],
      });
    } catch {
      recognitionStartedRef.current = false;
      console.warn('[VoiceProtection] avvio ascolto protetto fallito', {
        category: 'native_start',
      });
      void disableProtection(targetUserId, 'start');
    }
  }, [disableProtection, stopRecognition]);

  const scheduleRestart = useCallback((rapidTermination: boolean, technicalError = false) => {
    const currentUserId = activeUserIdRef.current;
    clearRestartTimer();
    if (
      !currentUserId ||
      !shouldListenRef.current ||
      !VoiceProtectionService.isRunning()
    ) {
      return;
    }

    consecutiveFailuresRef.current = (rapidTermination || technicalError)
      ? consecutiveFailuresRef.current + 1
      : consecutiveFailuresRef.current;
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

  useSpeechRecognitionEvent('start', (event) => {
    if (!isCurrentNativeEvent(event)) return;
    recognitionStartedAtRef.current = Date.now();
    const currentUserId = activeUserIdRef.current;
    if (currentUserId && VoiceProtectionRuntime.isRecognitionStopped(currentUserId)) {
      shouldListenRef.current = false;
      stopRecognition();
      return;
    }
    if (currentUserId && shouldListenRef.current && recognitionStartedRef.current && !nativeStopRef.current) {
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
      recognitionConfirmedRef.current = true;
      VoiceProtectionRuntime.notifyRecognitionStarted(currentUserId);
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!isCurrentNativeEvent(event)) return;
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
    if (!isCurrentNativeEvent(event)) return;
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
    const normalSilence = event.error === 'no-speech' || event.error === 'speech-timeout';
    scheduleRestart(!normalSilence && Date.now() - recognitionStartedAtRef.current < RAPID_TERMINATION_MS, !normalSilence);
  });

  useSpeechRecognitionEvent('end', (event) => {
    if (!isCurrentNativeEvent(event)) return;
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
        if (activeUserIdRef.current === previousUserId) return;
        const previousSettings = await VoiceProtectionStorage.get(previousUserId);
        if (activeUserIdRef.current === previousUserId) return;
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
    sosSuspendedRef.current = VoiceProtectionRuntime.isSOSSuspended(userId);
    recoveryVerifiedRef.current = false;
    stopRecognition();
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
          if (VoiceProtectionRuntime.isRecognitionStopped(changedUserId)) {
            shouldListenRef.current = false;
            stopRecognition();
            return;
          }
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
    const removeSOSExecutionListener = VoiceProtectionRuntime.onSOSExecutionStarted((executionUserId) => {
      if (executionUserId !== activeUserIdRef.current) return;
      sosSuspendedRef.current = true;
      recoveryVerifiedRef.current = false;
      // Release the recognizer while the SOS pipeline uses the microphone/location.
      stopRecognition();
    });
    const recoverAfterSOS = (executionUserId: string) => {
      if (VoiceProtectionRuntime.isSOSSuspended(executionUserId)) return;
      const wasSuspended = sosSuspendedRef.current || !recognitionStartedRef.current;
      if (executionUserId === activeUserIdRef.current) sosSuspendedRef.current = false;
      if (!wasSuspended || executionUserId !== activeUserIdRef.current ||
        disposed || VoiceProtectionRuntime.isRecognitionStopped(executionUserId) ||
        VoiceProtectionRuntime.isSOSSuspended(executionUserId)) return;
      // Invalidate an in-flight persisted-state read taken before this close.
      stopRecognition();
      // A confirmed close ends the old emergency, not a new voice cooldown.
      lastVoiceTriggerAtRef.current = 0;
      consecutiveFailuresRef.current = 0;
      clearPostSOSRecoveryTimer();
      VoiceProtectionRuntime.setRecognitionState(executionUserId, 'retrying');
      postSOSRecoveryTimerRef.current = setTimeout(() => {
        postSOSRecoveryTimerRef.current = null;
        if (disposed || activeUserIdRef.current !== executionUserId) return;
        void startRecognition(executionUserId, true);
      }, 1_500);
    };
    const removeSOSClosedListener = VoiceProtectionRuntime.onSOSClosed((executionUserId) => {
      recoverAfterSOS(executionUserId);
    });
    const removeSOSFailedListener = VoiceProtectionRuntime.onSOSFailed((executionUserId) => {
      recoverAfterSOS(executionUserId);
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
      removeSOSExecutionListener();
      removeSOSClosedListener();
      removeSOSFailedListener();
      clearPostSOSRecoveryTimer();
      appStateSubscription.remove();
      shouldListenRef.current = false;
      stopRecognition();
      VoiceProtectionRuntime.setRecognitionState(userId, 'off');
    };
  }, [clearPostSOSRecoveryTimer, disableProtection, isInitializing, startRecognition, stopRecognition, userId]);

  return null;
}
