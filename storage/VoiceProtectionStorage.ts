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

export const VoiceProtectionStorage = {
  async get(userId: string): Promise<VoiceProtectionSettings> {
    const storedValue = await AsyncStorage.getItem(
      getAccountStorageKey(userId, 'voice-protection'),
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
    await AsyncStorage.setItem(
      getAccountStorageKey(userId, 'voice-protection'),
      JSON.stringify(settings),
    );
  },
};
