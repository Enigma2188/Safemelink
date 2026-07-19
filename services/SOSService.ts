import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import { SOSPushService } from '@/backend/functions/SOSPushService';
import { LocationService, type SOSLocation } from '@/services/LocationService';
import { sendSosAlert, shareSosAlert } from '@/services/SOSAlertService';
import { SOSStorage } from '@/storage/SOSStorage';

export type SOSEvent = {
  id: string;
  createdAt: string;
  location: SOSLocation;
  message: string;
  contactIds: string[];
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

  async completeSOS() {
    const location = await LocationService.getCurrentLocation();
    const createdAt = new Date().toISOString();
    const message = SOSService.createMessage(location, createdAt);
    const contacts = await ContactsService.list();

    if (contacts.length === 0) {
      throw new Error('Salva almeno un contatto fidato prima di usare SOS.');
    }

    const event: SOSEvent = {
      id: `${Date.now()}`,
      createdAt,
      location,
      message,
      contactIds: contacts.map((contact) => contact.id),
    };

    const events = await SOSStorage.saveEvent(event);
    await SOSPushService.send(event).catch((error: unknown) => {
      console.warn('Invio notifica SOS remota non riuscito.', error);
    });
    await sendSosAlert(event, contacts);

    return {
      event,
      events,
    };
  },

  async sendSOS(event: SOSEvent, contacts: TrustedContact[]) {
    await sendSosAlert(event, contacts);
  },

  async shareSOS(event: SOSEvent, contacts: TrustedContact[]) {
    await shareSosAlert(event, contacts);
  },
};
