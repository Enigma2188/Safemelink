import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TrustedContact } from '@/services/ContactsService';
import type { PreferredSosChannel } from '@/services/SafeMeLinkContact';

const CONTACTS_STORAGE_KEY = 'safemelink.sos.trustedContacts';
const LEGACY_CONTACTS_STORAGE_KEY = 'safemelink.trustedContacts';

type StoredContact = {
  id?: string;
  remoteId?: string;
  name: string;
  number?: string;
  phone?: string;
  selected?: boolean;
  hasApp?: boolean;
  userId?: string;
  preferredChannel?: PreferredSosChannel;
};

const normalizeContacts = (contacts: StoredContact[]) =>
  contacts
    .map((contact) => ({
      id: contact.id ?? `${contact.name}-${contact.phone ?? contact.number ?? Date.now()}`,
      ...(contact.remoteId ? { remoteId: contact.remoteId } : {}),
      name: contact.name,
      phone: contact.phone ?? contact.number ?? '',
      hasApp: contact.hasApp ?? false,
      ...(contact.userId ? { userId: contact.userId } : {}),
      preferredChannel: contact.preferredChannel ?? 'sms',
    }))
    .filter((contact) => contact.name && (contact.phone || contact.userId))

export const ContactsStorage = {
  async getContacts(): Promise<TrustedContact[]> {
    const storedContacts =
      (await AsyncStorage.getItem(CONTACTS_STORAGE_KEY)) ??
      (await AsyncStorage.getItem(LEGACY_CONTACTS_STORAGE_KEY));

    if (!storedContacts) {
      return [];
    }

    const contacts = normalizeContacts(JSON.parse(storedContacts) as StoredContact[]);
    await ContactsStorage.saveContacts(contacts);

    return contacts;
  },

  async saveContacts(contacts: TrustedContact[]) {
    await AsyncStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  },
};
