import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useEmergencyProfile } from '@/hooks/useEmergencyProfile';
import {
  EMERGENCY_PROFILE_LIMITS,
  validateEmergencyProfile,
  type EmergencyProfileDraft,
} from '@/services/EmergencyProfileService';

type TextFieldName = Exclude<
  keyof EmergencyProfileDraft,
  'shareMedicalDataDuringSOS' | 'shareICEContactDuringSOS'
>;

type FieldDefinition = {
  name: TextFieldName;
  label: string;
  description: string;
  maxLength: number;
  placeholder: string;
  multiline?: boolean;
};

const fields: FieldDefinition[] = [
  {
    name: 'declaredBloodGroup',
    label: 'Gruppo sanguigno dichiarato',
    description: 'Non verificato da SafeMeLink.',
    maxLength: 3,
    placeholder: 'Es. O+, A-, AB+',
  },
  {
    name: 'severeAllergies',
    label: 'Allergie gravi',
    description: 'Indica soltanto informazioni rilevanti in emergenza.',
    maxLength: EMERGENCY_PROFILE_LIMITS.severeAllergies,
    placeholder: 'Es. allergia grave alla penicillina',
    multiline: true,
  },
  {
    name: 'importantConditions',
    label: 'Patologie importanti',
    description: 'Patologie che ritieni utili per chi presta soccorso.',
    maxLength: EMERGENCY_PROFILE_LIMITS.importantConditions,
    placeholder: 'Informazioni facoltative',
    multiline: true,
  },
  {
    name: 'relevantMedications',
    label: 'Farmaci o terapie rilevanti',
    description: 'Terapie in corso rilevanti durante un’emergenza.',
    maxLength: EMERGENCY_PROFILE_LIMITS.relevantMedications,
    placeholder: 'Informazioni facoltative',
    multiline: true,
  },
  {
    name: 'lifesavingMedications',
    label: 'Farmaci salvavita',
    description: 'Farmaci e indicazioni dichiarate volontariamente.',
    maxLength: EMERGENCY_PROFILE_LIMITS.lifesavingMedications,
    placeholder: 'Es. autoiniettore conservato nello zaino',
    multiline: true,
  },
  {
    name: 'iceContact',
    label: 'Contatto ICE',
    description: 'Nome, relazione e recapito della persona da contattare.',
    maxLength: EMERGENCY_PROFILE_LIMITS.iceContact,
    placeholder: 'Es. Maria, sorella, +39…',
    multiline: true,
  },
  {
    name: 'emergencyNotes',
    label: 'Note di emergenza',
    description: 'Altre indicazioni strettamente utili in emergenza.',
    maxLength: EMERGENCY_PROFILE_LIMITS.emergencyNotes,
    placeholder: 'Informazioni facoltative',
    multiline: true,
  },
];

