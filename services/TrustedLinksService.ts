import { AuthService } from '@/backend/auth/AuthService';
import { TrustedContactsRepository } from '@/backend/repositories/TrustedContactsRepository';
import { TrustedLinksRepository } from '@/backend/repositories/TrustedLinksRepository';
import type { TrustedContact } from '@/services/ContactsService';
import { ContactsStorage } from '@/storage/ContactsStorage';

export type TrustedLinkRequest = Awaited<
  ReturnType<typeof TrustedLinksRepository.listRequests>
>[number];

const maskCode = (code: string) => `${code.slice(0, 4)}••••${code.slice(-2)}`;

export const TrustedLinksService = {
  async syncLocalContacts() {
    const localContacts = await ContactsStorage.getContacts();
    const session = await AuthService.getSession();

    if (!session) {
      return localContacts;
    }

    console.log('[TrustedLinks] sincronizzazione avviata');

    try {
      const remoteContacts = await TrustedContactsRepository.listOwn();
      const localOnlyContacts = localContacts.filter((contact) => !contact.remoteId);
      const linkedContacts = remoteContacts
        .filter((contact) => contact.linked_profile_id)
        .map<TrustedContact>((remoteContact) => {
          const existing = localContacts.find(
            (contact) =>
              contact.remoteId === remoteContact.id ||
              contact.userId === remoteContact.linked_profile_id,
          );

          return {
            id: existing?.id ?? `remote:${remoteContact.id}`,
            remoteId: remoteContact.id,
            name: remoteContact.name,
            phone: remoteContact.phone ?? existing?.phone ?? '',
            hasApp: true,
            userId: remoteContact.linked_profile_id!,
            preferredChannel: existing?.preferredChannel ?? 'sms',
          };
        });
      const nextContacts = [...localOnlyContacts, ...linkedContacts];

      await ContactsStorage.saveContacts(nextContacts);
      console.log('[TrustedLinks] sincronizzazione locale completata', {
        linkedContacts: linkedContacts.length,
      });

      return nextContacts;
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', error);
      throw error;
    }
  },

  async loadOverview() {
    const session = await AuthService.getSession();

    if (!session) {
      return {
        publicCode: null,
        requests: [] as TrustedLinkRequest[],
        contacts: await ContactsStorage.getContacts(),
      };
    }

    const [publicCode, requests, contacts] = await Promise.all([
      TrustedLinksRepository.getMyPublicCode(),
      TrustedLinksRepository.listRequests(),
      TrustedLinksService.syncLocalContacts(),
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
      console.error('[TrustedLinks] errore collegamento', error);
      throw error;
    }
  },

  async respond(requestId: string, accept: boolean) {
    console.log('[TrustedLinks] sincronizzazione avviata');

    try {
      await TrustedLinksRepository.respond(requestId, accept);

      if (accept) {
        console.log('[TrustedLinks] richiesta accettata');
        console.log('[TrustedLinks] trusted_contacts creati');
        await TrustedLinksService.syncLocalContacts();
      }
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', error);
      throw error;
    }
  },

  async cancel(requestId: string) {
    try {
      await TrustedLinksRepository.cancel(requestId);
    } catch (error) {
      console.error('[TrustedLinks] errore collegamento', error);
      throw error;
    }
  },
};
