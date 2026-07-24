import { ContactsStorage } from '@/storage/ContactsStorage';
import { AuthService } from '@/backend/auth/AuthService';
import { TrustedContactsRepository } from '@/backend/repositories/TrustedContactsRepository';
import type { SafeMeLinkContact } from '@/services/SafeMeLinkContact';
import { TrustedLinksService } from '@/services/TrustedLinksService';

export type TrustedContact = SafeMeLinkContact;

export type TrustedContactInput = {
  name: string;
  phone: string;
};

const normalizeContactInput = (input: TrustedContactInput) => ({
  name: input.name.trim(),
  phone: input.phone.trim(),
});

async function getCurrentUserId() {
  return (await AuthService.getSession())?.user.id ?? null;
}

async function requireCurrentUserId() {
  const userId = await getCurrentUserId();

  if (!userId) {
    throw new Error('Accedi per gestire i contatti salvati.');
  }

  return userId;
}

export const ContactsService = {
  async list(expectedUserId?: string) {
    const userId = await getCurrentUserId();

    if (!userId) {
      return [];
    }

    if (expectedUserId && userId !== expectedUserId) {
      throw new Error('Sessione cambiata durante il caricamento dei contatti.');
    }

    try {
      return await TrustedLinksService.syncLocalContacts(expectedUserId ?? userId);
    } catch {
      return ContactsStorage.getContacts(userId);
    }
  },

  async add(input: TrustedContactInput) {
    const userId = await requireCurrentUserId();
    const contacts = await ContactsStorage.getContacts(userId);

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

    await ContactsStorage.saveContacts(userId, nextContacts);
    return nextContacts;
  },

  async update(id: string, input: TrustedContactInput) {
    const userId = await requireCurrentUserId();
    const normalized = normalizeContactInput(input);
    const contacts = await ContactsStorage.getContacts(userId);
    const existing = contacts.find((contact) => contact.id === id);

    if (!existing) {
      throw new Error('Contatto non trovato.');
    }

    if (!normalized.name || (!normalized.phone && !existing.userId)) {
      throw new Error('Inserisci nome e numero di telefono.');
    }

    if (existing.remoteId) {
      await TrustedContactsRepository.update(existing.remoteId, {
        name: normalized.name,
        phone: normalized.phone || null,
      });
    }

    const nextContacts = contacts.map((contact) =>
      contact.id === id ? { ...contact, ...normalized } : contact
    );

    await ContactsStorage.saveContacts(userId, nextContacts);
    return nextContacts;
  },

  async remove(id: string) {
    const userId = await requireCurrentUserId();
    const contacts = await ContactsStorage.getContacts(userId);
    const existing = contacts.find((contact) => contact.id === id);

    if (existing?.remoteId) {
      await TrustedContactsRepository.remove(existing.remoteId);
    }

    const nextContacts = contacts.filter((contact) => contact.id !== id);

    await ContactsStorage.saveContacts(userId, nextContacts);
    return nextContacts;
  },
};
