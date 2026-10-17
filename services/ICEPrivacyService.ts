import type { Json } from '@/backend/database.types';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import { runRemoteRequest } from '@/backend/remoteRequest';
export type ICEPrivacyStatus = { owner_id: string; verified_at: string; legacy_shared: boolean; legacy_text_present: boolean;
  structured_shared: boolean; phone_shared: boolean; safety_shared: boolean;
  ice_blocked?: boolean; ice_revision?: string; consent_version?: string | null };
export function parseICEPrivacyStatus(value: Json, owner: string): ICEPrivacyStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.owner_id !== owner ||
    typeof value.verified_at !== 'string' || !Number.isFinite(Date.parse(value.verified_at))) throw new Error('Stato privacy non verificabile.');
  for (const key of ['legacy_shared', 'legacy_text_present', 'structured_shared', 'phone_shared', 'safety_shared'])
    if (typeof value[key] !== 'boolean') throw new Error('Stato privacy incompleto.');
  if (value.phone_shared && !value.structured_shared) throw new Error('Consensi incoerenti.');
  if ('ice_blocked' in value) {
    if (typeof value.ice_blocked !== 'boolean' || typeof value.ice_revision !== 'string' || !/^\d+$/.test(value.ice_revision) ||
      (value.consent_version !== null && value.consent_version !== 'ICE_V1') ||
      (value.ice_blocked && (value.legacy_shared || value.structured_shared || value.phone_shared))) throw new Error('Protezione ICE non verificabile.');
  }
  return value as ICEPrivacyStatus;
}
export function describeICEPrivacy(status: ICEPrivacyStatus) {
  if (status.ice_blocked === true) return 'Alla verifica server la revoca ICE risultava protetta: le vecchie RPC non possono riattivarla. Serve un nuovo consenso esplicito. Non ritira dati già visti o copiati.';
  if (status.legacy_shared) return 'ICE legacy condiviso: il numero non può essere considerato nascosto dal nuovo consenso telefonico.';
  if (status.phone_shared) return 'Numero ICE strutturato condiviso con i contatti fidati autorizzati durante il SOS.';
  if (status.structured_shared) return 'Nome e relazione ICE condivisi; numero strutturato non condiviso. ICE legacy OFF.';
  return 'Alla verifica server tutti i consensi ICE risultavano OFF. Non è una garanzia di occultamento globale del numero.';
}
export const ICEPrivacyService = {
  async status(owner: string) {
    const { data, error } = await runRemoteRequest(async signal => await requireSupabaseClient()
      .rpc('get_my_ice_privacy_status', { expected_owner_id: owner }).abortSignal(signal), 'Verifica privacy non completata.');
    if (error) throw new Error('Stato ICE non disponibile: è necessario il backend privacy aggiornato.');
    return parseICEPrivacyStatus(data, owner);
  },
  async revoke(owner: string) {
    const { data, error } = await runRemoteRequest(async signal => await requireSupabaseClient()
      .rpc('revoke_my_all_ice_sharing', { expected_owner_id: owner }).abortSignal(signal), 'Revoca non confermata. Verifica il server prima di riprovare.');
    if (error) throw new Error('Revoca non confermata. Nessuna conferma di privacy disponibile.');
    const status = parseICEPrivacyStatus(data, owner);
    if (status.legacy_shared || status.structured_shared || status.phone_shared) throw new Error('Revoca non confermata dal server.');
    return status;
  },
};
