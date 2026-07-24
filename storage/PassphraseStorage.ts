import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

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
  async get(userId: string): Promise<SavedPassphrase | null> {
    const storedPassphrase = await getAccountStorageItem(
      userId,
      'passphrase',
      [PASSPHRASE_STORAGE_KEY],
    );

    if (!storedPassphrase) {
      return null;
    }

    return JSON.parse(storedPassphrase) as SavedPassphrase;
  },

  async save(userId: string, text: string) {
    const savedPassphrase: SavedPassphrase = {
      text: text.trim(),
      normalizedText: normalizePassphrase(text),
      savedAt: new Date().toISOString(),
    };

    await setAccountStorageItem(
      userId,
      'passphrase',
      JSON.stringify(savedPassphrase),
      [PASSPHRASE_STORAGE_KEY],
    );
    return savedPassphrase;
  },
};
