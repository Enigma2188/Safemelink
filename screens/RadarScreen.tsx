import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useNearbyUsers, type RadarViewStatus } from '@/hooks/useNearbyUsers';
import { validateRadarNickname } from '@/services/RadarService';

const statusMessages: Record<Exclude<RadarViewStatus, 'ready'>, string> = {
  loading_preferences: 'Caricamento preferenze Radar...',
  off: 'Radar disattivato.',
  visibility_required: 'Attiva “Mostrami agli utenti vicini” per entrare nella rete Radar.',
  searching: 'Ricerca utenti vicini...',
  empty: 'Nessun utente recente nelle vicinanze.',
  permission_required: 'Autorizzazione alla posizione necessaria per usare il Radar.',
  position_unavailable: 'Posizione non disponibile.',
  accuracy_insufficient: 'Segnale GPS non abbastanza preciso. Riprova in uno spazio aperto.',
  unauthenticated: 'Accedi per utilizzare il Radar SafeMeLink.',
  error: 'Errore temporaneo durante la ricerca.',
};

const formatDistance = (distanceMeters: number) =>
  distanceMeters >= 1_000
    ? `circa ${(distanceMeters / 1_000).toFixed(1)} km`
    : `circa ${distanceMeters} m`;

export function RadarScreen() {
  const {
    users,
    status,
    error,
    preferences,
    isSavingPreferences,
    updatePreferences,
  } = useNearbyUsers();
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const nicknameValidation = validateRadarNickname(nicknameDraft);

  useEffect(() => {
    setNicknameDraft(preferences?.publicNickname ?? '');
  }, [preferences?.publicNickname]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const saveChanges = async (
    changes: Parameters<typeof updatePreferences>[0],
  ) => {
    setActionError(null);

    try {
      await updatePreferences(changes);
    } catch (saveError: unknown) {
      if (isMountedRef.current) {
        setActionError(
          saveError instanceof Error ? saveError.message : 'Salvataggio Radar non riuscito.',
        );
      }
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Radar SafeMeLink</Text>
      <Text style={styles.subtitle}>
        Presenze anonime e recenti entro circa 1 km.
      </Text>

      <View style={styles.settingsCard}>
        <Text style={styles.explanationText}>
          Per vedere gli utenti vicini devi essere visibile anche tu.{`\n\n`}
          La tua posizione precisa non verrà mai mostrata.
        </Text>

        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>
              Radar {preferences?.radarEnabled ? 'ON' : 'OFF'}
            </Text>
            <Text style={styles.settingDescription}>Entra o esci dalla rete SafeMeLink.</Text>
          </View>
          <Switch
            disabled={!preferences || isSavingPreferences}
            onValueChange={(radarEnabled) => void saveChanges({ radarEnabled })}
            value={preferences?.radarEnabled ?? false}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>Mostrami agli utenti vicini</Text>
            <Text style={styles.settingDescription}>Necessario per vedere gli altri utenti.</Text>
          </View>
          <Switch
            disabled={!preferences || isSavingPreferences}
            onValueChange={(visibleToNearby) => void saveChanges({ visibleToNearby })}
            value={preferences?.visibleToNearby ?? true}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>Mostra nickname</Text>
            <Text style={styles.settingDescription}>Altrimenti apparirai come Utente SafeMeLink.</Text>
          </View>
          <Switch
            disabled={!preferences || isSavingPreferences}
            onValueChange={(showNickname) =>
              void saveChanges({ showNickname, publicNickname: nicknameDraft })
            }
            value={preferences?.showNickname ?? false}
          />
        </View>

        <Text style={styles.nicknameLabel}>Nickname pubblico opzionale</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={Boolean(preferences) && !isSavingPreferences}
          maxLength={20}
          onChangeText={setNicknameDraft}
          placeholder="es. Luna_27"
          placeholderTextColor="#687076"
          style={styles.nicknameInput}
          value={nicknameDraft}
        />
        <Text style={nicknameValidation.valid ? styles.nicknameHelp : styles.validationError}>
          {nicknameValidation.valid
            ? '3-20 caratteri: lettere, numeri, underscore o trattino.'
            : nicknameValidation.message}
        </Text>
        <Pressable
          disabled={!preferences || !nicknameValidation.valid || isSavingPreferences}
          onPress={() => void saveChanges({ publicNickname: nicknameDraft })}
          style={[
            styles.saveButton,
            (!preferences || !nicknameValidation.valid || isSavingPreferences) &&
              styles.disabledButton,
          ]}>
          <Text style={styles.saveButtonText}>
            {isSavingPreferences ? 'Salvataggio...' : 'Salva nickname'}
          </Text>
        </Pressable>
        {actionError ? <Text style={styles.validationError}>{actionError}</Text> : null}
      </View>

      {status !== 'ready' ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>{statusMessages[status]}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : null}

      {status === 'ready' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Utenti nelle vicinanze ({users.length})</Text>
          {users.map((user) => (
            <View key={user.anonymousId} style={styles.userRow}>
              <View>
                <Text style={styles.userLabel}>
                  {user.publicNickname || 'Utente SafeMeLink'}
                </Text>
                <Text style={styles.presenceText}>
                  {user.category === 'guardian' ? 'Guardian' : 'Community'} · Presenza recente
                </Text>
              </View>
              <Text style={styles.distanceText}>{formatDistance(user.distanceMeters)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.privacyText}>
        Il Radar non mostra identità, contatti, identificativi reali o coordinate degli altri utenti.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f7f9fb',
    flexGrow: 1,
    padding: 20,
    paddingTop: 40,
  },
  title: {
    color: '#11181c',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#52616b',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
    marginTop: 6,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 18,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 18,
    padding: 16,
  },
  explanationText: {
    color: '#11181c',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 14,
  },
  settingRow: {
    alignItems: 'center',
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingCopy: {
    flex: 1,
    paddingRight: 12,
  },
  settingTitle: {
    color: '#11181c',
    fontSize: 15,
    fontWeight: '800',
  },
  settingDescription: {
    color: '#687076',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  nicknameLabel: {
    color: '#11181c',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 14,
  },
  nicknameInput: {
    backgroundColor: '#f0f3f5',
    borderColor: '#d7dee4',
    borderRadius: 6,
    borderWidth: 1,
    color: '#11181c',
    fontSize: 16,
    marginTop: 8,
    padding: 12,
  },
  nicknameHelp: {
    color: '#687076',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  validationError: {
    color: '#b71c1c',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  saveButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 6,
    marginTop: 12,
    padding: 12,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  statusText: {
    color: '#11181c',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  errorText: {
    color: '#b71c1c',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    color: '#11181c',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  userRow: {
    alignItems: 'center',
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  userLabel: {
    color: '#11181c',
    fontSize: 16,
    fontWeight: '800',
  },
  presenceText: {
    color: '#2e7d32',
    fontSize: 13,
    marginTop: 3,
  },
  distanceText: {
    color: '#0a7ea4',
    fontSize: 15,
    fontWeight: '800',
  },
  privacyText: {
    color: '#687076',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 18,
  },
});
