import { Linking } from 'react-native';

import type { SafeMeLinkContact } from '@/services/SafeMeLinkContact';
import type { ActiveSOSEvent } from '@/services/SOSService';
import {
  getPhoneIdentityKey,
} from '@/services/PhoneIdentity';

export type SOSLocalDeliveryResult = {
  status: 'not_needed' | 'sms_opened' | 'no_channel' | 'technical_error';
  channel: 'sms' | null;
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

const getUrlDiagnostics = (url: string) => {
  const rawScheme = url.slice(0, Math.max(0, url.indexOf(':'))).toLowerCase();
  const scheme = ['sms', 'smsto'].includes(rawScheme) ? rawScheme : 'unknown';

  return { channel: 'sms' as const, scheme };
};

const getGenericErrorCategory = (error: unknown) =>
  error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';

const openUrlWithDiagnostics = async (url: string): Promise<UrlOpenResult> => {
  const diagnostics = getUrlDiagnostics(url);
  try {
    const canOpen = await runLinkingOperation(Linking.canOpenURL(url));
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
    console.info('[SafeMeLink SOS] SMS_COMPOSER_OPENED');
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
      phoneCanonicalAvailable: Boolean(contact.phoneE164),
    });
    const result = await tryOpenUrls(createSmsUrls(event, contact), deadlineAt);
    technicalFailure ||= result.technicalFailure;
    const channel = result.channel;

    if (channel) {
      return {
        status: 'sms_opened',
        channel: 'sms',
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
