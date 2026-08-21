import { Linking, Share } from 'react-native';

import type { SafeMeLinkContact } from '@/services/SafeMeLinkContact';
import type { ActiveSOSEvent } from '@/services/SOSService';
import {
  getPhoneIdentityKey,
  isValidE164Phone,
} from '@/services/PhoneIdentity';

export type SOSLocalDeliveryResult = {
  status: 'not_needed' | 'whatsapp_opened' | 'sms_opened' | 'no_channel' | 'technical_error';
  channel: 'whatsapp' | 'sms' | null;
  smsFollowUpAvailable?: boolean;
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
    (first, second) => first.priority - second.priority,
  );

  for (const contact of orderedContacts) {
    const phone = normalizePhoneNumber(contact.phone);

    if (!phone) {
      continue;
    }

    const phoneE164 = getPhoneIdentityKey(phone, contact.phoneE164);
    const identity = phoneE164 ?? `sms:${phone}`;

    if (!uniqueContacts.has(identity)) {
      uniqueContacts.set(identity, { ...contact, phone, phoneE164 });
    } else {
      console.info('[SafeMeLink SOS] DUPLICATE_CANONICAL_REMOVED');
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
  const compactPhone = contact.phoneE164;

  if (!isValidE164Phone(compactPhone)) {
    console.info('[SafeMeLink SOS] PHONE_CANONICAL_INVALID', {
      channel: 'whatsapp',
      outcome: 'skipped',
    });
    return [];
  }

  console.info('[SafeMeLink SOS] PHONE_CANONICAL_VALID');

  const phone = compactPhone!.slice(1);

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
    if (diagnostics.channel === 'whatsapp') {
      console.info(
        `[SafeMeLink SOS] ${canOpen ? 'WHATSAPP_HANDLER_AVAILABLE' : 'WHATSAPP_HANDLER_UNAVAILABLE'}`,
      );
    }
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
    console.info(
      `[SafeMeLink SOS] ${diagnostics.channel === 'whatsapp' ? 'WHATSAPP_COMPOSER_OPENED' : 'SMS_COMPOSER_OPENED'}`,
    );
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

const tryOpenUrls = async (urls: string[], deadlineAt: number) => {
  let technicalFailure = false;

  for (const url of urls) {
    if (Date.now() >= deadlineAt) {
      return { channel: null, technicalFailure: true } as const;
    }

    const result = await openUrlWithDiagnostics(url);
    technicalFailure ||= result.technicalFailure;
    if (result.opened) {
      return { channel: getUrlDiagnostics(url).channel, technicalFailure } as const;
    }
  }

  return { channel: null, technicalFailure } as const;
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

  for (const contact of contactsWithValidPhones) {
    console.info('[SafeMeLink SOS] destinatario fallback valutato', {
      contactSource: contact.userId ? 'CONTACT_SOURCE_LINKED' : 'CONTACT_SOURCE_LOCAL',
      phonePresent: true,
      phoneE164Valid: isValidE164Phone(contact.phoneE164),
    });
    console.info(
      `[SafeMeLink SOS] ${contact.preferredChannel === 'whatsapp' ? 'PREFERRED_WHATSAPP' : 'PREFERRED_SMS'}`,
    );
    const preferredUrls =
      contact.preferredChannel === 'whatsapp'
        ? createWhatsAppUrls(event, contact)
        : createSmsUrls(event, contact);
    const fallbackUrls =
      contact.preferredChannel === 'whatsapp'
        ? createSmsUrls(event, contact)
        : createWhatsAppUrls(event, contact);
    const preferredResult = await tryOpenUrls(preferredUrls, deadlineAt);
    technicalFailure ||= preferredResult.technicalFailure;
    const fallbackResult = preferredResult.channel
      ? null
      : await tryOpenUrls(fallbackUrls, deadlineAt);
    technicalFailure ||= fallbackResult?.technicalFailure ?? false;
    const channel = preferredResult.channel ?? fallbackResult?.channel ?? null;

    if (channel) {
      return {
        status: channel === 'whatsapp' ? 'whatsapp_opened' : 'sms_opened',
        channel,
        ...(channel === 'whatsapp' ? { smsFollowUpAvailable: true } : {}),
      };
    }
  }

  const genericSmsResult = await tryOpenUrls([createGenericSmsUrl(event)], deadlineAt);
  technicalFailure ||= genericSmsResult.technicalFailure;
  if (genericSmsResult.channel === 'sms') {
    return { status: 'sms_opened', channel: 'sms' };
  }

  return {
    status: technicalFailure ? 'technical_error' : 'no_channel',
    channel: null,
  };
};

export const sendSosSmsFallback = async (
  event: ActiveSOSEvent,
  contacts: SafeMeLinkContact[],
): Promise<SOSLocalDeliveryResult> => {
  const deadlineAt = Date.now() + LOCAL_FALLBACK_DEADLINE_MS;
  let technicalFailure = false;

  for (const contact of getContactsWithValidPhones(contacts)) {
    const result = await tryOpenUrls(createSmsUrls(event, contact), deadlineAt);
    technicalFailure ||= result.technicalFailure;

    if (result.channel === 'sms') {
      return { status: 'sms_opened', channel: 'sms' };
    }
  }

  const genericResult = await tryOpenUrls([createGenericSmsUrl(event)], deadlineAt);
  technicalFailure ||= genericResult.technicalFailure;

  return genericResult.channel === 'sms'
    ? { status: 'sms_opened', channel: 'sms' }
    : {
        status: technicalFailure ? 'technical_error' : 'no_channel',
        channel: null,
      };
};
