import AsyncStorage from '@react-native-async-storage/async-storage';

import { getAccountStorageKey } from '@/storage/AccountScopedStorage';

export type VoiceProtectionDurationMinutes = 30 | 60 | 120 | 0;

export type VoiceProtectionSettings = {
  enabled: boolean;
  enabledAt: string | null;
  expiresAt: string | null;
  durationMinutes: VoiceProtectionDurationMinutes;
  passphrase: string;
};

export const DEFAULT_VOICE_PROTECTION_SETTINGS: VoiceProtectionSettings = {
  enabled: false,
  enabledAt: null,
  expiresAt: null,
  durationMinutes: 60,
  passphrase: '',
};

// Storage survives APK updates. Treat it as untrusted data, not a TypeScript
// object: malformed authorization must never enable listening or erase expiry.
function readSettings(value: unknown): VoiceProtectionSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_VOICE_PROTECTION_SETTINGS };
  }
  const parsed = value as Record<string, unknown>;
  const validDate = (date: unknown): date is string =>
    typeof date === 'string' && date.trim().length > 0 && Number.isFinite(Date.parse(date));
  const duration = parsed.durationMinutes;
  const validDuration = duration === 0 || duration === 30 || duration === 60 || duration === 120;
  const passphrase = typeof parsed.passphrase === 'string' ? parsed.passphrase : '';
  const validExpiry = parsed.expiresAt === null || validDate(parsed.expiresAt);
  const enabled = parsed.enabled === true &&
    passphrase.trim().length > 0 && validDuration && validExpiry &&
    (duration === 0 || parsed.expiresAt !== null);
  return {
    enabled,
    enabledAt: enabled && validDate(parsed.enabledAt) ? parsed.enabledAt : null,
    expiresAt: enabled && validDate(parsed.expiresAt) ? parsed.expiresAt : null,
    durationMinutes: validDuration ? duration : DEFAULT_VOICE_PROTECTION_SETTINGS.durationMinutes,
    passphrase,
  };
}

export const VoiceProtectionStorage = {
  async get(userId: string): Promise<VoiceProtectionSettings> {
    const storedValue = await AsyncStorage.getItem(
      getAccountStorageKey(userId, 'voice-protection'),
    );

    if (!storedValue) {
      return { ...DEFAULT_VOICE_PROTECTION_SETTINGS };
    }

    try {
      return readSettings(JSON.parse(storedValue));
    } catch {
      return { ...DEFAULT_VOICE_PROTECTION_SETTINGS };
    }
  },

  async save(userId: string, settings: VoiceProtectionSettings) {
    await AsyncStorage.setItem(
      getAccountStorageKey(userId, 'voice-protection'),
      JSON.stringify(settings),
    );
  },
};
