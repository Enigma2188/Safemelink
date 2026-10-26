import type { SOSAutomaticSmsResult } from '@/services/SOSAutomaticSmsService';

const reasons: Record<string, string> = {
  sim_absent: 'SIM assente.', sim_not_ready: 'SIM non pronta: verifica sblocco e stato della SIM.',
  default_sim_missing: 'Scegli nelle impostazioni Android una SIM predefinita per gli SMS, anche se usi due SIM.',
  sim_check_unavailable: 'Stato SIM non verificabile sul dispositivo.',
  telephony_unavailable: 'Servizio SMS telefonico non disponibile.', permission_missing: 'Permesso SMS non disponibile.',
  setup_failed: 'Non è stato possibile preparare la verifica di invio SMS.',
  radio_off: 'Radio telefonica disattivata.', no_service: 'Rete telefonica non disponibile.',
  limit_exceeded: 'Limite SMS del sistema raggiunto.', send_failed: 'Android ha segnalato un errore di invio; un messaggio lungo può essere stato inviato solo in parte.',
};
export function automaticSmsFeedback(result: SOSAutomaticSmsResult): string | null {
  const unknown = result.unknownCount ?? 0;
  if (!result.sentCount && !result.failedCount && !unknown && result.status !== 'uncertain') return null;
  return [
    result.requestedCount ? `Richieste SMS affidate al sistema: ${result.requestedCount}.` : null,
    result.sentCount ? `Invio SMS confermato da Android: ${result.sentCount}. La consegna ai destinatari non è verificata.` : null,
    result.failedCount ? `Invio SMS fallito per ${result.failedCount} contatti.` : null,
    unknown || result.status === 'uncertain' ? 'Esito SMS incerto: uno o più messaggi potrebbero essere partiti. Nessun reinvio automatico; verifica prima di inviare manualmente.' : null,
    ...new Set((result.errorReasons ?? []).map(reason => reasons[reason]).filter(Boolean)),
  ].filter(Boolean).join(' ');
}
