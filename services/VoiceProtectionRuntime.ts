type SettingsChangedListener = (userId: string) => void;
type SOSRequestListener = (userId: string) => void;
type RecognitionStartedListener = (userId: string) => void;

const settingsChangedListeners = new Set<SettingsChangedListener>();
const sosRequestListeners = new Set<SOSRequestListener>();
const recognitionStartedListeners = new Set<RecognitionStartedListener>();
let sosRequestLockedUntil = 0;
let pendingSOSUserId: string | null = null;

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
};
