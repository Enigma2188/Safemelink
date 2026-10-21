import type { SOSCompletionResult } from '@/services/SOSService';
import { VoiceSOSRecoveryStorage, type VoiceSOSAttempt } from '@/storage/VoiceSOSRecoveryStorage';

type SettingsChangedListener = (userId: string) => void;
type SOSRequestListener = (userId: string) => void;
type RecognitionStartedListener = (userId: string) => void;
export type VoiceRecognitionState = 'off' | 'starting' | 'listening' | 'retrying' | 'error' | 'verifying_sos' | 'sos_active' | 'sos_uncertain';
type RecognitionStateListener = (userId: string, state: VoiceRecognitionState) => void;
const recognitionStateListeners = new Set<RecognitionStateListener>();
const recognitionStopListeners = new Set<SettingsChangedListener>();
const recognitionStoppedAccounts = new Set<string>();
const recognitionBlockedAccounts = new Set<string>();
let recognitionStatus: { userId: string; state: VoiceRecognitionState } | null = null;
let recognitionFailure: { userId: string; category: 'permission' | 'readiness' | 'start' | 'circuit_breaker' } | null = null;
type SOSExecutionListener = (userId: string) => void;
type SOSCompletionListener = (userId: string, result: SOSCompletionResult) => void;
type SOSFailureListener = (userId: string, error: unknown) => void;
type SOSClosedListener = (userId: string) => void;

export const VOICE_SOS_COUNTDOWN_MS = 10_000;

const settingsChangedListeners = new Set<SettingsChangedListener>();
const sosRequestListeners = new Set<SOSRequestListener>();
const recognitionStartedListeners = new Set<RecognitionStartedListener>();
const sosExecutionStartedListeners = new Set<SOSExecutionListener>();
const sosCompletionListeners = new Set<SOSCompletionListener>();
const sosFailureListeners = new Set<SOSFailureListener>();
const sosClosedListeners = new Set<SOSClosedListener>();
const backgroundWakeListeners = new Set<() => void>();
let sosRequestLockedUntil = 0;
let sosRequestLockOwner: string | null = null;
let pendingSOSUserId: string | null = null;
let scheduledSOS: { userId: string; expiresAt: number } | null = null;
let sosExecutionInFlight = false;
const activeVoiceEmergencies = new Map<string, VoiceSOSAttempt>();
let attemptSequence = 0;
const persistAttempt = (userId: string) => VoiceSOSRecoveryStorage.save(userId, activeVoiceEmergencies.get(userId) ?? null);

const signalBackgroundTask = () => {
  backgroundWakeListeners.forEach((listener) => listener());
};

