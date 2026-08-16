import { Linking, Share } from 'react-native';

import type { SafeMeLinkContact } from '@/services/SafeMeLinkContact';
import type { ActiveSOSEvent } from '@/services/SOSService';

export type SOSLocalDeliveryResult = {
  status: 'not_needed' | 'whatsapp_opened' | 'sms_opened' | 'no_channel' | 'technical_error';
  channel: 'whatsapp' | 'sms' | null;
};

type UrlOpenResult = {
  opened: boolean;
  technicalFailure: boolean;
};

const LINKING_OPERATION_TIMEOUT_MS = 6_000;
const LOCAL_FALLBACK_DEADLINE_MS = 12_000;

const normalizePhoneNumber = (phone: string) => {
  const trimmed = phone.trim();
  const startsWithPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');

  if (digits.length < 6) {
    return null;
  }

  return `${startsWithPlus ? '+' : ''}${digits}`;
};

const getContactsWithValidPhones = (contacts: SafeMeLinkContact[]) => {
  const uniqueContacts = new Map<string, SafeMeLinkContact>();
  const orderedContacts = [...contacts].sort(
    (first, second) => Number(second.hasApp) - Number(first.hasApp),
  );

  for (const contact of orderedContacts) {
    const phone = normalizePhoneNumber(contact.phone);

    if (!phone) {
      continue;
    }

    if (!uniqueContacts.has(phone)) {
      uniqueContacts.set(phone, { ...contact, phone });
    }
  }

  return [...uniqueContacts.values()];
};

const runLinkingOperation = async <T,>(operation: Promise<T>) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('linking_timeout')),
          LINKING_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const createSmsUrls = (event: ActiveSOSEvent, contact: SafeMeLinkContact) => {
  const message = encodeURIComponent(event.message);

  return [
    `smsto:${contact.phone}?body=${message}`,
    `sms:${contact.phone}?body=${message}`,
  ];
};

const createGenericSmsUrl = (event: ActiveSOSEvent) =>
  `sms:?body=${encodeURIComponent(event.message)}`;

const createWhatsAppUrls = (event: ActiveSOSEvent, contact: SafeMeLinkContact) => {
  const message = encodeURIComponent(event.message);
  const compactPhone = contact.phone.trim().replace(/[\s().-]/g, '');

  if (!/^\+[1-9]\d{6,14}$/.test(compactPhone)) {
    console.info('[SafeMeLink SOS] canale WhatsApp ignorato', {
      channel: 'whatsapp',
      outcome: 'skipped',
      reason: 'invalid_international_format',
    });
    return [];
  }

  const phone = compactPhone.slice(1);

  return [
    `whatsapp://send?phone=${phone}&text=${message}`,
    `https://wa.me/${phone}?text=${message}`,
  ];
};

const getUrlDiagnostics = (url: string) => {
  const rawScheme = url.slice(0, Math.max(0, url.indexOf(':'))).toLowerCase();
  const isWhatsAppWebLink = rawScheme === 'https' && /^https:\/\/wa\.me\//i.test(url);
  const scheme = isWhatsAppWebLink
    ? 'https'
    : ['sms', 'smsto', 'whatsapp'].includes(rawScheme)
      ? rawScheme
      : 'unknown';
  const channel = scheme === 'whatsapp' || isWhatsAppWebLink ? 'whatsapp' : 'sms';

  return { channel, scheme } as const;
};

const getGenericErrorCategory = (error: unknown) =>
  error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';

const openUrlWithDiagnostics = async (url: string): Promise<UrlOpenResult> => {
  const diagnostics = getUrlDiagnostics(url);
  const availabilityUrl =
    diagnostics.channel === 'whatsapp' ? 'whatsapp://send' : url;

  try {
    const canOpen = await runLinkingOperation(Linking.canOpenURL(availabilityUrl));
    console.log('[SafeMeLink SOS] verifica apertura canale', {
      ...diagnostics,
      outcome: canOpen ? 'success' : 'failure',
    });
    if (!canOpen) {
      return { opened: false, technicalFailure: false };
    }
  } catch (error) {
    console.log('[SafeMeLink SOS] verifica apertura canale fallita', {
      ...diagnostics,
      outcome: 'failure',
      errorCategory: getGenericErrorCategory(error),
    });
    return { opened: false, technicalFailure: true };
  }

  try {
    await runLinkingOperation(Linking.openURL(url));
    console.log('[SafeMeLink SOS] apertura canale completata', {
      ...diagnostics,
      outcome: 'success',
    });
    return { opened: true, technicalFailure: false };
  } catch (error) {
    console.log('[SafeMeLink SOS] apertura canale fallita', {
      ...diagnostics,
      outcome: 'failure',
      errorCategory: getGenericErrorCategory(error),
    });
    return { opened: false, technicalFailure: true };
  }
};

export const shareSosAlert = async (event: ActiveSOSEvent, contacts: SafeMeLinkContact[]) => {
  const recipients = contacts.map((contact) => `${contact.name} (${contact.phone})`).join(', ');

  await Share.share({
    message: `${event.message}\n\nContatti fidati: ${recipients}`,
  });
};

export const sendSosAlert = async (
  event: ActiveSOSEvent,
  contacts: SafeMeLinkContact[],
): Promise<SOSLocalDeliveryResult> => {
  const contactsWithValidPhones = getContactsWithValidPhones(contacts);
  const deadlineAt = Date.now() + LOCAL_FALLBACK_DEADLINE_MS;
  let technicalFailure = false;
  const tryUrls = async (urls: string[]) => {
    for (const url of urls) {
      if (Date.now() >= deadlineAt) {
        technicalFailure = true;
        return null;
      }
      const result = await openUrlWithDiagnostics(url);
      technicalFailure ||= result.technicalFailure;
      if (result.opened) {
        return getUrlDiagnostics(url).channel;
      }
    }

    return null;
  };

  for (const contact of contactsWithValidPhones) {
    const preferredUrls =
      contact.preferredChannel === 'whatsapp'
        ? createWhatsAppUrls(event, contact)
        : createSmsUrls(event, contact);
    const fallbackUrls =
      contact.preferredChannel === 'whatsapp'
        ? createSmsUrls(event, contact)
        : createWhatsAppUrls(event, contact);
    const channel = (await tryUrls(preferredUrls)) ?? (await tryUrls(fallbackUrls));

    if (channel) {
      return {
        status: channel === 'whatsapp' ? 'whatsapp_opened' : 'sms_opened',
        channel,
      };
    }
  }

  if ((await tryUrls([createGenericSmsUrl(event)])) === 'sms') {
    return { status: 'sms_opened', channel: 'sms' };
  }

  return {
    status: technicalFailure ? 'technical_error' : 'no_channel',
    channel: null,
  };
};
