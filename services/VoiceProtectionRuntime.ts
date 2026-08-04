type SettingsChangedListener = (userId: string) => void;
type SOSRequestListener = (userId: string) => void;

const settingsChangedListeners = new Set<SettingsChangedListener>();
const sosRequestListeners = new Set<SOSRequestListener>();
let sosRequestLockedUntil = 0;

export const VoiceProtectionRuntime = {
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
