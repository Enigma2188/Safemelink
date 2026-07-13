import { ContactsStorage } from '@/storage/ContactsStorage';
import type { SafeMeLinkContact } from '@/services/SafeMeLinkContact';

export type TrustedContact = SafeMeLinkContact;

export type TrustedContactInput = {
  name: string;
  phone: string;
};

const MAX_TRUSTED_CONTACTS = 3;

const normalizeContactInput = (input: TrustedContactInput) => ({
  name: input.name.trim(),
  phone: input.phone.trim(),
});

export const ContactsService = {
  maxContacts: MAX_TRUSTED_CONTACTS,

  async list() {
    return ContactsStorage.getContacts();
  },

  async add(input: TrustedContactInput) {
    const contacts = await ContactsStorage.getContacts();

    if (contacts.length >= MAX_TRUSTED_CONTACTS) {
      throw new Error('Puoi salvare al massimo 3 contatti fidati.');
    }

    const normalized = normalizeContactInput(input);

    if (!normalized.name || !normalized.phone) {
      throw new Error('Inserisci nome e numero di telefono.');
    }

    const nextContacts: TrustedContact[] = [
      ...contacts,
      {
        id: `${Date.now()}`,
        ...normalized,
        hasApp: false,
        preferredChannel: 'sms',
      },
    ];

    await ContactsStorage.saveContacts(nextContacts);
    return nextContacts;
  },

  async update(id: string, input: TrustedContactInput) {
    const normalized = normalizeContactInput(input);

    if (!normalized.name || !normalized.phone) {
      throw new Error('Inserisci nome e numero di telefono.');
    }

    const contacts = await ContactsStorage.getContacts();
    const nextContacts = contacts.map((contact) =>
      contact.id === id ? { ...contact, ...normalized } : contact
    );

    await ContactsStorage.saveContacts(nextContacts);
    return nextContacts;
  },

  async remove(id: string) {
    const contacts = await ContactsStorage.getContacts();
    const nextContacts = contacts.filter((contact) => contact.id !== id);

    await ContactsStorage.saveContacts(nextContacts);
    return nextContacts;
  },
};