export function EmergencyProfileScreen() {
  const {
    draft,
    setDraft,
    status,
    error,
    lastSavedAt,
    hasLoadedProfile,
    reload,
    save,
  } = useEmergencyProfile();
  const validation = validateEmergencyProfile(draft);
  const isBusy = status === 'loading' || status === 'saving';
  const canEdit = hasLoadedProfile && status !== 'unauthenticated' && status !== 'loading';

  const updateText = (name: TextFieldName, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.screen}>
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Profilo di Emergenza</Text>
      <Text style={styles.introduction}>
        Questa scheda è facoltativa e serve esclusivamente durante un’emergenza. Puoi modificarla in qualsiasi momento.
      </Text>
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Informazioni dichiarate dall’utente</Text>
        <Text style={styles.noticeText}>
          SafeMeLink non certifica né verifica queste informazioni. Inserisci solo ciò che desideri condividere durante un SOS.
        </Text>
      </View>

      {status === 'unauthenticated' ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Accedi per compilare il Profilo di Emergenza.</Text>
        </View>
      ) : null}

      {status === 'error' && !hasLoadedProfile ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error || 'Caricamento non riuscito.'}</Text>
          <Pressable style={styles.retryButton} onPress={reload}>
            <Text style={styles.retryButtonText}>Riprova</Text>
          </Pressable>
        </View>
      ) : null}

      {fields.map((field) => (
        <View key={field.name} style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <Text style={styles.fieldDescription}>{field.description}</Text>
          <TextInput
            autoCapitalize={field.name === 'declaredBloodGroup' ? 'characters' : 'sentences'}
            editable={canEdit && status !== 'saving'}
            maxLength={field.maxLength}
            multiline={field.multiline}
            onChangeText={(value) => updateText(field.name, value)}
            placeholder={field.placeholder}
            placeholderTextColor="#687076"
            style={[styles.input, field.multiline && styles.multilineInput]}
            textAlignVertical={field.multiline ? 'top' : 'center'}
            value={draft[field.name]}
          />
          {field.multiline ? (
            <Text style={styles.counter}>
              {draft[field.name].length}/{field.maxLength}
            </Text>
          ) : null}
        </View>
      ))}

      <View style={styles.sharingCard}>
        <Text style={styles.sectionTitle}>Condivisione durante SOS</Text>
        <Text style={styles.sharingExplanation}>
          I dati restano privati finché non abiliti una delle opzioni seguenti. Non saranno mostrati nel Radar o nei profili pubblici.
        </Text>

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchTitle}>Condividi dati medici</Text>
            <Text style={styles.switchDescription}>
              Gruppo sanguigno, allergie, patologie, farmaci e note.
            </Text>
          </View>
          <Switch
            disabled={!canEdit || status === 'saving'}
            onValueChange={(shareMedicalDataDuringSOS) =>
              setDraft((current) => ({ ...current, shareMedicalDataDuringSOS }))
            }
            value={draft.shareMedicalDataDuringSOS}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchTitle}>Condividi contatto ICE</Text>
            <Text style={styles.switchDescription}>
              Rende disponibile esclusivamente il campo Contatto ICE.
            </Text>
          </View>
          <Switch
            disabled={!canEdit || status === 'saving'}
            onValueChange={(shareICEContactDuringSOS) =>
              setDraft((current) => ({ ...current, shareICEContactDuringSOS }))
            }
            value={draft.shareICEContactDuringSOS}
          />
        </View>
      </View>

      {!validation.valid ? (
        <Text style={styles.validationError}>{validation.message}</Text>
      ) : null}
      {error && hasLoadedProfile ? (
        <Text style={styles.validationError}>{error}</Text>
      ) : null}

      <Pressable
        disabled={!canEdit || isBusy || !validation.valid}
        onPress={() => void save().catch(() => undefined)}
        style={[
          styles.saveButton,
          (!canEdit || isBusy || !validation.valid) && styles.disabledButton,
        ]}>
        <Text style={styles.saveButtonText}>
          {status === 'saving' ? 'Salvataggio...' : 'Salva Profilo di Emergenza'}
        </Text>
      </Pressable>

      {lastSavedAt && status === 'ready' ? (
        <Text style={styles.savedText}>
          Ultimo salvataggio: {new Date(lastSavedAt).toLocaleString()}
        </Text>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#f7f9fb',
    flex: 1,
  },
  container: {
    backgroundColor: '#f7f9fb',
    flexGrow: 1,
    padding: 20,
    paddingBottom: 48,
  },
  title: {
    color: '#11181c',
    fontSize: 30,
    fontWeight: '800',
  },
  introduction: {
    color: '#52616b',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
    marginTop: 7,
  },
  noticeCard: {
    backgroundColor: '#fff4e5',
    borderRadius: 8,
    marginBottom: 18,
    padding: 15,
  },
  noticeTitle: {
    color: '#7a3d00',
    fontSize: 15,
    fontWeight: '800',
  },
  noticeText: {
    color: '#7a3d00',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  fieldCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 12,
    padding: 15,
  },
  fieldLabel: {
    color: '#11181c',
    fontSize: 16,
    fontWeight: '800',
  },
  fieldDescription: {
    color: '#687076',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  input: {
    backgroundColor: '#f0f3f5',
    borderColor: '#d7dee4',
    borderRadius: 6,
    borderWidth: 1,
    color: '#11181c',
    fontSize: 16,
    marginTop: 10,
    minHeight: 46,
    padding: 11,
  },
  multilineInput: {
    minHeight: 100,
  },
  counter: {
    color: '#687076',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'right',
  },
  sharingCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 6,
    padding: 16,
  },
  sectionTitle: {
    color: '#11181c',
    fontSize: 18,
    fontWeight: '800',
  },
  sharingExplanation: {
    color: '#52616b',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
    marginTop: 5,
  },
  switchRow: {
    alignItems: 'center',
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  switchCopy: {
    flex: 1,
    paddingRight: 12,
  },
  switchTitle: {
    color: '#11181c',
    fontSize: 15,
    fontWeight: '800',
  },
  switchDescription: {
    color: '#687076',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  errorCard: {
    backgroundColor: '#fdecec',
    borderRadius: 8,
    marginBottom: 14,
    padding: 14,
  },
  errorText: {
    color: '#b71c1c',
    fontSize: 14,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderColor: '#b71c1c',
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: '#b71c1c',
    fontSize: 14,
    fontWeight: '800',
  },
  validationError: {
    color: '#b71c1c',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  saveButton: {
    backgroundColor: '#b71c1c',
    borderRadius: 7,
    marginTop: 18,
    padding: 15,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  savedText: {
    color: '#52616b',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
});
