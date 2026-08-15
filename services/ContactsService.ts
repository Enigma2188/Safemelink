import { ContactsStorage } from '@/storage/ContactsStorage';
import { AuthService } from '@/backend/auth/AuthService';
import { TrustedContactsRepository } from '@/backend/repositories/TrustedContactsRepository';
import type {
  PreferredSosChannel,
  SafeMeLinkContact,
} from '@/services/SafeMeLinkContact';
import { TrustedLinksService } from '@/services/TrustedLinksService';

export type TrustedContact = SafeMeLinkContact;

export type TrustedContactInput = {
  name: string;
  phone: string;
  preferredChannel?: PreferredSosChannel;
};

const normalizeContactInput = (input: TrustedContactInput) => ({
  name: input.name.trim(),
  phone: input.phone.trim(),
  preferredChannel: input.preferredChannel ?? 'sms',
});

const normalizePhoneIdentity = (phone: string) => phone.replace(/[^\d+]/g, '');

const getNextPriority = (
  contacts: Awaited<ReturnType<typeof TrustedContactsRepository.listOwn>>,
) => contacts.reduce((highest, contact) => Math.max(highest, contact.priority), 0) + 1;

async function createRemotePhoneContact(
  userId: string,
  input: ReturnType<typeof normalizeContactInput>,
) {
  const remoteContacts = await TrustedContactsRepository.listOwn();

  return TrustedContactsRepository.create({
    user_id: userId,
    name: input.name,
    phone: input.phone,
    priority: getNextPriority(remoteContacts),
    linked_profile_id: null,
  });
}

const hasDuplicatePhone = (
  contacts: TrustedContact[],
  phone: string,
  excludedContactId?: string,
) => {
  const phoneIdentity = normalizePhoneIdentity(phone);
  return Boolean(
    phoneIdentity &&
      contacts.some(
        (contact) =>
          contact.id !== excludedContactId &&
          normalizePhoneIdentity(contact.phone) === phoneIdentity,
      ),
  );
};

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
      const localContacts = await ContactsStorage.getContacts(userId);
      return localContacts.map((contact) => ({
        ...contact,
        hasApp: false,
        remoteId: undefined,
        userId: undefined,
      }));
    }
  },

  async add(input: TrustedContactInput) {
    const userId = await requireCurrentUserId();
    const contacts = await ContactsStorage.getContacts(userId);

    const normalized = normalizeContactInput(input);

    if (!normalized.name || !normalized.phone) {
      throw new Error('Inserisci nome e numero di telefono.');
    }
    if (hasDuplicatePhone(contacts, normalized.phone)) {
      throw new Error('Questo numero è già presente tra i contatti fidati.');
    }

    console.log('[TrustedContacts] sincronizzazione avviata');
    const remoteContact = await createRemotePhoneContact(userId, normalized);
    console.log('[TrustedContacts] contatto creato');

    const nextContacts: TrustedContact[] = [
      ...contacts,
      {
        id: `${Date.now()}`,
        remoteId: remoteContact.id,
        ...normalized,
        hasApp: false,
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
    if (normalized.phone && hasDuplicatePhone(contacts, normalized.phone, id)) {
      throw new Error('Questo numero è già presente tra i contatti fidati.');
    }

    console.log('[TrustedContacts] sincronizzazione avviata');
    let remoteId = existing.remoteId;
    if (existing.remoteId) {
      await TrustedContactsRepository.update(existing.remoteId, {
        name: normalized.name,
        phone: normalized.phone || null,
      });
      console.log('[TrustedContacts] contatto aggiornato');
    } else {
      const remoteContact = await createRemotePhoneContact(userId, normalized);
      remoteId = remoteContact.id;
      console.log('[TrustedContacts] contatto creato');
    }

    const nextContacts = contacts.map((contact) =>
      contact.id === id ? { ...contact, ...normalized, remoteId } : contact,
    );

    await ContactsStorage.saveContacts(userId, nextContacts);
    return nextContacts;
  },

  async remove(id: string) {
    const userId = await requireCurrentUserId();
    const contacts = await ContactsStorage.getContacts(userId);
    const existing = contacts.find((contact) => contact.id === id);

    if (existing?.remoteId) {
      console.log('[TrustedContacts] sincronizzazione avviata');
      await TrustedContactsRepository.remove(existing.remoteId);
      console.log('[TrustedContacts] contatto eliminato');
    }

    const nextContacts = contacts.filter((contact) => contact.id !== id);

    await ContactsStorage.saveContacts(userId, nextContacts);
    return nextContacts;
  },
};
