import type { Json } from '@/backend/database.types';
import { requireSupabaseClient } from '@/backend/supabaseClient';
import { runRemoteRequest } from '@/backend/remoteRequest';

export const PRIVATE_TEXT_LIMITS = { ice_name: 100, ice_relation: 100, ice_phone: 16,
  stalking: 1000, domestic_violence: 1000, other_risk: 1000, instructions: 2000 } as const;
export type PrivateTextField = keyof typeof PRIVATE_TEXT_LIMITS;
export type PrivateDetails = Record<PrivateTextField, string> & { share_ice: boolean; share_ice_phone: boolean; share_safety: boolean };
export const EMPTY_PRIVATE_DETAILS: PrivateDetails = { ice_name: '', ice_relation: '', ice_phone: '', stalking: '',
  domestic_violence: '', other_risk: '', instructions: '', share_ice: false, share_ice_phone: false, share_safety: false };
const object = (value: Json): Record<string, Json | undefined> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
export function validatePrivateDetails(value: PrivateDetails) {
  for (const field of Object.keys(PRIVATE_TEXT_LIMITS) as PrivateTextField[]) {
    if (typeof value[field] !== 'string' || value[field].trim().length > PRIVATE_TEXT_LIMITS[field]) throw new Error('Campo non valido o troppo lungo.');
  }
  for (const field of ['share_ice', 'share_ice_phone', 'share_safety'] as const) if (typeof value[field] !== 'boolean') throw new Error('Consenso non valido.');
  if (value.ice_phone.trim() && !/^\+[1-9][0-9]{6,14}$/.test(value.ice_phone.trim())) throw new Error('Numero ICE: usa + e prefisso internazionale, senza spazi.');
  if (value.share_ice && !value.ice_name.trim()) throw new Error('Inserisci il nome ICE prima di condividerlo.');
  if (value.share_ice_phone && (!value.share_ice || !value.ice_phone.trim())) throw new Error('Per condividere il numero servono ICE condiviso e numero valido.');
  if (value.share_safety && ![value.stalking, value.domestic_violence, value.other_risk, value.instructions].some(v => v.trim())) throw new Error('Inserisci almeno una informazione prima di condividerla.');
}
export function parseOwnedPrivateDetails(value: Json, owner: string): PrivateDetails {
  if (value === null) return { ...EMPTY_PRIVATE_DETAILS };
  const row = object(value);
  if (!row || row.user_id !== owner) throw new Error('Risposta non verificabile.');
  const draft = { ...EMPTY_PRIVATE_DETAILS };
  for (const field of Object.keys(PRIVATE_TEXT_LIMITS) as PrivateTextField[]) {
    if (row[field] !== null && typeof row[field] !== 'string') throw new Error('Risposta non verificabile.');
    draft[field] = typeof row[field] === 'string' ? row[field] : '';
  }
  for (const field of ['share_ice', 'share_ice_phone', 'share_safety'] as const) {
    if (typeof row[field] !== 'boolean') throw new Error('Risposta non verificabile.');
    draft[field] = row[field];
  }
  validatePrivateDetails(draft); return draft;
}
export function privateReceivedFields(value: Json, sosId: string): { label: string; value: string }[] {
  const row = object(value);
  if (!row || row.sos_id !== sosId || row.declared_by_user !== true) return [];
  const fields: { label: string; value: string }[] = [];
  const add = (key: PrivateTextField, label: string) => {
    const v = row[key]; if (typeof v === 'string' && v.trim() && v.length <= PRIVATE_TEXT_LIMITS[key]) fields.push({ label, value: v.trim() });
  };
  if (row.share_ice === true) {
    add('ice_name', 'Nome ICE'); add('ice_relation', 'Relazione ICE');
    if (row.share_ice_phone === true && typeof row.ice_phone === 'string' && /^\+[1-9][0-9]{6,14}$/.test(row.ice_phone)) add('ice_phone', 'Numero ICE autorizzato');
  }
  if (row.share_safety === true) {
    add('stalking', 'Stalking — dichiarazione personale'); add('domestic_violence', 'Violenza domestica — dichiarazione personale');
    add('other_risk', 'Altra situazione di rischio'); add('instructions', 'Indicazioni personali');
  }
  return fields;
}
export const EmergencyPrivateDetailsService = {
  async load(owner: string) {
    const { data, error } = await runRemoteRequest(async signal => await requireSupabaseClient().rpc('get_my_emergency_private_details', { expected_owner_id: owner }).abortSignal(signal), 'Verifica non completata. Riprova.');
    if (error) throw new Error('Sezione non disponibile: richiede il backend aggiornato o una nuova verifica.');
    return parseOwnedPrivateDetails(data, owner);
  },
  async save(owner: string, draft: PrivateDetails) {
    validatePrivateDetails(draft);
    const { data, error } = await runRemoteRequest(async signal => await requireSupabaseClient().rpc('update_my_emergency_private_details', {
      expected_owner_id: owner, next_ice_name: draft.ice_name, next_ice_relation: draft.ice_relation, next_ice_phone: draft.ice_phone,
      next_stalking: draft.stalking, next_domestic_violence: draft.domestic_violence, next_other_risk: draft.other_risk,
      next_instructions: draft.instructions, next_share_ice: draft.share_ice, next_share_ice_phone: draft.share_ice_phone, next_share_safety: draft.share_safety,
    }).abortSignal(signal), 'Salvataggio non confermato: verifica i dati sul server prima di riprovare.');
    if (error || data === null) throw new Error('Salvataggio non confermato. Ricarica per verificare.');
    return parseOwnedPrivateDetails(data, owner);
  },
  async remove(owner: string) {
    const { error } = await runRemoteRequest(async signal => await requireSupabaseClient().rpc('delete_my_emergency_private_details', { expected_owner_id: owner }).abortSignal(signal), 'Cancellazione non confermata. Ricarica per verificare.');
    if (error) throw new Error('Cancellazione non confermata. Ricarica per verificare.');
  },
  async received(sosId: string) {
    const { data, error } = await runRemoteRequest(async signal => await requireSupabaseClient().rpc('get_received_sos_private_details', { target_sos_id: sosId }).abortSignal(signal), 'Verifica non completata.');
    if (error) return [];
    return privateReceivedFields(data, sosId);
  },
};
