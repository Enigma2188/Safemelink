import { PermissionsAndroid, Platform } from 'react-native';
import { SafeMeLinkSms } from 'safemelink-sms';

import type { TrustedContact } from '@/services/ContactsService';
import { getPhoneIdentityKey } from '@/services/PhoneIdentity';
import type { ActiveSOSEvent } from '@/services/SOSService';
import { getSOSSessionWithTimeout } from '@/services/SOSSessionTimeout';
import { SOSAutomaticSmsStorage } from '@/storage/SOSAutomaticSmsStorage';

export type SOSAutomaticSmsResult = {
  status: 'sent' | 'consent_required' | 'permission_required' | 'unavailable' | 'failed';
  reason:
    | 'sent'
    | 'consent_missing'
    | 'permission_missing'
    | 'native_module_unavailable'
    | 'no_eligible_contacts'
    | 'native_send_failed'
    | 'session_changed';
  sentCount: number;
  failedCount: number;
  skippedCount: number;
};

const createEmergencySms = (event: ActiveSOSEvent) =>
  event.location
    ? `SOS SafeMeLink. Ho bisogno di aiuto. Ultima posizione disponibile: https://maps.google.com/?q=${event.location.latitude},${event.location.longitude}${event.location.observedAt ? ` (rilevata ${new Date(event.location.observedAt).toLocaleString()})` : ''}`
    : 'SOS SafeMeLink. Ho bisogno di aiuto. Posizione non disponibile.';

const MAX_AUTOMATIC_SMS_RECIPIENTS = 3;

const getDeliveryTargets = (contacts: TrustedContact[]) => {
  const phones: string[] = [];
  const seen = new Set<string>();
  let skippedCount = 0;

  for (const contact of [...contacts].sort(
    (first, second) => first.priority - second.priority,
  )) {
    const phone = getPhoneIdentityKey(contact.phone, contact.phoneE164);
    if (!phone || seen.has(phone) || phones.length >= MAX_AUTOMATIC_SMS_RECIPIENTS) {
      skippedCount += 1;
      continue;
    }
    seen.add(phone);
    phones.push(phone);
  }

  return { phones, skippedCount };
};

export const SOSAutomaticSmsService = {
  isSupported() {
    return Platform.OS === 'android' && SafeMeLinkSms !== null;
  },

  async getAuthorizationState(userId: string) {
    const consent = await SOSAutomaticSmsStorage.hasConsent(userId);
    const permission =
      Platform.OS === 'android' &&
      (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS));
    return { consent, permission, supported: this.isSupported() };
  },

  async requestAuthorization(userId: string) {
    if (!this.isSupported()) {
      return { consent: false, permission: false, supported: false };
    }
    await SOSAutomaticSmsStorage.setConsent(userId, true);
    const permission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'SMS di emergenza',
        message:
          'SafeMeLink può inviare automaticamente un SMS ai contatti fidati quando attivi un SOS.',
        buttonPositive: 'Consenti',
        buttonNegative: 'Non ora',
      },
    );
    const granted = permission === PermissionsAndroid.RESULTS.GRANTED;
    return { consent: true, permission: granted, supported: true };
  },

  async revokeAuthorization(userId: string) {
    await SOSAutomaticSmsStorage.setConsent(userId, false);
  },

  async sendForSOS(
    userId: string,
    event: ActiveSOSEvent,
    contacts: TrustedContact[],
  ): Promise<SOSAutomaticSmsResult> {
    if (!this.isSupported()) {
      console.info('[SafeMeLink SOS] SMS_AUTOMATIC_FALLBACK_REQUIRED', {
        category: 'native_module_unavailable',
      });
      return {
        status: 'unavailable',
        reason: 'native_module_unavailable',
        sentCount: 0,
        failedCount: 0,
        skippedCount: contacts.length,
      };
    }
    if (!(await SOSAutomaticSmsStorage.hasConsent(userId))) {
      console.info('[SafeMeLink SOS] SMS_AUTOMATIC_FALLBACK_REQUIRED', {
        category: 'consent_missing',
      });
      return {
        status: 'consent_required',
        reason: 'consent_missing',
        sentCount: 0,
        failedCount: 0,
        skippedCount: contacts.length,
      };
    }
    if (!(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS))) {
      console.info('[SafeMeLink SOS] SMS_AUTOMATIC_FALLBACK_REQUIRED', {
        category: 'permission_missing',
      });
      return {
        status: 'permission_required',
        reason: 'permission_missing',
        sentCount: 0,
        failedCount: 0,
        skippedCount: contacts.length,
      };
    }

    const { phones, skippedCount } = getDeliveryTargets(contacts);
    if (phones.length === 0) {
      console.info('[SafeMeLink SOS] SMS_AUTOMATIC_FALLBACK_REQUIRED', {
        category: 'no_eligible_contacts',
      });
      return {
        status: 'unavailable',
        reason: 'no_eligible_contacts',
        sentCount: 0,
        failedCount: 0,
        skippedCount,
      };
    }
    const attempted = await SOSAutomaticSmsStorage.getAttemptedRecipients(userId, event.id);
    const message = createEmergencySms(event);
    let sentCount = 0;
    let failedCount = 0;

    for (const phone of phones) {
      if (attempted.has(phone)) continue;
      const sessionMatches = async () => (await getSOSSessionWithTimeout().catch(() => null))?.user.id === userId;
      const stoppedForAccountChange = (): SOSAutomaticSmsResult => ({
        status: 'failed', reason: 'session_changed', sentCount, failedCount,
        skippedCount: skippedCount + phones.length - sentCount - failedCount,
      });
      if (!(await sessionMatches())) return stoppedForAccountChange();
      // Persist the attempt first: an uncertain native result must never duplicate an emergency SMS.
      if (await SOSAutomaticSmsStorage.markAttempted(userId, event.id, phone) === false) continue;
      // Marker persistence may overlap logout/account switch. Do not hand off A's SMS as B.
      if (!(await sessionMatches())) return stoppedForAccountChange();
      try {
        await SafeMeLinkSms!.sendSms(phone, message);
        sentCount += 1;
        await SOSAutomaticSmsStorage.markResult(userId, event.id, phone, 'handed_to_system').catch(() => undefined);
      } catch {
        failedCount += 1;
        await SOSAutomaticSmsStorage.markResult(userId, event.id, phone, 'unknown').catch(() => undefined);
      }
    }

    console.info('[SafeMeLink SOS] SMS automatici elaborati.', {
      outcome: sentCount > 0 ? 'success' : 'failure',
      sentCount,
      failedCount,
      skippedCount,
    });
    return {
      status: sentCount > 0 ? 'sent' : failedCount > 0 ? 'failed' : 'unavailable',
      reason:
        sentCount > 0
          ? 'sent'
          : failedCount > 0
            ? 'native_send_failed'
            : 'no_eligible_contacts',
      sentCount,
      failedCount,
      skippedCount,
    };
  },
};
