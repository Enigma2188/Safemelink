import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import type { SosStatus } from '@/backend/database.types';
import {
  SOSRemoteCreationTimeoutError,
  SOSPushService,
  type SOSDeliveryResult,
} from '@/backend/functions/SOSPushService';
import { LocationService, type SOSLocation } from '@/services/LocationService';
import {
  sendSosAlert,
  sendSosSmsFallback,
  shareSosAlert,
  type SOSLocalDeliveryResult,
} from '@/services/SOSAlertService';
import { getSOSSessionWithTimeout } from '@/services/SOSSessionTimeout';
import { SOSStorage } from '@/storage/SOSStorage';

export type SOSTerminalStatus = Extract<SosStatus, 'closed' | 'cancelled'>;

export type SOSEvent = {
  id: string;
  createdAt: string;
  location: SOSLocation | null;
  message: string | null;
  contactIds: string[];
  remoteSosId?: string;
  remoteStatus?: SosStatus;
  isActive?: boolean;
};

export type ActiveSOSEvent = SOSEvent & {
  location: SOSLocation;
  message: string;
};

const createMapsLink = (location: SOSLocation) =>
  `https://maps.google.com/?q=${location.latitude},${location.longitude}`;

const SOS_LOCAL_OPERATION_TIMEOUT_MS = 8_000;

const runLocalOperationWithTimeout = async <T,>(operation: Promise<T>) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Operazione locale SOS non disponibile.')),
          SOS_LOCAL_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const SOSService = {
  createMessage(location: SOSLocation, createdAt: string) {
    return [
      'SOS SafeMeLink',
      'Ho bisogno di aiuto. Contattami appena possibile.',
      `Coordinate GPS: ${location.latitude}, ${location.longitude}`,
      `Google Maps: ${createMapsLink(location)}`,
      `Data e ora: ${new Date(createdAt).toLocaleString()}`,
    ].join('\n');
  },

  async completeSOS(
    expectedUserId: string,
    options: { allowRemoteDelivery?: boolean } = {},
  ) {
    const allowRemoteDelivery = options.allowRemoteDelivery ?? true;
    const initialSession = await getSOSSessionWithTimeout();

    if (initialSession?.user.id !== expectedUserId) {
      throw new Error('Sessione cambiata: riavvia l’SOS con l’account attivo.');
    }

    const location = await LocationService.getCurrentLocation();
    const currentSession = await getSOSSessionWithTimeout();

    if (currentSession?.user.id !== expectedUserId) {
      throw new Error('Sessione cambiata durante l’SOS. Nessun evento remoto è stato creato.');
    }

    const createdAt = new Date().toISOString();
    const message = SOSService.createMessage(location, createdAt);
    let contacts: TrustedContact[] = [];

    try {
      contacts = await runLocalOperationWithTimeout(
        allowRemoteDelivery
          ? ContactsService.list(expectedUserId)
          : ContactsService.listCached(expectedUserId),
      );
    } catch {
      console.warn('[SafeMeLink SOS] Contatti locali non disponibili.', {
        category: 'local_contacts_unavailable',
      });
    }

    if ((await getSOSSessionWithTimeout())?.user.id !== expectedUserId) {
      throw new Error('Sessione cambiata durante l’SOS. Nessun evento remoto è stato creato.');
    }

    const event: ActiveSOSEvent = {
      id: `${Date.now()}`,
      createdAt,
      location,
      message,
      contactIds: contacts.map((contact) => contact.id),
    };

    const pushResult: SOSDeliveryResult = allowRemoteDelivery
      ? await SOSPushService.send(event, expectedUserId).catch((error: unknown) => {
          console.error('[SafeMeLink Push] Flusso push SOS terminato con errore.', {
            category: error instanceof Error ? error.name : 'UnknownError',
          });
          return {
            sosCreated: false,
            sosId: null,
            recipientCount: 0,
            tokenCount: 0,
            notificationsSent: 0,
            notificationsFailed: 0,
            errors: ['Invio SafeMeLink non disponibile.'],
            reason:
              error instanceof SOSRemoteCreationTimeoutError
                ? ('remote_creation_timeout' as const)
                : ('remote_creation_error' as const),
          };
        })
      : {
          sosCreated: false,
          sosId: null,
          recipientCount: 0,
          tokenCount: 0,
          notificationsSent: 0,
          notificationsFailed: 0,
          errors: ['Invio SafeMeLink non disponibile offline.'],
          reason: 'unavailable',
        };

    if (!allowRemoteDelivery) {
      console.info('[SafeMeLink SOS] Consegna remota ignorata in modalità offline.', {
        category: 'offline_degraded_mode',
      });
    }

    console.log('[SafeMeLink Push] Esito consegna SOS.', {
      sosCreated: pushResult.sosCreated,
      recipientCount: pushResult.recipientCount,
      trustedRecipientCount: pushResult.trustedRecipientCount ?? 0,
      nearbyRecipientCount: pushResult.nearbyRecipientCount ?? 0,
      tokenCount: pushResult.tokenCount,
      notificationsSent: pushResult.notificationsSent,
      notificationsFailed: pushResult.notificationsFailed,
      reason: pushResult.reason,
      errorCount: pushResult.errors.length,
    });

    if (pushResult.reason === 'not_authenticated') {
      throw new Error('Sessione cambiata durante l’SOS. Riprova con l’account attivo.');
    }

    const completedEvent: ActiveSOSEvent = {
      ...event,
      isActive: true,
      ...(pushResult.sosId
        ? {
            remoteSosId: pushResult.sosId,
            remoteStatus: 'open' as const,
          }
        : {}),
    };
    let localPersistenceFailed = false;
    let events: SOSEvent[];
    try {
      events = await runLocalOperationWithTimeout(
        SOSStorage.saveEvent(expectedUserId, completedEvent),
      );
    } catch {
      localPersistenceFailed = true;
      events = [completedEvent];
      console.warn('[SafeMeLink SOS] Persistenza locale non disponibile.', {
        category: 'local_storage_unavailable',
      });
    }
    let localDeliveryResult: SOSLocalDeliveryResult = {
      status: 'not_needed',
      channel: null,
    };
    if (pushResult.notificationsSent === 0) {
      localDeliveryResult = await sendSosAlert(completedEvent, contacts).catch(() => {
        console.warn('[SafeMeLink SOS] Fallback locale non completato.', {
          category: 'local_fallback_unavailable',
        });
        return { status: 'technical_error' as const, channel: null };
      });
    }

    return {
      event: completedEvent,
      events,
      pushResult,
      localDeliveryResult,
      localPersistenceFailed,
    };
  },

  async sendSOS(event: ActiveSOSEvent, contacts: TrustedContact[]) {
    await sendSosAlert(event, contacts);
  },

  async sendSmsFallback(event: ActiveSOSEvent, contacts: TrustedContact[]) {
    return sendSosSmsFallback(event, contacts);
  },

  async shareSOS(event: ActiveSOSEvent, contacts: TrustedContact[]) {
    await shareSosAlert(event, contacts);
  },
};