export const VoiceProtectionRuntime = {
  isSOSSuspended(userId: string) { return activeVoiceEmergencies.has(userId); },
  getSOSAttempt(userId: string) { const value = activeVoiceEmergencies.get(userId); return value ? {...value} : null; },
  restoreSOSAttempt(userId: string, attempt: VoiceSOSAttempt) {
    if (!activeVoiceEmergencies.has(userId)) activeVoiceEmergencies.set(userId, {...attempt});
  },
  adoptVerifiedActive(userId: string, remoteId: string) {
    if (activeVoiceEmergencies.has(userId)) return;
    activeVoiceEmergencies.set(userId, {attemptId:`remote:${remoteId}`,eventId:null,remoteId,phase:'active'});
    void persistAttempt(userId).catch(() => console.warn('[VoiceProtection] recovery journal unavailable'));
  },
  restoreSOSSuspension(userId: string, eventId: string) {
    if (!activeVoiceEmergencies.has(userId)) activeVoiceEmergencies.set(userId, {attemptId:`restored:${eventId}`,eventId,remoteId:null,phase:'active'});
  },
  async clearVerifiedSuspension(userId: string, attemptId: string | null) {
    const current = activeVoiceEmergencies.get(userId);
    if (current && current.attemptId !== attemptId) return false;
    activeVoiceEmergencies.delete(userId);
    await VoiceSOSRecoveryStorage.save(userId, null);
    return !activeVoiceEmergencies.has(userId);
  },
  persistSOSAttempt: persistAttempt,
  blockRecognition(userId: string) { recognitionBlockedAccounts.add(userId); },
  getRecognitionState(userId: string | null): VoiceRecognitionState {
    return recognitionStatus?.userId === userId ? recognitionStatus.state : 'off';
  },

  setRecognitionState(userId: string, state: VoiceRecognitionState) {
    if (recognitionStoppedAccounts.has(userId) && state !== 'off') return;
    if (recognitionBlockedAccounts.has(userId) && state !== 'error' && state !== 'off') return;
    if (state === 'off' || state === 'listening') recognitionFailure = null;
    if (recognitionStatus?.state !== state || recognitionStatus?.userId !== userId) {
      console.info('[VoiceProtection] listener', { state });
    }
    recognitionStatus = { userId, state };
    recognitionStateListeners.forEach((listener) => listener(userId, state));
  },

  setRecognitionFailure(userId: string, category: 'permission' | 'readiness' | 'start' | 'circuit_breaker') {
    recognitionFailure = { userId, category };
  },

  getRecognitionFailureMessage(userId: string | null) {
    if (recognitionFailure?.userId !== userId) return '';
    switch (recognitionFailure?.category) {
      case 'start': return 'NON IN ASCOLTO. Il servizio o il riconoscitore vocale non è disponibile. Riprova ad attivare la protezione.';
      case 'readiness': return 'Il motore non riesce a usare l’italiano offline. Controlla il servizio vocale e il modello italiano nelle impostazioni, poi riprova.';
      case 'permission': return 'Il microfono o il servizio vocale non è autorizzato. Controlla i permessi nelle impostazioni Android.';
      case 'circuit_breaker': return 'Il motore vocale si interrompe ripetutamente. Aggiorna il servizio vocale e controlla la lingua italiana offline prima di riprovare.';
      default: return '';
    }
  },

  onRecognitionStateChanged(listener: RecognitionStateListener) {
    recognitionStateListeners.add(listener);
    return () => { recognitionStateListeners.delete(listener); };
  },

  requestRecognitionStop(userId: string) {
    recognitionStoppedAccounts.add(userId);
    recognitionStopListeners.forEach((listener) => listener(userId));
    VoiceProtectionRuntime.setRecognitionState(userId, 'off');
  },

  allowRecognitionStart(userId: string) {
    recognitionStoppedAccounts.delete(userId);
    recognitionBlockedAccounts.delete(userId);
  },

  isRecognitionStopped(userId: string) {
    return recognitionStoppedAccounts.has(userId) || recognitionBlockedAccounts.has(userId);
  },

  onRecognitionStopRequested(listener: SettingsChangedListener) {
    recognitionStopListeners.add(listener);
    return () => { recognitionStopListeners.delete(listener); };
  },

  notifyRecognitionStarted(userId: string) {
    if (VoiceProtectionRuntime.isRecognitionStopped(userId)) return;
    VoiceProtectionRuntime.setRecognitionState(userId, 'listening');
    recognitionStartedListeners.forEach((listener) => listener(userId));
  },

  waitForRecognitionStart(userId: string, timeoutMs: number) {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (started: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        recognitionStartedListeners.delete(listener);
        resolve(started);
      };
      const listener: RecognitionStartedListener = (startedUserId) => {
        if (startedUserId === userId) {
          finish(true);
        }
      };
      const timeoutId = setTimeout(() => finish(false), timeoutMs);
      recognitionStartedListeners.add(listener);
    });
  },

  notifySettingsChanged(userId: string) {
    settingsChangedListeners.forEach((listener) => listener(userId));
  },

  onSettingsChanged(listener: SettingsChangedListener) {
    settingsChangedListeners.add(listener);
    return () => {
      settingsChangedListeners.delete(listener);
    };
  },

  requestSOS(userId: string) {
    const now = Date.now();
    if (now < sosRequestLockedUntil || activeVoiceEmergencies.has(userId) || sosExecutionInFlight) {
      console.info('[VoiceProtection] richiesta SOS duplicata ignorata');
      return false;
    }
    scheduledSOS = { userId, expiresAt: now + VOICE_SOS_COUNTDOWN_MS };
    sosRequestLockOwner = userId;
    signalBackgroundTask();
    if (sosRequestListeners.size === 0) {
      pendingSOSUserId = userId;
      sosRequestLockedUntil = now + 15_000;
      console.info('[VoiceProtection Runtime] VOICE_REQUEST_QUEUED');
      return true;
    }

    pendingSOSUserId = null;
    sosRequestLockedUntil = now + 15_000;
    console.info('[VoiceProtection Runtime] VOICE_SOS_REQUESTED');
    sosRequestListeners.forEach((listener) => listener(userId));
    return sosRequestListeners.size > 0;
  },

  onSOSRequested(listener: SOSRequestListener) {
    sosRequestListeners.add(listener);
    const pendingUserId = pendingSOSUserId;
    if (pendingUserId) {
      pendingSOSUserId = null;
      queueMicrotask(() => {
        if (sosRequestListeners.has(listener)) {
          listener(pendingUserId);
        } else if (!pendingSOSUserId) {
          pendingSOSUserId = pendingUserId;
          console.info('[VoiceProtection Runtime] VOICE_REQUEST_QUEUED');
        }
      });
    }
    return () => {
      sosRequestListeners.delete(listener);
    };
  },

  getScheduledSOS(userId: string) {
    return scheduledSOS?.userId === userId ? { ...scheduledSOS } : null;
  },

  cancelScheduledSOS(userId: string) {
    if (sosExecutionInFlight) {
      return false;
    }
    if (scheduledSOS?.userId === userId) {
      scheduledSOS = null;
      signalBackgroundTask();
    }
    return true;
  },

  expediteScheduledSOS(userId: string) {
    if (scheduledSOS?.userId === userId && !sosExecutionInFlight) {
      scheduledSOS = { userId, expiresAt: Date.now() };
      signalBackgroundTask();
      return true;
    }
    return false;
  },

  claimDueSOS(userId: string) {
    if (
      sosExecutionInFlight ||
      scheduledSOS?.userId !== userId ||
      scheduledSOS.expiresAt > Date.now()
    ) {
      return false;
    }
    pendingSOSUserId = null;
    scheduledSOS = null;
    sosExecutionInFlight = true;
    return true;
  },

  finishSOSExecution() {
    sosExecutionInFlight = false;
  },

  getBackgroundWaitMs(userId: string, maximumMs: number) {
    if (scheduledSOS?.userId !== userId || sosExecutionInFlight) {
      return maximumMs;
    }
    return Math.max(0, Math.min(maximumMs, scheduledSOS.expiresAt - Date.now()));
  },

  waitForBackgroundWake(timeoutMs: number) {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        backgroundWakeListeners.delete(finish);
        resolve();
      };
      const timeoutId = setTimeout(finish, Math.max(0, timeoutMs));
      backgroundWakeListeners.add(finish);
    });
  },

  wakeBackgroundTask() {
    signalBackgroundTask();
  },

  notifySOSExecutionStarted(userId: string) {
    const attemptId = `voice:${Date.now()}:${++attemptSequence}:${Math.random().toString(36).slice(2)}`;
    activeVoiceEmergencies.set(userId, {attemptId,eventId:null,remoteId:null,phase:'pending'});
    VoiceProtectionRuntime.setRecognitionState(userId, 'sos_active');
    void persistAttempt(userId).catch(() => console.warn('[VoiceProtection] recovery journal unavailable'));
    sosExecutionStartedListeners.forEach((listener) => listener(userId));
    return attemptId;
  },

  notifySOSCompleted(userId: string, result: SOSCompletionResult, attemptId?: string) {
    const current = activeVoiceEmergencies.get(userId);
    if (!current || current.attemptId !== attemptId) return;
    // A fulfilled local pipeline is not acknowledgement of the legacy INSERT.
    // Neither timeout nor an ambiguous creation error proves that it rolled back.
    const uncertainCreation = result.pushResult?.reason === 'remote_creation_timeout' ||
      result.pushResult?.reason === 'remote_creation_error';
    activeVoiceEmergencies.set(userId, {
      ...current,
      eventId: result.event?.id ?? current.eventId,
      remoteId: result.event?.remoteSosId ?? result.pushResult?.sosId ?? current.remoteId,
      phase: uncertainCreation ? 'unknown' : 'active',
    });
    void persistAttempt(userId).catch(() => console.warn('[VoiceProtection] recovery journal unavailable'));
    if (uncertainCreation) VoiceProtectionRuntime.setRecognitionState(userId, 'sos_uncertain');
    sosCompletionListeners.forEach((listener) => listener(userId, result));
  },

  notifySOSFailed(userId: string, error: unknown, attemptId?: string) {
    const current = activeVoiceEmergencies.get(userId);
    if (!current || current.attemptId !== attemptId) return;
    // A known active event must never be treated as a failed activation.
    if (current.eventId) return;
    // A thrown launch can follow remote side effects. Absence of a completion
    // response is not proof of absence of an SOS; keep the suspension fail-closed.
    if (activeVoiceEmergencies.has(userId)) {
      activeVoiceEmergencies.set(userId, {...current,phase:'unknown'});
      void persistAttempt(userId).catch(() => console.warn('[VoiceProtection] recovery journal unavailable'));
      VoiceProtectionRuntime.setRecognitionState(userId, 'sos_uncertain');
    }
    sosFailureListeners.forEach((listener) => listener(userId, error));
  },

  notifySOSClosed(userId: string, eventId?: string, remoteId?: string) {
    const activeId = activeVoiceEmergencies.get(userId);
    // Home supplies remoteId only after server-confirmed terminal state.
    // That proof closes this SAME remote attempt even if its creation was uncertain.
    // A local-only close must never release an unknown/pending legacy INSERT.
    const remoteMatches = Boolean(remoteId && activeId?.remoteId === remoteId);
    const localMatches = Boolean(eventId && activeId?.eventId === eventId);
    const correlated = !activeId || (!(activeId.remoteId && remoteId && activeId.remoteId !== remoteId) &&
      (remoteMatches || (activeId.phase === 'active' && localMatches)));
    if (!correlated && !remoteId) return;
    if (activeId && !activeId.remoteId && localMatches && remoteId) {
      // Home proved this SAME event terminal. Retain uncertainty until inspect()
      // verifies the bound remote ID and checks for other open emergencies.
      activeVoiceEmergencies.set(userId, { ...activeId, remoteId });
      void persistAttempt(userId).catch(() => console.warn('[VoiceProtection] recovery journal unavailable'));
    }
    // A verified close of another/local-rebound event is still a reason to
    // re-inspect the account. It is NOT permission to discard the old journal.
    if (correlated) {
      activeVoiceEmergencies.delete(userId);
      if (activeId) void persistAttempt(userId).catch(() => console.warn('[VoiceProtection] recovery journal unavailable'));
    }
    if (correlated && sosRequestLockOwner === userId && !sosExecutionInFlight && !scheduledSOS) {
      sosRequestLockedUntil = 0;
      sosRequestLockOwner = null;
    }
    sosClosedListeners.forEach((listener) => listener(userId));
  },

  onSOSExecutionStarted(listener: SOSExecutionListener) {
    sosExecutionStartedListeners.add(listener);
    return () => sosExecutionStartedListeners.delete(listener);
  },

  onSOSCompleted(listener: SOSCompletionListener) {
    sosCompletionListeners.add(listener);
    return () => sosCompletionListeners.delete(listener);
  },

  onSOSFailed(listener: SOSFailureListener) {
    sosFailureListeners.add(listener);
    return () => sosFailureListeners.delete(listener);
  },

  onSOSClosed(listener: SOSClosedListener) {
    sosClosedListeners.add(listener);
    return () => sosClosedListeners.delete(listener);
  },
};
