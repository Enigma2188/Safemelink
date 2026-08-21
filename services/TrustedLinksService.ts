import { AuthService } from '@/backend/auth/AuthService';
import { TrustedContactsRepository } from '@/backend/repositories/TrustedContactsRepository';
import { TrustedLinksRepository } from '@/backend/repositories/TrustedLinksRepository';
import type { TrustedContact } from '@/services/ContactsService';
import { getPhoneIdentityKey } from '@/services/PhoneIdentity';
import { ContactsStorage } from '@/storage/ContactsStorage';

export type TrustedLinkRequest = Awaited<
  ReturnType<typeof TrustedLinksRepository.listRequests>
>[number];

const maskCode = (code: string) => `${code.slice(0, 4)}••••${code.slice(-2)}`;
type RemoteTrustedContact = Awaited<
  ReturnType<typeof TrustedContactsRepository.listOwn>
>[number];

const findMatchingLocalContact = (
  localContacts: TrustedContact[],
  remoteContact: RemoteTrustedContact,
) =>
  localContacts.find(
    (contact) =>
      contact.remoteId === remoteContact.id ||
      Boolean(
        remoteContact.linked_profile_id &&
          contact.userId === remoteContact.linked_profile_id,
      ) ||
      Boolean(
        getPhoneIdentityKey(remoteContact.phone, remoteContact.phone_e164) &&
          getPhoneIdentityKey(contact.phone, contact.phoneE164) ===
            getPhoneIdentityKey(remoteContact.phone, remoteContact.phone_e164),
      ),
  );

const mergeRemoteAndLocalContacts = (
  localContacts: TrustedContact[],
  remoteContacts: RemoteTrustedContact[],
) => {
  const mergedLocalIds = new Set<string>();
  const remoteContactsByIdentity = new Map<string, TrustedContact>();

  for (const remoteContact of remoteContacts) {
    const existing = findMatchingLocalContact(localContacts, remoteContact);
    if (existing) {
      mergedLocalIds.add(existing.id);
    }

    const linkedProfileId = remoteContact.linked_profile_id ?? undefined;
    const contact: TrustedContact = {
      id: existing?.id ?? `remote:${remoteContact.id}`,
      remoteId: remoteContact.id,
      name: remoteContact.name,
      phone: remoteContact.phone ?? existing?.phone ?? '',
      phoneE164:
        remoteContact.phone_e164 ??
        getPhoneIdentityKey(remoteContact.phone, existing?.phoneE164),
      priority: remoteContact.priority,
      hasApp: Boolean(linkedProfileId),
      ...(linkedProfileId ? { userId: linkedProfileId } : {}),
      preferredChannel: remoteContact.preferred_channel,
      isLegacyLocal: false,
    };
    const canonicalPhone = getPhoneIdentityKey(
      remoteContact.phone,
      remoteContact.phone_e164,
    );
    const identity = linkedProfileId
      ? `linked:${linkedProfileId}`
      : canonicalPhone
        ? `phone:${canonicalPhone}`
        : `remote:${remoteContact.id}`;

    if (remoteContactsByIdentity.has(identity)) {
      console.info('[TrustedLinks] DUPLICATE_CANONICAL_REMOVED');
    } else {
      remoteContactsByIdentity.set(identity, contact);
    }
  }

  const legacyContacts = localContacts
    .filter((contact) => !mergedLocalIds.has(contact.id) && contact.isLegacyLocal)
    .map((contact) => ({ ...contact, isLegacyLocal: true }));
  if (legacyContacts.length > 0) {
    console.info('[TrustedLinks] cache locale in attesa di decisione esplicita', {
      category: 'CONTACT_SOURCE_LOCAL_CACHE',
      pendingCount: legacyContacts.length,
    });
  }

  return {
    contacts: [...remoteContactsByIdentity.values()].sort(
      (first, second) => first.priority - second.priority,
    ),
    legacyContacts,
  };
};

