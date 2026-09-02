import { PermissionsAndroid, Platform } from 'react-native';
import { SafeMeLinkSms } from 'safemelink-sms';

import type { TrustedContact } from '@/services/ContactsService';
import { getPhoneIdentityKey } from '@/services/PhoneIdentity';
import type { ActiveSOSEvent } from '@/services/SOSService';
import { SOSAutomaticSmsStorage } from '@/storage/SOSAutomaticSmsStorage';

export type SOSAutomaticSmsResult = {
  status: 'sent' | 'consent_required' | 'permission_required' | 'unavailable' | 'failed';
  reason:
    | 'sent'
    | 'consent_missing'
    | 'permission_missing'
    | 'native_module_unavailable'
    | 'no_eligible_contacts'
    | 'native_send_failed';
  sentCount: number;
  failedCount: number;
};

const createEmergencySms = (event: ActiveSOSEvent) =>
  `SOS SafeMeLink. Ho bisogno di aiuto. Posizione: https://maps.google.com/?q=${event.location.latitude},${event.location.longitude}`;

const getUniquePhones = (contacts: TrustedContact[]) => [
  ...new Set(
    contacts
      .map((contact) => getPhoneIdentityKey(contact.phone, contact.phoneE164))
      .filter((phone): phone is string => Boolean(phone)),
  ),
];

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
      };
    }

    const phones = getUniquePhones(contacts);
    if (phones.length === 0) {
      console.info('[SafeMeLink SOS] SMS_AUTOMATIC_FALLBACK_REQUIRED', {
        category: 'no_eligible_contacts',
      });
      return {
        status: 'unavailable',
        reason: 'no_eligible_contacts',
        sentCount: 0,
        failedCount: 0,
      };
    }
    const attempted = await SOSAutomaticSmsStorage.getAttemptedRecipients(userId, event.id);
    const message = createEmergencySms(event);
    let sentCount = 0;
    let failedCount = 0;

    for (const phone of phones) {
      if (attempted.has(phone)) continue;
      // Persist the attempt first: an uncertain native result must never duplicate an emergency SMS.
      await SOSAutomaticSmsStorage.markAttempted(userId, event.id, phone);
      try {
        await SafeMeLinkSms!.sendSms(phone, message);
        sentCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    console.info('[SafeMeLink SOS] SMS automatici elaborati.', {
      outcome: sentCount > 0 ? 'success' : 'failure',
      sentCount,
      failedCount,
      skippedCount: phones.length - sentCount - failedCount,
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
    };
  },
};
