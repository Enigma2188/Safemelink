import {
  EmergencyProfileRepository,
  type EmergencyProfileUpdate,
} from '@/backend/repositories/EmergencyProfileRepository';

export const EMERGENCY_PROFILE_LIMITS = {
  severeAllergies: 1000,
  importantConditions: 1000,
  relevantMedications: 1000,
  lifesavingMedications: 1000,
  iceContact: 300,
  emergencyNotes: 2000,
} as const;

const VALID_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

export type EmergencyProfileDraft = {
  declaredBloodGroup: string;
  severeAllergies: string;
  importantConditions: string;
  relevantMedications: string;
  lifesavingMedications: string;
  iceContact: string;
  emergencyNotes: string;
  shareMedicalDataDuringSOS: boolean;
  shareICEContactDuringSOS: boolean;
};

export type EmergencyProfile = EmergencyProfileDraft & {
  updatedAt: string | null;
};

export type EmergencyProfileValidation =
  | { valid: true; normalized: EmergencyProfileUpdate }
  | { valid: false; message: string };

export const EMPTY_EMERGENCY_PROFILE: EmergencyProfileDraft = {
  declaredBloodGroup: '',
  severeAllergies: '',
  importantConditions: '',
  relevantMedications: '',
  lifesavingMedications: '',
  iceContact: '',
  emergencyNotes: '',
  shareMedicalDataDuringSOS: false,
  shareICEContactDuringSOS: false,
};

export function normalizeDeclaredBloodGroup(value: string) {
  return value.trim().toUpperCase().replaceAll('0', 'O');
}

const normalizeOptionalText = (value: string) => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export function validateEmergencyProfile(
  draft: EmergencyProfileDraft,
): EmergencyProfileValidation {
  const declaredBloodGroup = normalizeDeclaredBloodGroup(draft.declaredBloodGroup);

  if (declaredBloodGroup && !VALID_BLOOD_GROUPS.has(declaredBloodGroup)) {
    return {
      valid: false,
      message: 'Gruppo sanguigno non valido. Usa A, B, AB o O con segno + o -.',
    };
  }

  const fields = [
    ['Allergie gravi', draft.severeAllergies, EMERGENCY_PROFILE_LIMITS.severeAllergies],
    ['Patologie importanti', draft.importantConditions, EMERGENCY_PROFILE_LIMITS.importantConditions],
    ['Farmaci o terapie', draft.relevantMedications, EMERGENCY_PROFILE_LIMITS.relevantMedications],
    ['Farmaci salvavita', draft.lifesavingMedications, EMERGENCY_PROFILE_LIMITS.lifesavingMedications],
    ['Contatto ICE', draft.iceContact, EMERGENCY_PROFILE_LIMITS.iceContact],
    ['Note di emergenza', draft.emergencyNotes, EMERGENCY_PROFILE_LIMITS.emergencyNotes],
  ] as const;

  const oversizedField = fields.find(([, value, limit]) => value.trim().length > limit);

  if (oversizedField) {
    return {
      valid: false,
      message: `${oversizedField[0]} supera il limite di ${oversizedField[2]} caratteri.`,
    };
  }

  return {
    valid: true,
    normalized: {
      declaredBloodGroup: declaredBloodGroup || null,
      severeAllergies: normalizeOptionalText(draft.severeAllergies),
      importantConditions: normalizeOptionalText(draft.importantConditions),
      relevantMedications: normalizeOptionalText(draft.relevantMedications),
      lifesavingMedications: normalizeOptionalText(draft.lifesavingMedications),
      iceContact: normalizeOptionalText(draft.iceContact),
      emergencyNotes: normalizeOptionalText(draft.emergencyNotes),
      shareMedicalDataDuringSOS: draft.shareMedicalDataDuringSOS,
      shareICEContactDuringSOS: draft.shareICEContactDuringSOS,
    },
  };
}

const mapStoredProfile = (
  row: Awaited<ReturnType<typeof EmergencyProfileRepository.getCurrent>>,
): EmergencyProfile =>
  row
    ? {
        declaredBloodGroup: row.declared_blood_group ?? '',
        severeAllergies: row.severe_allergies ?? '',
        importantConditions: row.important_conditions ?? '',
        relevantMedications: row.relevant_medications ?? '',
        lifesavingMedications: row.lifesaving_medications ?? '',
        iceContact: row.ice_contact ?? '',
        emergencyNotes: row.emergency_notes ?? '',
        shareMedicalDataDuringSOS: row.share_medical_data_during_sos,
        shareICEContactDuringSOS: row.share_ice_contact_during_sos,
        updatedAt: row.profile_updated_at,
      }
    : {
        ...EMPTY_EMERGENCY_PROFILE,
        updatedAt: null,
      };

export const EmergencyProfileService = {
  async getCurrent() {
    return mapStoredProfile(await EmergencyProfileRepository.getCurrent());
  },

  async save(draft: EmergencyProfileDraft) {
    const validation = validateEmergencyProfile(draft);

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    return mapStoredProfile(
      await EmergencyProfileRepository.updateCurrent(validation.normalized),
    );
  },

  async getSharedForSOS(sosId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sosId)) {
      throw new Error('Identificativo SOS non valido.');
    }

    return EmergencyProfileRepository.getForReceivedSOS(sosId);
  },
};
