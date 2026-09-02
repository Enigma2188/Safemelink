import type { SOSCompletionResult } from '@/services/SOSService';

type SettingsChangedListener = (userId: string) => void;
type SOSRequestListener = (userId: string) => void;
type RecognitionStartedListener = (userId: string) => void;
type SOSExecutionListener = (userId: string) => void;
type SOSCompletionListener = (userId: string, result: SOSCompletionResult) => void;
type SOSFailureListener = (userId: string, error: unknown) => void;

export const VOICE_SOS_COUNTDOWN_MS = 10_000;

const settingsChangedListeners = new Set<SettingsChangedListener>();
const sosRequestListeners = new Set<SOSRequestListener>();
const recognitionStartedListeners = new Set<RecognitionStartedListener>();
const sosExecutionStartedListeners = new Set<SOSExecutionListener>();
const sosCompletionListeners = new Set<SOSCompletionListener>();
const sosFailureListeners = new Set<SOSFailureListener>();
const backgroundWakeListeners = new Set<() => void>();
let sosRequestLockedUntil = 0;
let pendingSOSUserId: string | null = null;
let scheduledSOS: { userId: string; expiresAt: number } | null = null;
let sosExecutionInFlight = false;

const signalBackgroundTask = () => {
  backgroundWakeListeners.forEach((listener) => listener());
};

export const VoiceProtectionRuntime = {
  notifyRecognitionStarted(userId: string) {
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
    if (now < sosRequestLockedUntil) {
      console.info('[VoiceProtection] richiesta SOS duplicata ignorata');
      return false;
    }
    scheduledSOS = { userId, expiresAt: now + VOICE_SOS_COUNTDOWN_MS };
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
    sosExecutionStartedListeners.forEach((listener) => listener(userId));
  },

  notifySOSCompleted(userId: string, result: SOSCompletionResult) {
    sosCompletionListeners.forEach((listener) => listener(userId, result));
  },

  notifySOSFailed(userId: string, error: unknown) {
    sosFailureListeners.forEach((listener) => listener(userId, error));
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
};
