import { ContactsStorage } from '@/storage/ContactsStorage';
import { AuthService } from '@/backend/auth/AuthService';
import { TrustedContactsRepository } from '@/backend/repositories/TrustedContactsRepository';
import type {
  PreferredSosChannel,
  SafeMeLinkContact,
} from '@/services/SafeMeLinkContact';
import {
  canonicalizeInternationalPhone,
  getPhoneIdentityKey,
  normalizePhoneDisplay,
} from '@/services/PhoneIdentity';
import { TrustedLinksService } from '@/services/TrustedLinksService';

export type TrustedContact = SafeMeLinkContact;

export type TrustedContactInput = {
  name: string;
  phone: string;
  preferredChannel?: PreferredSosChannel;
};

const normalizeContactInput = (input: TrustedContactInput) => ({
  name: input.name.trim(),
  phone: normalizePhoneDisplay(input.phone),
  phoneE164: canonicalizeInternationalPhone(input.phone),
  preferredChannel: input.preferredChannel ?? 'sms',
});

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
    phone: input.phone || null,
    phone_e164: input.phoneE164,
    preferred_channel: input.preferredChannel,
    priority: getNextPriority(remoteContacts),
    linked_profile_id: null,
  });
}

const hasDuplicatePhone = (
  contacts: TrustedContact[],
  phoneE164: string | null,
  excludedContactId?: string,
) => {
  const phoneIdentity = phoneE164;
  return Boolean(
    phoneIdentity &&
      contacts.some(
        (contact) =>
          contact.id !== excludedContactId &&
          getPhoneIdentityKey(contact.phone, contact.phoneE164) === phoneIdentity,
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

async function saveRemoteContactsPreservingLegacy(
  userId: string,
  remoteContacts: TrustedContact[],
  resolvedLegacyId?: string,
) {
  const cachedContacts = await ContactsStorage.getContacts(userId);
  const legacyContacts = cachedContacts.filter(
    (contact) => contact.isLegacyLocal && contact.id !== resolvedLegacyId,
  );
  await ContactsStorage.saveContacts(userId, [...remoteContacts, ...legacyContacts]);
}

export const ContactsService = {
  async listCached(userId: string) {
    console.info('[TrustedContacts] CONTACT_SOURCE_LOCAL_CACHE');
    return ContactsStorage.getContacts(userId);
  },

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
      console.info('[TrustedContacts] CONTACT_SOURCE_LOCAL_CACHE');
      return ContactsStorage.getContacts(userId);
    }
  },

  async add(input: TrustedContactInput) {
    const userId = await requireCurrentUserId();
    const contacts = await TrustedLinksService.syncLocalContacts(userId);

    const normalized = normalizeContactInput(input);

    if (!normalized.name || !normalized.phone) {
      throw new Error('Inserisci nome e numero di telefono internazionale.');
    }
    if (!normalized.phoneE164) {
      console.info('[TrustedContacts] PHONE_CANONICAL_INVALID');
      throw new Error('Inserisci il numero completo di prefisso internazionale, ad esempio +39.');
    }
    console.info('[TrustedContacts] PHONE_CANONICAL_VALID');
    if (hasDuplicatePhone(contacts, normalized.phoneE164)) {
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
        name: remoteContact.name,
        phone: remoteContact.phone ?? normalized.phone,
        phoneE164: remoteContact.phone_e164,
        preferredChannel: remoteContact.preferred_channel,
        priority: remoteContact.priority,
        hasApp: false,
      },
    ];

    const matchingLegacyContact = (await ContactsStorage.getContacts(userId)).find(
      (contact) =>
        contact.isLegacyLocal &&
        getPhoneIdentityKey(contact.phone, contact.phoneE164) === normalized.phoneE164,
    );
    await saveRemoteContactsPreservingLegacy(userId, nextContacts, matchingLegacyContact?.id);
    return nextContacts;
  },

  async update(id: string, input: TrustedContactInput) {
    const userId = await requireCurrentUserId();
    const normalized = normalizeContactInput(input);
    const contacts = await TrustedLinksService.syncLocalContacts(userId);
    const existing = contacts.find((contact) => contact.id === id);

    if (!existing) {
      throw new Error('Contatto non trovato.');
    }

    if (!normalized.name || (!normalized.phone && !existing.userId)) {
      throw new Error('Inserisci nome e numero di telefono internazionale.');
    }
    if (normalized.phone && !normalized.phoneE164) {
      console.info('[TrustedContacts] PHONE_CANONICAL_INVALID');
      throw new Error('Inserisci il numero completo di prefisso internazionale, ad esempio +39.');
    }
    if (normalized.phoneE164) {
      console.info('[TrustedContacts] PHONE_CANONICAL_VALID');
    }
    if (normalized.phoneE164 && hasDuplicatePhone(contacts, normalized.phoneE164, id)) {
      throw new Error('Questo numero è già presente tra i contatti fidati.');
    }

    console.log('[TrustedContacts] sincronizzazione avviata');
    let remoteId = existing.remoteId;
    if (existing.remoteId) {
      await TrustedContactsRepository.update(existing.remoteId, {
        name: normalized.name,
        phone: normalized.phone || null,
        phone_e164: normalized.phoneE164,
        preferred_channel: normalized.preferredChannel,
      });
      console.log('[TrustedContacts] contatto aggiornato');
    } else {
      const remoteContact = await createRemotePhoneContact(userId, normalized);
      remoteId = remoteContact.id;
      console.log('[TrustedContacts] contatto creato');
    }

    const nextContacts = contacts.map((contact) =>
      contact.id === id
        ? {
            ...contact,
            ...normalized,
            remoteId,
          }
        : contact,
    );

    await saveRemoteContactsPreservingLegacy(userId, nextContacts);
    return nextContacts;
  },

  async remove(id: string) {
    const userId = await requireCurrentUserId();
    const contacts = await TrustedLinksService.syncLocalContacts(userId);
    const existing = contacts.find((contact) => contact.id === id);

    if (existing?.remoteId) {
      console.log('[TrustedContacts] sincronizzazione avviata');
      await TrustedContactsRepository.remove(existing.remoteId);
      console.log('[TrustedContacts] contatto eliminato');
    }

    const nextContacts = contacts.filter((contact) => contact.id !== id);

    await saveRemoteContactsPreservingLegacy(userId, nextContacts);
    return nextContacts;
  },

  async importLegacy(id: string) {
    const userId = await requireCurrentUserId();
    const cachedContacts = await ContactsStorage.getContacts(userId);
    const legacyContact = cachedContacts.find(
      (contact) => contact.id === id && contact.isLegacyLocal,
    );

    if (!legacyContact) {
      throw new Error('Contatto locale non trovato.');
    }

    const normalized = normalizeContactInput(legacyContact);
    if (!normalized.name || !normalized.phoneE164) {
      throw new Error(
        'Per importare questo contatto, aggiungilo di nuovo con il prefisso internazionale.',
      );
    }

    const remoteContacts = await TrustedLinksService.syncLocalContacts(userId);
    if (hasDuplicatePhone(remoteContacts, normalized.phoneE164)) {
      await saveRemoteContactsPreservingLegacy(userId, remoteContacts, id);
      return remoteContacts;
    }

    console.log('[TrustedContacts] sincronizzazione avviata');
    const remoteContact = await createRemotePhoneContact(userId, normalized);
    console.log('[TrustedContacts] contatto creato');
    const nextContacts: TrustedContact[] = [
      ...remoteContacts,
      {
        id: `remote:${remoteContact.id}`,
        remoteId: remoteContact.id,
        name: remoteContact.name,
        phone: remoteContact.phone ?? normalized.phone,
        phoneE164: remoteContact.phone_e164,
        preferredChannel: remoteContact.preferred_channel,
        priority: remoteContact.priority,
        hasApp: false,
        isLegacyLocal: false,
      },
    ];
    await saveRemoteContactsPreservingLegacy(userId, nextContacts, id);
    return nextContacts;
  },

  async discardLegacy(id: string) {
    const userId = await requireCurrentUserId();
    const cachedContacts = await ContactsStorage.getContacts(userId);
    await ContactsStorage.saveContacts(
      userId,
      cachedContacts.filter((contact) => !(contact.id === id && contact.isLegacyLocal)),
    );
  },
};
