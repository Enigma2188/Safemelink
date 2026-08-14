import { AuthService } from '@/backend/auth/AuthService';
import { TrustedContactsRepository } from '@/backend/repositories/TrustedContactsRepository';
import { TrustedLinksRepository } from '@/backend/repositories/TrustedLinksRepository';
import type { TrustedContact } from '@/services/ContactsService';
import { ContactsStorage } from '@/storage/ContactsStorage';

export type TrustedLinkRequest = Awaited<
  ReturnType<typeof TrustedLinksRepository.listRequests>
>[number];

const maskCode = (code: string) => `${code.slice(0, 4)}••••${code.slice(-2)}`;
const normalizePhoneIdentity = (phone: string | null | undefined) =>
  phone?.replace(/[^\d+]/g, '') ?? '';

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
      const mergedLocalIds = new Set<string>();
      const linkedContactsByProfile = new Map<string, TrustedContact>();
      remoteContacts
        .filter((contact) => contact.linked_profile_id)
        .forEach((remoteContact) => {
          const existing = localContacts.find(
            (contact) =>
              contact.remoteId === remoteContact.id ||
              contact.userId === remoteContact.linked_profile_id ||
              Boolean(
                remoteContact.phone &&
                  normalizePhoneIdentity(contact.phone) ===
                    normalizePhoneIdentity(remoteContact.phone),
              ),
          );
          if (existing) {
            mergedLocalIds.add(existing.id);
          }

          const linkedContact: TrustedContact = {
            id: existing?.id ?? `remote:${remoteContact.id}`,
            remoteId: remoteContact.id,
            name: remoteContact.name,
            phone: remoteContact.phone ?? existing?.phone ?? '',
            hasApp: true,
            userId: remoteContact.linked_profile_id!,
            preferredChannel: existing?.preferredChannel ?? 'sms',
          };
          linkedContactsByProfile.set(remoteContact.linked_profile_id!, linkedContact);
        });
      const linkedContacts = [...linkedContactsByProfile.values()];
      const localOnlyContacts = localContacts.filter(
        (contact) => !contact.remoteId && !mergedLocalIds.has(contact.id),
      );
      const nextContacts = [...localOnlyContacts, ...linkedContacts];

      const currentSession = await AuthService.getSession();

      if (currentSession?.user.id !== userId) {
        return [];
      }

      await ContactsStorage.saveContacts(userId, nextContacts);
      console.log('[TrustedLinks] sincronizzazione locale completata', {
        linkedContacts: linkedContacts.length,
      });

      return nextContacts;
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

    return { publicCode, requests, contacts };
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
      await TrustedLinksRepository.respond(requestId, accept);

      if (accept) {
        console.log('[TrustedLinks] richiesta accettata');
        console.log('[TrustedLinks] trusted_contacts creati');
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
