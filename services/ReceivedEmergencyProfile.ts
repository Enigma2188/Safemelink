import { EmergencyProfileService } from '@/services/EmergencyProfileService';

type SharedProfile = Awaited<ReturnType<typeof EmergencyProfileService.getSharedForSOS>>;
export type EmergencyInformation = { label: string; value: string }[];
export type EmergencyInformationResult =
  | { kind: 'loading' | 'empty' | 'error'; fields: [] }
  | { kind: 'available'; fields: EmergencyInformation };

// Presentation defence only: the existing RPC remains the authorization boundary.
export function getEmergencyInformation(row: SharedProfile, sosId: string): EmergencyInformation {
  if (!row || row.sos_id !== sosId || row.declared_by_user !== true) return [];
  const fields: EmergencyInformation = [];
  const add = (label: string, value: string | null) => {
    if (typeof value === 'string' && value.trim()) fields.push({ label, value: value.trim() });
  };
  if (row.medical_data_shared === true) {
    add('Gruppo sanguigno dichiarato', row.declared_blood_group);
    add('Allergie', row.severe_allergies);
    add('Patologie', row.important_conditions);
    add('Farmaci', row.relevant_medications);
    add('Farmaci salvavita', row.lifesaving_medications);
    add('Note autorizzate', row.emergency_notes);
  }
  if (row.ice_contact_shared === true) add('Contatto ICE', row.ice_contact);
  return fields;
}

export class ReceivedEmergencyProfileRequest {
  private generation = 0;
  constructor(private readonly publish: (result: EmergencyInformationResult) => void) {}
  clear() { this.generation++; this.publish({ kind: 'empty', fields: [] }); }
  async load(sosId: string, isCurrent: () => boolean) {
    this.clear();
    const generation = this.generation;
    if (isCurrent()) this.publish({ kind: 'loading', fields: [] });
    try {
      const row = await EmergencyProfileService.getSharedForSOS(sosId);
      if (generation === this.generation && isCurrent()) {
        const fields = getEmergencyInformation(row, sosId);
        this.publish(fields.length ? { kind: 'available', fields } : { kind: 'empty', fields: [] });
      }
    } catch {
      // Never log protected contents or reuse the previous successful response.
      if (generation === this.generation && isCurrent()) this.publish({ kind: 'error', fields: [] });
    }
  }
}
