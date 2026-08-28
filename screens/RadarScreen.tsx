import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useNearbyUsers, type RadarViewStatus } from '@/hooks/useNearbyUsers';
import { useSOSNetworkPresence } from '@/components/SOSNetworkPresenceProvider';
import { canParticipateInRadar, validateRadarNickname } from '@/services/RadarService';

const statusMessages: Record<Exclude<RadarViewStatus, 'ready'>, string> = {
  loading_preferences: 'Caricamento preferenze Radar...',
  off: 'Radar disattivato.',
  visibility_required: 'Attiva “Mostrami agli utenti vicini” per entrare nella rete Radar.',
  searching: 'Ricerca utenti vicini...',
  empty: 'Presenza pubblicata: nessun altro utente idoneo nelle vicinanze.',
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
  const sosNetwork = useSOSNetworkPresence();
  const {
    users,
    status,
    error,
    preferences,
    isSavingPreferences,
    refreshRadar,
    setRadarScreenActive,
    updatePreferences,
  } = useNearbyUsers();
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const radarPulse = useRef(new Animated.Value(0)).current;
  const nicknameValidation = validateRadarNickname(nicknameDraft);
  const isParticipating = canParticipateInRadar(preferences);

  useFocusEffect(
    useCallback(() => {
      setRadarScreenActive(true);
      return () => setRadarScreenActive(false);
    }, [setRadarScreenActive]),
  );

  useEffect(() => {
    setNicknameDraft(preferences?.publicNickname ?? '');
  }, [preferences?.publicNickname]);

  useEffect(
    () => {
      isMountedRef.current = true;
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(radarPulse, {
            duration: 1800,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(radarPulse, {
            duration: 1800,
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      );

      pulseAnimation.start();

      return () => {
        isMountedRef.current = false;
        pulseAnimation.stop();
      };
    },
    [radarPulse],
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
  const updateSOSNetworkAvailability = async (enabled: boolean) => {
    setActionError(null);
    try {
      await sosNetwork.setEnabled(enabled);
    } catch {
      // The provider exposes a sanitized, actionable message next to this switch.
    }
  };
  const openLocationSettings = async (locationServices = false) => {
    setActionError(null);

    try {
      if (Platform.OS === 'android' && locationServices) {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      } else {
        await Linking.openSettings();
      }
    } catch {
      if (isMountedRef.current) {
        setActionError('Impossibile aprire le impostazioni. Aprile manualmente e abilita la posizione.');
      }
    }
  };
  const radarPulseStyle = {
    opacity: radarPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.35, 0.62],
    }),
    transform: [
      {
        scale: radarPulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.12],
        }),
      },
    ],
  };
  const showNetwork = status === 'ready' || status === 'searching' || status === 'empty';
  const canRetryRadar =
    status === 'permission_required' ||
    status === 'position_unavailable' ||
    status === 'accuracy_insufficient' ||
    status === 'error';
  const sosNetworkNeedsSettings =
    sosNetwork.status === 'location_services_required' ||
    sosNetwork.status === 'foreground_permission_required' ||
    sosNetwork.status === 'background_permission_required' ||
    sosNetwork.status === 'notification_permission_required';

  return (
    <View style={styles.screen}>
      <View style={styles.background}>
        <View style={[styles.backgroundGlow, styles.backgroundGlowBlue]} />
        <View style={[styles.backgroundGlow, styles.backgroundGlowPurple]} />
        <View style={[styles.backgroundPoint, styles.backgroundPointOne]} />
        <View style={[styles.backgroundPoint, styles.backgroundPointTwo]} />
        <View style={[styles.backgroundPoint, styles.backgroundPointThree]} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <View>
            <Text style={styles.title}>Radar SafeMeLink</Text>
            <Text style={styles.subtitle}>Presenze anonime e recenti entro circa 1 km.</Text>
          </View>
          <View style={styles.headingIcon}>
            <Ionicons color="#45B7FF" name="radio-outline" size={24} />
          </View>
        </View>

        {showNetwork ? (
          <View style={styles.networkCard}>
            <View style={styles.networkHeader}>
              <View>
                <Text style={styles.networkTitle}>Rete nelle vicinanze</Text>
                <Text style={styles.networkSubtitle}>
                  {status === 'ready'
                    ? `${users.length} ${users.length === 1 ? 'presenza recente' : 'presenze recenti'}`
                    : status === 'searching'
                      ? 'Aggiornamento della rete...'
                      : 'Nessuna presenza recente'}
                </Text>
              </View>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>RADAR ATTIVO</Text>
              </View>
            </View>

            <View style={styles.networkCanvas}>
              <View style={[styles.networkRing, styles.networkRingOuter]} />
              <View style={[styles.networkRing, styles.networkRingInner]} />
              <View style={[styles.networkLine, styles.networkLineHorizontal]} />
              <View style={[styles.networkLine, styles.networkLineAscending]} />
              <View style={[styles.networkLine, styles.networkLineDescending]} />

              <Animated.View style={[styles.centerPulse, radarPulseStyle]} />
              <View style={styles.centerNode}>
                <Ionicons color="#F7FAFF" name="person" size={24} />
              </View>
              <Text style={styles.centerLabel}>Tu</Text>

              {RADAR_NODE_POSITIONS.map((positionStyle, index) => {
                const user = users[index];

                return (
                  <View
                    key={user?.anonymousId ?? `empty-node-${index}`}
                    style={[styles.networkNodeWrap, positionStyle]}>
                    <View
                      style={[
                        styles.networkNode,
                        user ? styles.networkNodeActive : styles.networkNodeEmpty,
                      ]}>
                      <Text style={styles.networkNodeSymbol}>○</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.networkNodeLabel}>
                      {user
                        ? user.publicNickname || 'SafeMeLink'
                        : '—'}
                    </Text>
                    {user ? (
                      <Text style={styles.networkNodeDistance}>
                        {formatDistance(user.distanceMeters)}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {status === 'empty' ? (
              <Pressable onPress={refreshRadar} style={styles.refreshButton}>
                <Ionicons color="#DDEEFF" name="refresh" size={17} />
                <Text style={styles.refreshButtonText}>Aggiorna rete</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {status !== 'ready' && status !== 'searching' && status !== 'empty' ? (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>{statusMessages[status]}</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {canRetryRadar ? (
              <Pressable onPress={refreshRadar} style={styles.refreshButton}>
                <Ionicons color="#DDEEFF" name="refresh" size={17} />
                <Text style={styles.refreshButtonText}>Riprova</Text>
              </Pressable>
            ) : null}
            {status === 'permission_required' || status === 'position_unavailable' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void openLocationSettings(status === 'position_unavailable')}
                style={styles.refreshButton}>
                <Ionicons color="#DDEEFF" name="settings-outline" size={17} />
                <Text style={styles.refreshButtonText}>Apri impostazioni</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Disponibilità rete SOS</Text>
          <Text style={styles.explanationText}>
            Consente a SafeMeLink di aggiornare occasionalmente la tua posizione, anche in
            background, per poterti inviare emergenze realmente vicine. La posizione non è
            mostrata pubblicamente e non viene inserita nelle notifiche.
          </Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>
                Rete SOS {sosNetwork.enabled ? 'ON' : 'OFF'}
              </Text>
              <Text style={styles.settingDescription}>
                {sosNetwork.isSaving ? 'Aggiornamento in corso…' : 'Ricevi richieste di aiuto nelle vicinanze.'}
              </Text>
            </View>
            <Switch
              disabled={sosNetwork.isLoading || sosNetwork.isSaving}
              onValueChange={(enabled) => void updateSOSNetworkAvailability(enabled)}
              thumbColor={sosNetwork.enabled ? '#F7FAFF' : '#A8B5D1'}
              trackColor={{ false: '#29324D', true: '#45B7FF' }}
              value={sosNetwork.enabled}
            />
          </View>
          {sosNetwork.message ? (
            <Text
              style={
                sosNetwork.status === 'available' || sosNetwork.status === 'off'
                  ? styles.networkAvailabilityMessage
                  : styles.validationError
              }>
              {sosNetwork.message}
            </Text>
          ) : null}
          {sosNetworkNeedsSettings ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void openLocationSettings(
                  sosNetwork.status === 'location_services_required',
                )
              }
              style={styles.refreshButton}>
              <Ionicons color="#DDEEFF" name="settings-outline" size={17} />
              <Text style={styles.refreshButtonText}>
                {sosNetwork.status === 'location_services_required'
                  ? 'Attiva posizione'
                  : 'Apri impostazioni'}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.settingsDivider} />
          <Text style={styles.settingsTitle}>Preferenze Radar</Text>
          <Text style={styles.explanationText}>
            Per vedere gli utenti vicini devi essere visibile anche tu. La tua posizione precisa
            non verrà mai mostrata. La partecipazione alla rete non crea contatti fidati.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>
                Radar {isParticipating ? 'ON' : 'OFF'}
              </Text>
              <Text style={styles.settingDescription}>Entra o esci dalla rete SafeMeLink.</Text>
            </View>
            <Switch
              disabled={!preferences || isSavingPreferences}
              onValueChange={(radarEnabled) =>
                void saveChanges({ radarEnabled, visibleToNearby: radarEnabled })
              }
              thumbColor={isParticipating ? '#F7FAFF' : '#A8B5D1'}
              trackColor={{ false: '#29324D', true: '#7868FF' }}
              value={isParticipating}
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
              thumbColor={preferences?.visibleToNearby ? '#F7FAFF' : '#A8B5D1'}
              trackColor={{ false: '#29324D', true: '#7868FF' }}
              value={preferences?.visibleToNearby ?? false}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Mostra nickname</Text>
              <Text style={styles.settingDescription}>
                Altrimenti apparirai come Utente SafeMeLink.
              </Text>
            </View>
            <Switch
              disabled={!preferences || isSavingPreferences}
              onValueChange={(showNickname) =>
                void saveChanges({ showNickname, publicNickname: nicknameDraft })
              }
              thumbColor={preferences?.showNickname ? '#F7FAFF' : '#A8B5D1'}
              trackColor={{ false: '#29324D', true: '#7868FF' }}
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
            placeholderTextColor="#71809F"
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

        <Text style={styles.privacyText}>
          Il Radar non mostra identità, contatti, identificativi reali o coordinate degli altri
          utenti.
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#050816',
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  backgroundGlow: {
    borderRadius: 180,
    height: 280,
    opacity: 0.16,
    position: 'absolute',
    width: 280,
  },
  backgroundGlowBlue: {
    backgroundColor: '#45B7FF',
    right: -150,
    top: 40,
  },
  backgroundGlowPurple: {
    backgroundColor: '#7868FF',
    bottom: 80,
    left: -170,
  },
  backgroundPoint: {
    backgroundColor: '#A78BFA',
    borderRadius: 3,
    height: 4,
    opacity: 0.55,
    position: 'absolute',
    width: 4,
  },
  backgroundPointOne: {
    left: '12%',
    top: '16%',
  },
  backgroundPointTwo: {
    right: '18%',
    top: '34%',
  },
  backgroundPointThree: {
    bottom: '18%',
    left: '30%',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 44,
    paddingTop: 32,
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: '#F7FAFF',
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    color: '#A8B5D1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  headingIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(69, 183, 255, 0.12)',
    borderColor: 'rgba(69, 183, 255, 0.28)',
    borderRadius: 16,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  networkCard: {
    backgroundColor: 'rgba(12, 20, 48, 0.76)',
    borderColor: 'rgba(120, 104, 255, 0.28)',
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 18,
    overflow: 'hidden',
    padding: 18,
    shadowColor: '#7868FF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 26,
  },
  networkHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  networkTitle: {
    color: '#F7FAFF',
    fontSize: 18,
    fontWeight: '900',
  },
  networkSubtitle: {
    color: '#A8B5D1',
    fontSize: 12,
    marginTop: 3,
  },
  liveBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(69, 214, 165, 0.1)',
    borderColor: 'rgba(69, 214, 165, 0.22)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  liveDot: {
    backgroundColor: '#45D6A5',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  liveText: {
    color: '#72E2BB',
    fontSize: 9,
    fontWeight: '900',
  },
  networkCanvas: {
    alignSelf: 'center',
    height: 340,
    marginTop: 12,
    position: 'relative',
    width: '100%',
  },
  networkRing: {
    alignSelf: 'center',
    borderColor: 'rgba(69, 183, 255, 0.13)',
    borderRadius: 160,
    borderWidth: 1,
    position: 'absolute',
    top: '50%',
  },
  networkRingOuter: {
    height: 260,
    marginTop: -130,
    width: 260,
  },
  networkRingInner: {
    borderColor: 'rgba(167, 139, 250, 0.18)',
    height: 160,
    marginTop: -80,
    width: 160,
  },
  networkLine: {
    backgroundColor: 'rgba(69, 183, 255, 0.12)',
    height: 1,
    left: '50%',
    marginLeft: -135,
    position: 'absolute',
    top: '50%',
    width: 270,
  },
  networkLineHorizontal: {
    transform: [{ rotate: '0deg' }],
  },
  networkLineAscending: {
    transform: [{ rotate: '58deg' }],
  },
  networkLineDescending: {
    transform: [{ rotate: '-58deg' }],
  },
  centerPulse: {
    backgroundColor: '#7868FF',
    borderRadius: 42,
    height: 84,
    left: '50%',
    marginLeft: -42,
    marginTop: -42,
    position: 'absolute',
    top: '50%',
    width: 84,
  },
  centerNode: {
    alignItems: 'center',
    backgroundColor: '#7868FF',
    borderColor: 'rgba(255, 255, 255, 0.55)',
    borderRadius: 31,
    borderWidth: 2,
    height: 62,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -31,
    marginTop: -31,
    position: 'absolute',
    shadowColor: '#A78BFA',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    top: '50%',
    width: 62,
  },
  centerLabel: {
    color: '#F7FAFF',
    fontSize: 11,
    fontWeight: '900',
    left: '50%',
    marginLeft: -30,
    marginTop: 37,
    position: 'absolute',
    textAlign: 'center',
    top: '50%',
    width: 60,
  },
  networkNodeWrap: {
    alignItems: 'center',
    position: 'absolute',
    width: 88,
  },
  networkNodeTop: {
    left: '50%',
    marginLeft: -44,
    top: 4,
  },
  networkNodeUpperLeft: {
    left: 0,
    top: 92,
  },
  networkNodeUpperRight: {
    right: 0,
    top: 92,
  },
  networkNodeLowerLeft: {
    bottom: 58,
    left: 5,
  },
  networkNodeLowerRight: {
    bottom: 58,
    right: 5,
  },
  networkNodeBottom: {
    bottom: 0,
    left: '50%',
    marginLeft: -44,
  },
  networkNode: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  networkNodeActive: {
    backgroundColor: 'rgba(69, 183, 255, 0.15)',
    borderColor: '#45B7FF',
    shadowColor: '#45B7FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  networkNodeEmpty: {
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
    borderColor: 'rgba(168, 181, 209, 0.22)',
  },
  networkNodeSymbol: {
    color: '#A8E0FF',
    fontSize: 25,
    lineHeight: 28,
  },
  networkNodeLabel: {
    color: '#F7FAFF',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center',
    width: '100%',
  },
  networkNodeDistance: {
    color: '#A8B5D1',
    fontSize: 9,
    marginTop: 1,
    textAlign: 'center',
  },
  statusCard: {
    backgroundColor: 'rgba(12, 20, 48, 0.76)',
    borderColor: 'rgba(120, 104, 255, 0.25)',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
  settingsCard: {
    backgroundColor: 'rgba(12, 20, 48, 0.76)',
    borderColor: 'rgba(120, 104, 255, 0.22)',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
  settingsTitle: {
    color: '#F7FAFF',
    fontSize: 18,
    fontWeight: '900',
  },
  explanationText: {
    color: '#A8B5D1',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
    marginTop: 5,
  },
  networkAvailabilityMessage: {
    color: '#72E2BB',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  settingsDivider: {
    backgroundColor: 'rgba(168, 181, 209, 0.16)',
    height: 1,
    marginBottom: 16,
    marginTop: 12,
  },
  settingRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
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
    color: '#F7FAFF',
    fontSize: 15,
    fontWeight: '800',
  },
  settingDescription: {
    color: '#A8B5D1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  nicknameLabel: {
    color: '#F7FAFF',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 14,
  },
  nicknameInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderColor: 'rgba(69, 183, 255, 0.22)',
    borderRadius: 14,
    borderWidth: 1,
    color: '#F7FAFF',
    fontSize: 16,
    marginTop: 8,
    padding: 12,
  },
  nicknameHelp: {
    color: '#A8B5D1',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  validationError: {
    color: '#FF8096',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  saveButton: {
    backgroundColor: '#7868FF',
    borderRadius: 14,
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
    color: '#F7FAFF',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  errorText: {
    color: '#FF8096',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  privacyText: {
    color: '#8795B2',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  refreshButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(69, 183, 255, 0.14)',
    borderColor: 'rgba(69, 183, 255, 0.32)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refreshButtonText: {
    color: '#DDEEFF',
    fontSize: 13,
    fontWeight: '800',
  },
});

const RADAR_NODE_POSITIONS = [
  styles.networkNodeTop,
  styles.networkNodeUpperLeft,
  styles.networkNodeUpperRight,
  styles.networkNodeLowerLeft,
  styles.networkNodeLowerRight,
  styles.networkNodeBottom,
];
