import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { SafeMeLinkSms } from 'safemelink-sms';

import type { TrustedContact } from '@/services/ContactsService';

const MESSAGE = 'SafeMeLink — Segnale Tutela. Una persona che ti ha indicato come contatto fidato vorrebbe che tu la contattassi. Potrebbe avere bisogno di parlare, ma potrebbe non sentirsi ancora pronta a spiegare perché.';
let deliveryInFlight = false;

export type ProtectionSignalContactResult = 'sent' | 'composer' | 'unavailable' | 'failed';

export const ProtectionSignalTrustedContactService = {
  async send(contact: TrustedContact): Promise<ProtectionSignalContactResult> {
    if (deliveryInFlight) return 'failed';
    const phone = contact.phoneE164 ?? contact.phone;
    if (!phone || !contact.remoteId) return 'unavailable';
    deliveryInFlight = true;
    try {
      if (Platform.OS === 'android' && SafeMeLinkSms && await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        { title: 'Invio Segnale Tutela', message: 'Consenti l’invio del messaggio al contatto fidato scelto.', buttonPositive: 'Consenti', buttonNegative: 'Non ora' },
      ) === PermissionsAndroid.RESULTS.GRANTED) {
        await SafeMeLinkSms.sendSms(phone, MESSAGE);
        return 'sent';
      }
      const url = `sms:${phone}?body=${encodeURIComponent(MESSAGE)}`;
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return 'composer';
      }
      return 'unavailable';
    } catch (error: unknown) {
      console.warn('[SafeMeLink Tutela] SILENT_SIGNAL_DELIVERY_FAILED', { category: error instanceof Error ? error.name : 'unknown' });
      return 'failed';
    } finally {
      deliveryInFlight = false;
    }
  },
};
