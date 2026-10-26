import { PermissionsAndroid, Platform } from 'react-native';
import { SafeMeLinkSms } from 'safemelink-sms';

import type { TrustedContact } from '@/services/ContactsService';
import { getPhoneIdentityKey } from '@/services/PhoneIdentity';
import type { ActiveSOSEvent } from '@/services/SOSService';
import { getSOSSessionWithTimeout } from '@/services/SOSSessionTimeout';
import { SOSAutomaticSmsStorage } from '@/storage/SOSAutomaticSmsStorage';

export type SOSAutomaticSmsResult = {
  status: 'sent' | 'uncertain' | 'consent_required' | 'permission_required' | 'unavailable' | 'failed';
  reason:
    | 'sent'
    | 'consent_missing'
    | 'permission_missing'
    | 'native_module_unavailable'
    | 'no_eligible_contacts'
    | 'native_send_failed'
    | 'native_result_unknown'
    | 'session_changed';
  requestedCount?: number;
  unknownCount?: number;
  errorReasons?: string[];
  sentCount: number;
  failedCount: number;
  skippedCount: number;
};

const createEmergencySms = (event: ActiveSOSEvent) =>
  event.location
    ? `SOS SafeMeLink. Ho bisogno di aiuto. Ultima posizione disponibile: https://maps.google.com/?q=${event.location.latitude},${event.location.longitude}${event.location.observedAt ? ` (rilevata ${new Date(event.location.observedAt).toLocaleString()})` : ''}`
    : 'SOS SafeMeLink. Ho bisogno di aiuto. Posizione non disponibile.';

const MAX_AUTOMATIC_SMS_RECIPIENTS = 3;

export type SmsAuthorizationState = {
  consent: boolean;
  permission: boolean;
  supported: boolean;
  consentVerified: boolean;
  permissionVerified: boolean;
  verified: boolean;
  permissionState: 'granted' | 'not_granted' | 'blocked_or_restricted' | 'unknown';
  permanentlyDenied: boolean;
  requestInProgress: boolean;
  problem: 'consent_read' | 'permission_read' | 'consent_write' | 'request_failed' | 'account_changed' | null;
};
let authorizationRequest: { owner: string; promise: Promise<SmsAuthorizationState> } | null = null;
let consentWrites: Promise<unknown> = Promise.resolve();
const writeSmsConsent = (userId: string, value: boolean) => {
  const write = consentWrites.then(() => SOSAutomaticSmsStorage.setConsent(userId, value));
  consentWrites = write.then(() => undefined, () => undefined);
  return write;
};
// Android permission is app/device scoped, not an account consent. This hint is
// deliberately not persisted or claimed as proof of an installer restriction.
let lastPermissionBlocked = false;

