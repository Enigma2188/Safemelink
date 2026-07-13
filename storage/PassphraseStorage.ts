import AsyncStorage from '@react-native-async-storage/async-storage';

const PASSPHRASE_STORAGE_KEY = 'safemelink.passphrase.value';

export type SavedPassphrase = {
  text: string;
  normalizedText: string;
  savedAt: string;
};

export const normalizePassphrase = (value: string) =>
  value
    .toLocaleLowerCase('it-IT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const PassphraseStorage = {
  async get(): Promise<SavedPassphrase | null> {
    const storedPassphrase = await AsyncStorage.getItem(PASSPHRASE_STORAGE_KEY);

    if (!storedPassphrase) {
      return null;
    }

    return JSON.parse(storedPassphrase) as SavedPassphrase;
  },

  async save(text: string) {
    const savedPassphrase: SavedPassphrase = {
      text: text.trim(),
      normalizedText: normalizePassphrase(text),
      savedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(PASSPHRASE_STORAGE_KEY, JSON.stringify(savedPassphrase));
    return savedPassphrase;
  },
};
