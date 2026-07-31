import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

const LEGACY_KEYS: readonly string[] = [];

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

export const VoiceProtectionStorage = {
  async get(userId: string): Promise<VoiceProtectionSettings> {
    const storedValue = await getAccountStorageItem(
      userId,
      'voice-protection',
      LEGACY_KEYS,
    );

    if (!storedValue) {
      return DEFAULT_VOICE_PROTECTION_SETTINGS;
    }

    try {
      const parsed = JSON.parse(storedValue) as Partial<VoiceProtectionSettings>;
      return {
        ...DEFAULT_VOICE_PROTECTION_SETTINGS,
        ...parsed,
      };
    } catch {
      return DEFAULT_VOICE_PROTECTION_SETTINGS;
    }
  },

  async save(userId: string, settings: VoiceProtectionSettings) {
    await setAccountStorageItem(
      userId,
      'voice-protection',
      JSON.stringify(settings),
      LEGACY_KEYS,
    );
  },
};
