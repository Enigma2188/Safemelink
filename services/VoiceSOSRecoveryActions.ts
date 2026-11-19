import { AuthService } from '@/backend/auth/AuthService';
import { SOSLifecycleService } from '@/services/SOSLifecycleService';
import { SOSClosureRecovery } from '@/services/SOSClosureRecovery';
import { VoiceSOSRecovery, type VoiceSOSRecoveryResult } from '@/services/VoiceSOSRecovery';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { SOSStorage } from '@/storage/SOSStorage';

export function voiceRecoveryMessage(result: VoiceSOSRecoveryResult): string {
  const messages: Record<NonNullable<VoiceSOSRecoveryResult['reason']>, string> = {
    closure_unbound: 'Una chiusura già richiesta non ha un riferimento remoto verificabile. Usa RIPRENDI CHIUSURE GIÀ RICHIESTE; se il riferimento manca ancora, serve ricostruire quel tentativo.',
    closure_journal_unreadable: 'Il registro delle chiusure non è verificabile. I dati sono conservati e l’ascolto resta sospeso.',
    verified_clear: 'Verifica completata: nessun SOS aperto rilevato e riferimenti locali verificati.',
    offline_without_local_evidence: 'Server non raggiungibile. Nessun indizio SOS locale; lo stato remoto non è confermato.',
    remote_active: 'Il server segnala un SOS ancora aperto sul tuo account. La verifica non lo chiude.',
    journal_unreadable: 'La registrazione locale del tentativo SOS non è leggibile. I dati sono conservati.',
    account_changed: 'La sessione è cambiata o non è disponibile. Accedi e ripeti la verifica.',
    binding_conflict: 'I riferimenti locali e remoti del tentativo SOS non coincidono. Serve verificare quel tentativo.',
    unbound_attempt: 'Un precedente tentativo SOS ha esito incerto e manca il suo riferimento remoto. Riprovare da solo non può risolverlo.',
    unbound_local_event: 'Un SOS locale risulta attivo ma manca il riferimento remoto. Serve verificarlo dalla Home.',
    local_close_missing: 'Manca una chiusura verificabile del precedente SOS locale. I dati sono conservati.',
    remote_proof_invalid: 'La risposta remota non conferma identità, proprietà o stato del SOS. Ascolto sospeso.',
    remote_check_failed: 'Impossibile verificare il SOS sul server. Controlla la connessione e riprova.',
  };
  return result.reason ? messages[result.reason] : result.kind === 'active'
    ? messages.remote_active : 'Verifica SOS non completata. Ascolto sospeso.';
}

async function requireCurrent(userId: string, isCurrent: () => boolean) {
  if (!isCurrent() || (await AuthService.getSession())?.user.id !== userId || !isCurrent()) {
    throw new Error('Sessione cambiata. Nessuna nuova operazione autorizzata.');
  }
}

export async function inspectVoiceRecovery(userId: string): Promise<VoiceSOSRecoveryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const events = await SOSStorage.listEvents(userId);
        const result = await VoiceSOSRecovery.inspect(userId, events);
        const localActiveCount = events.filter(event => event.isActive === true && !['closed', 'cancelled'].includes(event.remoteStatus ?? '')).length;
        return { ...result, localActiveCount };
      })(),
      new Promise<VoiceSOSRecoveryResult>(resolve => {
        timer = setTimeout(() => resolve({ kind: 'uncertain', attemptId: null, reason: 'remote_check_failed' }), 12_000);
      }),
    ]);
  } catch { return { kind: 'uncertain', attemptId: null, reason: 'journal_unreadable' }; }
  finally { if (timer) clearTimeout(timer); }
}

// Called only after a separate, explicit user confirmation. Never from inspect(),
// lifecycle, laboratory startup, or a retry. Uses the existing durable close path.
async function closeVerifiedVoiceSOSImpl(userId: string, remoteId: string, isCurrent: () => boolean) {
  await requireCurrent(userId, isCurrent);
  const status = await SOSLifecycleService.getStatus(remoteId);
  await requireCurrent(userId, isCurrent);
  if (status.sos_id !== remoteId || status.is_owner !== true ||
      !['open', 'accepted', 'closed', 'cancelled'].includes(status.sos_status)) {
    throw new Error('SOS non associato all’account attivo o risposta non verificabile.');
  }
  const events = await SOSStorage.listEvents(userId);
  await requireCurrent(userId, isCurrent);
  const sameEvent = events.find(event => event.remoteSosId === remoteId);
  if (status.sos_status === 'open' || status.sos_status === 'accepted') {
    // An orphaned remote SOS can be closed even when Home has no local event.
    // This minimal identity creates only a close intent, never a new SOS.
    const event = sameEvent ?? { id: `recovery:${remoteId}`, remoteSosId: remoteId,
      createdAt: new Date().toISOString(), location: null, message: null, contactIds: [] };
    await SOSClosureRecovery.request(userId, event, 'closed', isCurrent);
    await requireCurrent(userId, isCurrent);
  }
  const terminal = await SOSLifecycleService.getStatus(remoteId);
  await requireCurrent(userId, isCurrent);
  if (terminal.sos_id !== remoteId || terminal.is_owner !== true ||
      !['closed', 'cancelled'].includes(terminal.sos_status)) throw new Error('Chiusura non confermata dal server.');
  if (sameEvent) {
    await SOSStorage.finalizeEvent(userId, sameEvent.id, terminal.sos_status as 'closed' | 'cancelled');
    await requireCurrent(userId, isCurrent);
  }
  VoiceProtectionRuntime.notifySOSClosed(userId, sameEvent?.id, remoteId);
}

async function retryRequestedVoiceClosuresImpl(userId: string, isCurrent: () => boolean) {
  await requireCurrent(userId, isCurrent);
  const result = await SOSClosureRecovery.reconcile(userId, isCurrent);
  await requireCurrent(userId, isCurrent);
  for (const closed of result.completed) VoiceProtectionRuntime.notifySOSClosed(userId, closed.eventId, closed.remoteId);
  return result;
}

// A deadline cannot roll back an already dispatched RPC. The durable intention
// stays available; obsolete continuations must not begin another remote action.
async function withRecoveryDeadline<T>(isCurrent: () => boolean, run: (current: () => boolean) => Promise<T>): Promise<T> {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(() => active && isCurrent()), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { active = false; reject(new Error('Verifica della chiusura scaduta; esito da controllare.')); }, 30_000);
    })]);
  } finally { active = false; if (timer) clearTimeout(timer); }
}
export const retryRequestedVoiceClosures = (userId: string, isCurrent: () => boolean) =>
  withRecoveryDeadline(isCurrent, current => retryRequestedVoiceClosuresImpl(userId, current));
export const closeVerifiedVoiceSOS = (userId: string, remoteId: string, isCurrent: () => boolean) =>
  withRecoveryDeadline(isCurrent, current => closeVerifiedVoiceSOSImpl(userId, remoteId, current));
