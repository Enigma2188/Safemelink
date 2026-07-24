import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

export type EmergencyProfileUpdate = {
  declaredBloodGroup: string | null;
  severeAllergies: string | null;
  importantConditions: string | null;
  relevantMedications: string | null;
  lifesavingMedications: string | null;
  iceContact: string | null;
  emergencyNotes: string | null;
  shareMedicalDataDuringSOS: boolean;
  shareICEContactDuringSOS: boolean;
};

export const EmergencyProfileRepository = {
  async getCurrent() {
    const { data, error } = await requireSupabaseClient()
      .rpc('get_my_emergency_profile')
      .single();

    if (error) {
      throw new BackendError('Impossibile caricare il Profilo di Emergenza.', error);
    }

    return data;
  },

  async updateCurrent(profile: EmergencyProfileUpdate) {
    const { data, error } = await requireSupabaseClient()
      .rpc('update_my_emergency_profile', {
        next_declared_blood_group: profile.declaredBloodGroup,
        next_severe_allergies: profile.severeAllergies,
        next_important_conditions: profile.importantConditions,
        next_relevant_medications: profile.relevantMedications,
        next_lifesaving_medications: profile.lifesavingMedications,
        next_ice_contact: profile.iceContact,
        next_emergency_notes: profile.emergencyNotes,
        next_share_medical_data_during_sos: profile.shareMedicalDataDuringSOS,
        next_share_ice_contact_during_sos: profile.shareICEContactDuringSOS,
      })
      .single();

    if (error) {
      throw new BackendError('Impossibile salvare il Profilo di Emergenza.', error);
    }

    return data;
  },

  async getForReceivedSOS(sosId: string) {
    const { data, error } = await requireSupabaseClient()
      .rpc('get_received_sos_emergency_profile', { target_sos_id: sosId })
      .maybeSingle();

    if (error) {
      throw new BackendError('Impossibile caricare i dati di emergenza condivisi.', error);
    }

    return data;
  },
};
