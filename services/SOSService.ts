import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import type { SosStatus } from '@/backend/database.types';
import {
  SOSPushService,
  type SOSDeliveryResult,
} from '@/backend/functions/SOSPushService';
import { LocationService, type SOSLocation } from '@/services/LocationService';
import { sendSosAlert, shareSosAlert } from '@/services/SOSAlertService';
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
};

export type ActiveSOSEvent = SOSEvent & {
  location: SOSLocation;
  message: string;
};

const createMapsLink = (location: SOSLocation) =>
  `https://maps.google.com/?q=${location.latitude},${location.longitude}`;

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

  async completeSOS(expectedUserId: string) {
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
      contacts = await ContactsService.list(expectedUserId);
    } catch (error) {
      console.warn('[SafeMeLink SOS] Contatti locali non disponibili.', error);
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

    const pushResult: SOSDeliveryResult = await SOSPushService.send(
      event,
      expectedUserId,
    ).catch((error: unknown) => {
      console.error('[SafeMeLink Push] Flusso push SOS terminato con errore.', error);
      return {
        sosCreated: false,
        sosId: null,
        recipientCount: 0,
        tokenCount: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        errors: [error instanceof Error ? error.message : 'Errore push inatteso.'],
      };
    });

    console.log('[SafeMeLink Push] Esito completo consegna SOS.', {
      sosId: pushResult.sosId,
      sosCreated: pushResult.sosCreated,
      recipientCount: pushResult.recipientCount,
      tokenCount: pushResult.tokenCount,
      notificationsSent: pushResult.notificationsSent,
      notificationsFailed: pushResult.notificationsFailed,
      reason: pushResult.reason,
      errors: pushResult.errors,
    });

    if (pushResult.reason === 'not_authenticated') {
      throw new Error('Sessione cambiata durante l’SOS. Riprova con l’account attivo.');
    }

    const completedEvent: ActiveSOSEvent = {
      ...event,
      ...(pushResult.sosId
        ? {
            remoteSosId: pushResult.sosId,
            remoteStatus: 'open' as const,
          }
        : {}),
    };
    const events = await SOSStorage.saveEvent(expectedUserId, completedEvent);
    await sendSosAlert(completedEvent, contacts);

    return {
      event: completedEvent,
      events,
      pushResult,
    };
  },

  async sendSOS(event: ActiveSOSEvent, contacts: TrustedContact[]) {
    await sendSosAlert(event, contacts);
  },

  async shareSOS(event: ActiveSOSEvent, contacts: TrustedContact[]) {
    await shareSosAlert(event, contacts);
  },
};
