import type { TrustedContact } from '@/services/ContactsService';
import type { PreferredSosChannel } from '@/services/SafeMeLinkContact';
import {
  getAccountStorageItem,
  setAccountStorageItem,
} from '@/storage/AccountScopedStorage';

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

const normalizeContacts = (contacts: StoredContact[]) => {
  const uniqueContacts = new Map<string, TrustedContact>();

  for (const contact of contacts) {
    const phone = contact.phone ?? contact.number ?? '';
    const normalizedPhone = phone.replace(/[^\d+]/g, '');
    const normalizedContact: TrustedContact = {
      id: contact.id ?? `${contact.name}-${normalizedPhone || 'linked'}`,
      ...(contact.remoteId ? { remoteId: contact.remoteId } : {}),
      name: contact.name,
      phone,
      hasApp: contact.hasApp ?? false,
      ...(contact.userId ? { userId: contact.userId } : {}),
      preferredChannel: contact.preferredChannel ?? 'sms',
    };

    if (!normalizedContact.name || (!normalizedContact.phone && !normalizedContact.userId)) {
      continue;
    }

    const identity = normalizedContact.remoteId
      ? `remote:${normalizedContact.remoteId}`
      : normalizedContact.userId
        ? `linked:${normalizedContact.userId}`
        : `local:${normalizedPhone}`;
    uniqueContacts.set(identity, normalizedContact);
  }

  return [...uniqueContacts.values()];
};

export const ContactsStorage = {
  async getContacts(userId: string): Promise<TrustedContact[]> {
    const storedContacts = await getAccountStorageItem(
      userId,
      'trusted-contacts',
      [CONTACTS_STORAGE_KEY, LEGACY_CONTACTS_STORAGE_KEY],
    );

    if (!storedContacts) {
      return [];
    }

    const contacts = normalizeContacts(JSON.parse(storedContacts) as StoredContact[]);
    await ContactsStorage.saveContacts(userId, contacts);

    return contacts;
  },

  async saveContacts(userId: string, contacts: TrustedContact[]) {
    await setAccountStorageItem(
      userId,
      'trusted-contacts',
      JSON.stringify(contacts),
      [CONTACTS_STORAGE_KEY, LEGACY_CONTACTS_STORAGE_KEY],
    );
  },
};
