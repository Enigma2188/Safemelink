type SettingsChangedListener = (userId: string) => void;
type SOSRequestListener = (userId: string) => void;
type RecognitionAvailabilityListener = () => void;
type RecognitionStartedListener = (userId: string) => void;

const settingsChangedListeners = new Set<SettingsChangedListener>();
const sosRequestListeners = new Set<SOSRequestListener>();
const recognitionAvailabilityListeners = new Set<RecognitionAvailabilityListener>();
const recognitionStartedListeners = new Set<RecognitionStartedListener>();
const recognitionSuspensions = new Set<symbol>();
let sosRequestLockedUntil = 0;

export const VoiceProtectionRuntime = {
  isRecognitionSuspended() {
    return recognitionSuspensions.size > 0;
  },

  suspendRecognition(owner: string) {
    const suspension = Symbol(owner);
    recognitionSuspensions.add(suspension);
    recognitionAvailabilityListeners.forEach((listener) => listener());
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      recognitionSuspensions.delete(suspension);
      recognitionAvailabilityListeners.forEach((listener) => listener());
    };
  },

  onRecognitionAvailabilityChanged(listener: RecognitionAvailabilityListener) {
    recognitionAvailabilityListeners.add(listener);
    return () => recognitionAvailabilityListeners.delete(listener);
  },

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
      console.warn('[VoiceProtection] richiesta SOS non inoltrata: listener non disponibile');
      return false;
    }

    sosRequestLockedUntil = now + 15_000;
    console.info('[VoiceProtection] parola riconosciuta: richiesta SOS inoltrata');
    sosRequestListeners.forEach((listener) => listener(userId));
    return sosRequestListeners.size > 0;
  },

  onSOSRequested(listener: SOSRequestListener) {
    sosRequestListeners.add(listener);
    return () => {
      sosRequestListeners.delete(listener);
    };
  },
};