export const TrustedLinksService = {
  async syncLocalContacts(expectedUserId?: string) {
    const session = await AuthService.getSession();

    if (!session || (expectedUserId && session.user.id !== expectedUserId)) {
      return [];
    }

    const userId = session.user.id;
    const localContacts = await ContactsStorage.getContacts(userId);
    console.log('[TrustedLinks] sincronizzazione avviata');

    try {
      const remoteContacts = await TrustedContactsRepository.listOwn();
      const mergedContacts = mergeRemoteAndLocalContacts(localContacts, remoteContacts);

      const currentSession = await AuthService.getSession();

      if (currentSession?.user.id !== userId) {
        return [];
      }

      await ContactsStorage.saveContacts(userId, [
        ...mergedContacts.contacts,
        ...mergedContacts.legacyContacts,
      ]);
      console.info('[TrustedLinks] CONTACT_SOURCE_REMOTE');
      console.log('[TrustedLinks] sincronizzazione locale completata', {
        linkedContacts: mergedContacts.contacts.filter((contact) => contact.userId).length,
        remoteContacts: remoteContacts.length,
      });

      return mergedContacts.contacts;
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  },

  async loadOverview() {
    const session = await AuthService.getSession();

    if (!session) {
      return {
        publicCode: null,
        requests: [] as TrustedLinkRequest[],
        contacts: [] as TrustedContact[],
        legacyContacts: [] as TrustedContact[],
      };
    }

    const [publicCode, requests, contacts] = await Promise.all([
      TrustedLinksRepository.getMyPublicCode(),
      TrustedLinksRepository.listRequests(),
      TrustedLinksService.syncLocalContacts(session.user.id),
    ]);

    console.log('[TrustedLinks] codice profilo disponibile', {
      code: maskCode(publicCode),
    });
    console.log('[TrustedLinks] richiesta ricevuta', {
      pending: requests.filter(
        (request) => request.direction === 'received' && request.request_status === 'pending',
      ).length,
    });

    const legacyContacts = (await ContactsStorage.getContacts(session.user.id)).filter(
      (contact) => contact.isLegacyLocal,
    );

    return { publicCode, requests, contacts, legacyContacts };
  },

  async sendRequest(publicCode: string) {
    console.log('[TrustedLinks] sincronizzazione avviata');

    try {
      await TrustedLinksRepository.createRequest(publicCode.trim().toUpperCase());
      console.log('[TrustedLinks] richiesta inviata');
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  },

  async respond(requestId: string, accept: boolean) {
    const session = await AuthService.getSession();

    if (!session) {
      throw new Error('Accedi per rispondere alla richiesta SafeMeLink.');
    }

    const userId = session.user.id;
    console.log('[TrustedLinks] sincronizzazione avviata');

    try {
      const linkedProfilesBefore = accept
        ? new Set(
            (await TrustedContactsRepository.listOwn())
              .map((contact) => contact.linked_profile_id)
              .filter((profileId): profileId is string => Boolean(profileId)),
          )
        : null;
      await TrustedLinksRepository.respond(requestId, accept);

      if (accept) {
        console.log('[TrustedLinks] richiesta accettata');
        const linkedContactsAfter = await TrustedContactsRepository.listOwn();
        const confirmedNewLink = linkedContactsAfter.some(
          (contact) =>
            contact.linked_profile_id &&
            !linkedProfilesBefore?.has(contact.linked_profile_id),
        );

        if (!confirmedNewLink) {
          throw new Error(
            'La richiesta risulta accettata, ma il collegamento SafeMeLink non è stato confermato dal server.',
          );
        }
        console.log('[TrustedLinks] trusted_contacts confermati');
        await TrustedLinksService.syncLocalContacts(userId);
      }
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  },

  async cancel(requestId: string) {
    try {
      await TrustedLinksRepository.cancel(requestId);
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', {
        category: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  },
};
