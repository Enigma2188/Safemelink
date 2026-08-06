import { Alert, Linking, Share } from 'react-native';

import type { SafeMeLinkContact } from '@/services/SafeMeLinkContact';
import type { ActiveSOSEvent } from '@/services/SOSService';

const normalizePhoneNumber = (phone: string) => {
  const trimmed = phone.trim();
  const startsWithPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');

  if (digits.length < 6) {
    return null;
  }

  return `${startsWithPlus ? '+' : ''}${digits}`;
};

const getContactsWithValidPhones = (contacts: SafeMeLinkContact[]) =>
  contacts.reduce<SafeMeLinkContact[]>((validContacts, contact) => {
    const phone = normalizePhoneNumber(contact.phone);

    if (!phone) {
      return validContacts;
    }

    return [
      ...validContacts,
      {
        ...contact,
        phone,
      },
    ];
  }, []);

const createSmsUrls = (event: ActiveSOSEvent, contact?: SafeMeLinkContact) => {
  const message = encodeURIComponent(event.message);
  const phone = contact?.phone;

  return [
    ...(phone ? [`smsto:${phone}?body=${message}`] : []),
    ...(phone ? [`sms:${phone}?body=${message}`] : []),
    `sms:?body=${message}`,
  ];
};

const createWhatsAppUrls = (event: ActiveSOSEvent, contact: SafeMeLinkContact) => {
  const message = encodeURIComponent(event.message);
  const phone = contact.phone.replace(/[^\d]/g, '');

  return [
    `whatsapp://send?phone=${phone}&text=${message}`,
    `https://wa.me/${phone}?text=${message}`,
  ];
};

const getUrlDiagnostics = (url: string) => {
  const rawScheme = url.slice(0, Math.max(0, url.indexOf(':'))).toLowerCase();
  const scheme = ['sms', 'smsto', 'whatsapp', 'https'].includes(rawScheme)
    ? rawScheme
    : 'unknown';
  const channel = scheme === 'sms' || scheme === 'smsto' ? 'sms' : 'whatsapp';

  return { channel, scheme };
};

const getGenericErrorCategory = (error: unknown) =>
  error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';

const openUrlWithDiagnostics = async (url: string) => {
  const diagnostics = getUrlDiagnostics(url);

  try {
    const canOpen = await Linking.canOpenURL(url);
    console.log('[SafeMeLink SOS] verifica apertura canale', {
      ...diagnostics,
      outcome: canOpen ? 'success' : 'failure',
    });
  } catch (error) {
    console.log('[SafeMeLink SOS] verifica apertura canale fallita', {
      ...diagnostics,
      outcome: 'failure',
      errorCategory: getGenericErrorCategory(error),
    });
  }

  try {
    await Linking.openURL(url);
    console.log('[SafeMeLink SOS] apertura canale completata', {
      ...diagnostics,
      outcome: 'success',
    });
    return true;
  } catch (error) {
    console.log('[SafeMeLink SOS] apertura canale fallita', {
      ...diagnostics,
      outcome: 'failure',
      errorCategory: getGenericErrorCategory(error),
    });
    return false;
  }
};

export const shareSosAlert = async (event: ActiveSOSEvent, contacts: SafeMeLinkContact[]) => {
  const recipients = contacts.map((contact) => `${contact.name} (${contact.phone})`).join(', ');

  await Share.share({
    message: `${event.message}\n\nContatti fidati: ${recipients}`,
  });
};

export const sendSosAlert = async (event: ActiveSOSEvent, contacts: SafeMeLinkContact[]) => {
  const contactsWithValidPhones = getContactsWithValidPhones(contacts);
  const smsContact = contactsWithValidPhones[0];

  for (const url of createSmsUrls(event, smsContact)) {
    if (await openUrlWithDiagnostics(url)) {
      return;
    }
  }

  const whatsappContacts = [
    ...contactsWithValidPhones.filter((contact) => contact.preferredChannel === 'whatsapp'),
    ...contactsWithValidPhones.filter((contact) => contact.preferredChannel !== 'whatsapp'),
  ];

  for (const contact of whatsappContacts) {
    for (const url of createWhatsAppUrls(event, contact)) {
      if (await openUrlWithDiagnostics(url)) {
        return;
      }
    }
  }

  Alert.alert(
    'SOS salvato',
    'SOS salvato, ma non e stato possibile aprire SMS o WhatsApp. Controlla i numeri dei contatti fidati.'
  );
};

export async function sendSosViaBackend(): Promise<void> {
  // TODO: inviare l'evento SOS al backend SafeMeLink quando sara disponibile.
  throw new Error('Invio SOS tramite backend non ancora disponibile.');
}

export async function notifyTrustedAppUsers(): Promise<void> {
  // TODO: notificare via backend/push i contatti fidati con hasApp === true.
  throw new Error('Notifiche ai contatti SafeMeLink non ancora disponibili.');
}

export async function notifyNearbyUsers(): Promise<void> {
  // TODO: notificare gli utenti SafeMeLink nelle vicinanze quando previsto dal prodotto.
  throw new Error('Notifiche agli utenti vicini non ancora disponibili.');
}