export async function awaitSmsAuthorization<T>(promise: Promise<T>, timeoutMs = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('sms_authorization_timeout')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function smsAuthorizationMessage(state: SmsAuthorizationState | null): string {
  if (!state) return 'Stato SMS da verificare.';
  if (!state.supported) return 'Modulo SMS automatici non disponibile in questa installazione. Il composer manuale resta disponibile.';
  if (state.problem === 'consent_write') return 'Consenso non salvato: verifica non completata. Nessuna attivazione confermata; riprova la verifica.';
  if (state.problem || !state.verified) return 'Non è stato possibile verificare consenso e permesso SMS. Lo stato è incerto, non equivale a un permesso negato. Riprova la verifica.';
  if (state.consent && state.permission) return 'Consenso salvato e permesso SMS Android verificato. La consegna dei messaggi viene valutata separatamente.';
  if (state.permissionState === 'blocked_or_restricted') return 'Android non consente una nuova richiesta SMS. Può dipendere da un diniego non più richiedibile o da restrizioni del sistema/installer. Controlla le impostazioni: potrebbero non permettere la concessione. Il composer manuale richiede la tua conferma.';
  if (!state.consent) return 'Il consenso all’invio automatico non è attivo. Puoi abilitarlo esplicitamente, anche prima di aggiungere un contatto.';
  return 'Consenso salvato, ma il permesso SMS Android non è concesso. Premi ATTIVA SMS AUTOMATICI per richiederlo. Il composer manuale richiede la tua conferma.';
}

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

  async getAuthorizationState(userId: string): Promise<SmsAuthorizationState> {
    const [consentResult, permissionResult] = await Promise.all([
      awaitSmsAuthorization(SOSAutomaticSmsStorage.hasConsent(userId), 5_000).then(value => ({ value, known: true }), () => ({ value: false, known: false })),
      awaitSmsAuthorization(Platform.OS === 'android'
        ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS) : Promise.resolve(false), 5_000)
        .then(value => ({ value, known: true }), () => ({ value: false, known: false })),
    ]);
    if (permissionResult.known && permissionResult.value) lastPermissionBlocked = false;
    const permissionState = !permissionResult.known ? 'unknown' : permissionResult.value ? 'granted'
      : lastPermissionBlocked ? 'blocked_or_restricted' : 'not_granted';
    return { consent: consentResult.value, permission: permissionResult.value, supported: this.isSupported(),
      consentVerified: consentResult.known, permissionVerified: permissionResult.known,
      verified: consentResult.known && permissionResult.known, permissionState,
      permanentlyDenied: permissionState === 'blocked_or_restricted', requestInProgress: authorizationRequest !== null,
      problem: !consentResult.known ? 'consent_read' : !permissionResult.known ? 'permission_read' : null };
  },

  requestAuthorization(userId: string, isCurrent: () => boolean = () => true): Promise<SmsAuthorizationState> {
    if (authorizationRequest) {
      // Never open a second Android dialog, even after a UI timeout/remount.
      return authorizationRequest.owner === userId ? authorizationRequest.promise : this.getAuthorizationState(userId);
    }
    const request = (async (): Promise<SmsAuthorizationState> => {
      if (!this.isSupported()) return this.getAuthorizationState(userId);
      const cancelled = async () => ({ ...await this.getAuthorizationState(userId), problem: 'account_changed' as const });
      if (!isCurrent()) return cancelled();
      try { await writeSmsConsent(userId, true); }
      catch { return { ...await this.getAuthorizationState(userId), problem: 'consent_write' }; }
      if (!isCurrent()) return cancelled();
      try {
        const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        if (!isCurrent()) return cancelled();
        if (!granted) {
          const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
            title: 'SMS di emergenza',
            message: 'SafeMeLink può inviare automaticamente un SMS ai contatti fidati quando attivi un SOS.',
            buttonPositive: 'Consenti', buttonNegative: 'Non ora',
          });
          lastPermissionBlocked = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
        }
      } catch { return { ...await this.getAuthorizationState(userId), problem: 'request_failed' }; }
      if (!isCurrent()) return cancelled();
      // A GRANTED callback is not sufficient: re-read the current permission.
      return this.getAuthorizationState(userId);
    })().then(state => ({ ...state, requestInProgress: false }));
    const pending = request.finally(() => { if (authorizationRequest?.promise === pending) authorizationRequest = null; });
    authorizationRequest = { owner: userId, promise: pending };
    return pending;
  },

  async revokeAuthorization(userId: string) {
    await writeSmsConsent(userId, false);
  },

  async sendForSOS(
    userId: string,
    event: ActiveSOSEvent,
    contacts: TrustedContact[],
  ): Promise<SOSAutomaticSmsResult> {
    console.info('[SafeMeLink SOS] SMS_CONTACTS_LOADED', { count: contacts.length, nativeAvailable: this.isSupported() });
    if (contacts.length === 0) {
      return { status: 'unavailable', reason: 'no_eligible_contacts', sentCount: 0, failedCount: 0, skippedCount: 0 };
    }
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
    console.info('[SafeMeLink SOS] SMS_ELIGIBILITY', { permission: 'granted', eligibleCount: phones.length, skippedCount });
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
    let unknownCount = 0;
    let requestedCount = 0;
    const errorReasons: string[] = [];

    for (const phone of phones) {
      if (attempted.has(phone)) continue;
      const sessionMatches = async () => (await getSOSSessionWithTimeout().catch(() => null))?.user.id === userId;
      const stoppedForAccountChange = (): SOSAutomaticSmsResult => ({
        status: 'failed', reason: 'session_changed', sentCount, failedCount, unknownCount, requestedCount, errorReasons,
        skippedCount: skippedCount + phones.length - sentCount - failedCount - unknownCount,
      });
      if (!(await sessionMatches())) return stoppedForAccountChange();
      // Persist the attempt first: an uncertain native result must never duplicate an emergency SMS.
      if (await SOSAutomaticSmsStorage.markAttempted(userId, event.id, phone) === false) continue;
      // Marker persistence may overlap logout/account switch. Do not hand off A's SMS as B.
      if (!(await sessionMatches())) return stoppedForAccountChange();
      try {
        console.info('[SafeMeLink SOS] SMS_NATIVE_ATTEMPT');
        const result = await SafeMeLinkSms!.sendSosSmsWithResult(phone, message);
        if (!result || !/^[0-9a-f-]{36}$/i.test(result.attemptId) || result.delivery !== 'not_verified' ||
          !['sent', 'failed', 'unknown'].includes(result.status) || typeof result.requested !== 'boolean' ||
          (result.status === 'sent' && !result.requested)) throw new Error('invalid_native_result');
        if (result.requested) requestedCount++;
        const safeReason = ['permission_missing', 'invalid_input', 'telephony_unavailable', 'sim_absent',
          'sim_not_ready', 'default_sim_missing', 'sim_check_unavailable', 'radio_off', 'no_service',
          'limit_exceeded', 'send_failed', 'sent_confirmation_timeout', 'native_result_unknown', 'setup_failed'].includes(result.reason)
          ? result.reason : 'native_result_unknown';
        if (result.status === 'sent') sentCount++;
        else { if (result.status === 'failed') failedCount++; else unknownCount++; errorReasons.push(safeReason); }
        console.info('[SafeMeLink SOS] SMS_NATIVE_RESULT', { outcome: result.status });
        await SOSAutomaticSmsStorage.markResult(userId, event.id, phone,
          result.status === 'sent' ? 'sent_confirmed' : result.status === 'failed' ? 'failed' : 'unknown').catch(() => undefined);
      } catch {
        console.info('[SafeMeLink SOS] SMS_NATIVE_RESULT', { outcome: 'unknown' });
        unknownCount += 1;
        errorReasons.push('native_result_unknown');
        await SOSAutomaticSmsStorage.markResult(userId, event.id, phone, 'unknown').catch(() => undefined);
      }
    }

    console.info('[SafeMeLink SOS] SMS automatici elaborati.', {
      outcome: unknownCount > 0 ? 'unknown' : sentCount > 0 ? 'sent_confirmed' : failedCount > 0 ? 'failed' : 'not_requested',
      sentCount,
      failedCount,
      skippedCount,
      unknownCount,
      requestedCount,
      attemptedCount: sentCount + failedCount + unknownCount,
    });
    return {
      status: sentCount > 0 ? 'sent' : unknownCount > 0 ? 'uncertain' : failedCount > 0 ? 'failed' : 'unavailable',
      reason:
        sentCount > 0
          ? 'sent'
          : unknownCount > 0 ? 'native_result_unknown'
          : failedCount > 0
            ? 'native_send_failed'
            : 'no_eligible_contacts',
      sentCount,
      failedCount,
      skippedCount,
      unknownCount,
      requestedCount,
      errorReasons,
    };
  },
};
