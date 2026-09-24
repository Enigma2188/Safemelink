import { requireSupabaseClient } from '@/backend/supabaseClient';
import { LocationService } from '@/services/LocationService';

export type ProtectionSignalDraft = {
  subjectRelation: 'SELF' | 'WITNESSED' | 'TOLD' | 'PREFER_NOT_TO_SAY';
  category: 'HUMILIATION' | 'THREATS' | 'ASSAULT' | 'EXCLUSION' | 'PRESSURE' | 'CYBERBULLYING' | 'OTHER';
  frequency: 'ONCE' | 'REPEATED' | 'OFTEN' | 'UNKNOWN';
  placeType: 'SCHOOL' | 'COMMUTE' | 'SPORT' | 'PUBLIC_PLACE' | 'ONLINE' | 'OTHER';
  onlineContext?: 'SOCIAL' | 'CHAT' | 'GAMING' | 'OTHER';
  needsHelp: 'NO' | 'ADULT' | 'DANGER_NOW';
  trustedContactId?: string | null;
};

const roundArea = (value: number) => value.toFixed(2);

export const ProtectionSignalService = {
  async getAreaAlerts() {
    const location = await LocationService.getCurrentLocation({
      allowLastKnownLocation: true,
      timeoutMs: 8_000,
    }).catch(() => null);
    if (!location) return [];
    const areaBucket = `${roundArea(location.latitude)},${roundArea(location.longitude)}`;
    const { data, error } = await requireSupabaseClient().rpc('list_protection_area_alerts' as never, {
      target_area_bucket: areaBucket,
    } as never);
    if (error) throw error;
    return (data ?? []) as { context_label: string; category: string; period_label: string }[];
  },

  async create(draft: ProtectionSignalDraft) {
    if (draft.needsHelp === 'DANGER_NOW') {
      throw new Error('Per un pericolo immediato usa il normale SOS SafeMeLink.');
    }
    if (draft.placeType === 'ONLINE') {
      return requireSupabaseClient().rpc('create_protection_signal' as never, {
        target_subject_relation: draft.subjectRelation,
        target_category: draft.category,
        target_frequency: draft.frequency,
        target_place_type: draft.placeType,
        target_online_context: draft.onlineContext ?? null,
        target_approximate_area: null,
        target_area_bucket: null,
        target_needs_help: draft.needsHelp,
        target_trusted_contact_id: draft.trustedContactId ?? null,
      } as never);
    }
    const location = await LocationService.getCurrentLocation({
      allowLastKnownLocation: true,
      timeoutMs: 8_000,
    }).catch(() => null);
    const approximateArea = location
      ? `${roundArea(location.latitude)},${roundArea(location.longitude)}`
      : null;
    return requireSupabaseClient().rpc('create_protection_signal' as never, {
      target_subject_relation: draft.subjectRelation,
      target_category: draft.category,
      target_frequency: draft.frequency,
      target_place_type: draft.placeType,
      target_online_context: null,
      target_approximate_area: approximateArea,
      target_area_bucket: approximateArea,
      target_needs_help: draft.needsHelp,
      target_trusted_contact_id: draft.trustedContactId ?? null,
    } as never);
  },
};
