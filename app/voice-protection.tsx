import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { normalizePassphrase } from '@/storage/PassphraseStorage';
import {
  DEFAULT_VOICE_PROTECTION_SETTINGS,
  type VoiceProtectionDurationMinutes,
  type VoiceProtectionSettings,
  VoiceProtectionStorage,
} from '@/storage/VoiceProtectionStorage';

const DURATION_OPTIONS: {
  label: string;
  value: VoiceProtectionDurationMinutes;
}[] = [
  { label: '30 min', value: 30 },
  { label: '1 ora', value: 60 },
  { label: '2 ore', value: 120 },
  { label: 'Finché la disattivi', value: 0 },
];

type MicrophoneState = 'off' | 'ready' | 'testing' | 'recognized' | 'error';

const formatRemainingTime = (expiresAt: string | null, now: number) => {
  if (!expiresAt) {
    return 'Fino alla disattivazione manuale';
  }

  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now) / 1000),
  );
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export default function VoiceProtectionScreen() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const [settings, setSettings] = useState<VoiceProtectionSettings>(
    DEFAULT_VOICE_PROTECTION_SETTINGS,
  );
  const [passphraseDraft, setPassphraseDraft] = useState('');
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>('off');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [testTranscript, setTestTranscript] = useState('');
  const [now, setNow] = useState(Date.now());
  const testingRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshState = useCallback(async () => {
    if (!userId) {
      setSettings(DEFAULT_VOICE_PROTECTION_SETTINGS);
      setPassphraseDraft('');
      setMicrophoneState('off');
      setIsLoading(false);
      return;
    }

    const storedSettings = await VoiceProtectionStorage.get(userId);
    const hasExpired =
      storedSettings.expiresAt !== null &&
      new Date(storedSettings.expiresAt).getTime() <= Date.now();
    const serviceRunning = VoiceProtectionService.isRunning();

    if (storedSettings.enabled && (hasExpired || !serviceRunning)) {
      const stoppedSettings: VoiceProtectionSettings = {
        ...storedSettings,
        enabled: false,
        enabledAt: null,
        expiresAt: null,
      };
      await VoiceProtectionStorage.save(userId, stoppedSettings);
      setSettings(stoppedSettings);
      setPassphraseDraft(stoppedSettings.passphrase);
      setMicrophoneState('off');
    } else {
      setSettings(storedSettings);
      setPassphraseDraft(storedSettings.passphrase);
      setMicrophoneState(storedSettings.enabled ? 'ready' : 'off');
    }

    setIsLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void refreshState();
    }, [refreshState]),
  );

  useEffect(() => {
    const clock = setInterval(() => {
      setNow(Date.now());
      const expiresAt = settingsRef.current.expiresAt;

      if (
        settingsRef.current.enabled &&
        expiresAt &&
        new Date(expiresAt).getTime() <= Date.now()
      ) {
        void refreshState();
      }
    }, 1000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshState();
      }
    });

    return () => {
      clearInterval(clock);
      appStateSubscription.remove();
    };
  }, [refreshState]);

  useEffect(
    () => () => {
      testingRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
    },
    [],
  );

  useSpeechRecognitionEvent('result', (event) => {
    if (!testingRef.current) {
      return;
    }

    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) {
      return;
    }

    setTestTranscript(transcript);
    if (!event.isFinal) {
      return;
    }

    testingRef.current = false;
    const expectedPassphrase = normalizePassphrase(settingsRef.current.passphrase);
    const recognizedText = normalizePassphrase(transcript);
    const recognized =
      recognizedText === expectedPassphrase ||
      recognizedText.includes(expectedPassphrase);

    setMicrophoneState(recognized ? 'recognized' : 'ready');
    setMessage(
      recognized
        ? 'Test riuscito: parola d’ordine riconosciuta localmente.'
        : 'Parola non riconosciuta. Puoi ripetere il test.',
    );
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!testingRef.current || event.error === 'aborted') {
      return;
    }

    testingRef.current = false;
    setMicrophoneState('error');
    setMessage(event.message || 'Test vocale interrotto.');
  });

  useSpeechRecognitionEvent('end', () => {
    if (testingRef.current) {
      testingRef.current = false;
      setMicrophoneState(settingsRef.current.enabled ? 'ready' : 'off');
    }
  });

  const durationLabel = useMemo(
    () =>
      DURATION_OPTIONS.find((option) => option.value === settings.durationMinutes)
        ?.label ?? '1 ora',
    [settings.durationMinutes],
  );

  const savePassphrase = async () => {
    if (!userId) {
      setMessage('Accedi prima di configurare Protezione Vocale.');
      return;
    }

    if (normalizePassphrase(passphraseDraft).length < 3) {
      setMessage('La parola d’ordine deve contenere almeno 3 caratteri.');
      return;
    }

    setIsSaving(true);
    try {
      const updatedSettings = {
        ...settings,
        passphrase: passphraseDraft.trim(),
      };
      await VoiceProtectionStorage.save(userId, updatedSettings);
      setSettings(updatedSettings);
      setMessage('Parola d’ordine salvata soltanto su questo dispositivo.');
    } finally {
      setIsSaving(false);
    }
  };

  const activateProtection = async () => {
    if (!userId) {
      setMessage('Accedi prima di attivare Protezione Vocale.');
      return;
    }
    if (!normalizePassphrase(settings.passphrase)) {
      setMessage('Configura e salva prima una parola d’ordine.');
      return;
    }

    setIsSaving(true);
    setMessage('');

    try {
      const permissions = await VoiceProtectionService.requestPermissions();
      if (!permissions.microphoneGranted) {
        setMicrophoneState('error');
        setMessage('Permesso microfono non concesso. La protezione non è stata attivata.');
        return;
      }
      if (!permissions.notificationsGranted) {
        setMicrophoneState('error');
        setMessage(
          'Autorizza le notifiche per mostrare l’avviso persistente di protezione.',
        );
        return;
      }

      const activation = await VoiceProtectionService.start(
        userId,
        settings.durationMinutes,
      );
      const activeSettings: VoiceProtectionSettings = {
        ...settings,
        enabled: true,
        enabledAt: activation.enabledAt,
        expiresAt: activation.expiresAt,
      };
      await VoiceProtectionStorage.save(userId, activeSettings);
      setSettings(activeSettings);
      setMicrophoneState('ready');
      setMessage('Protezione attiva. Il motore locale è pronto.');
    } catch (error) {
      setMicrophoneState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossibile attivare Protezione Vocale.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const deactivateProtection = async () => {
    if (!userId) {
      return;
    }

    setIsSaving(true);
    try {
      testingRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
      await VoiceProtectionService.stop();
      const inactiveSettings: VoiceProtectionSettings = {
        ...settings,
        enabled: false,
        enabledAt: null,
        expiresAt: null,
      };
      await VoiceProtectionStorage.save(userId, inactiveSettings);
      setSettings(inactiveSettings);
      setMicrophoneState('off');
      setMessage('Protezione disattivata.');
    } finally {
      setIsSaving(false);
    }
  };

  const runVoiceTest = async () => {
    if (!normalizePassphrase(settings.passphrase)) {
      setMessage('Configura e salva prima una parola d’ordine.');
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setMicrophoneState('error');
      setMessage('Riconoscimento vocale non disponibile su questo dispositivo.');
      return;
    }
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      setMicrophoneState('error');
      setMessage(
        'Il riconoscimento locale non è disponibile. Installa il modello vocale offline italiano dalle impostazioni del dispositivo.',
      );
      return;
    }

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setMicrophoneState('error');
        setMessage('Permesso microfono o riconoscimento vocale non concesso.');
        return;
      }

      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
      testingRef.current = true;
      setTestTranscript('');
      setMessage('Pronuncia ora la parola d’ordine.');
      setMicrophoneState('testing');
      ExpoSpeechRecognitionModule.start({
        lang: 'it-IT',
        interimResults: true,
        maxAlternatives: 3,
        continuous: false,
        contextualStrings: [settings.passphrase],
        requiresOnDeviceRecognition: true,
      });
    } catch (error) {
      testingRef.current = false;
      setMicrophoneState('error');
      setMessage(
        error instanceof Error ? error.message : 'Impossibile avviare il test.',
      );
    }
  };

  const setDuration = async (durationMinutes: VoiceProtectionDurationMinutes) => {
    if (settings.enabled || !userId) {
      return;
    }

    const updatedSettings = { ...settings, durationMinutes };
    setSettings(updatedSettings);
    await VoiceProtectionStorage.save(userId, updatedSettings);
  };

  const microphoneLabel =
    microphoneState === 'testing'
      ? 'In ascolto per il test'
      : microphoneState === 'recognized'
        ? 'Parola riconosciuta'
        : microphoneState === 'error'
          ? 'Richiede attenzione'
          : microphoneState === 'ready'
            ? 'Pronto per il motore locale'
            : 'Non in uso';

  if (isInitializing || isLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color="#7868FF" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons color="#E9E5FF" name="mic-outline" size={34} />
          </View>
          <Text style={styles.eyebrow}>SAFEMELINK LOCAL SECURITY</Text>
          <Text style={styles.title}>PROTEZIONE VOCALE</Text>
          <Text style={styles.subtitle}>
            Una modalità locale che mantiene il dispositivo pronto mentre ti muovi.
          </Text>
        </View>

        <View style={[styles.card, settings.enabled && styles.cardActive]}>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.cardLabel}>MODALITÀ PROTETTA</Text>
              <Text
                style={[
                  styles.status,
                  settings.enabled ? styles.statusActive : styles.statusInactive,
                ]}>
                {settings.enabled ? 'ATTIVA' : 'NON ATTIVA'}
              </Text>
            </View>
            <Switch
              disabled={isSaving}
              onValueChange={(enabled) =>
                void (enabled ? activateProtection() : deactivateProtection())
              }
              thumbColor="#F7FAFF"
              trackColor={{ false: '#33405F', true: '#7868FF' }}
              value={settings.enabled}
            />
          </View>

          <View style={styles.microphoneRow}>
            <View
              style={[
                styles.microphoneDot,
                microphoneState === 'testing' && styles.microphoneTesting,
                microphoneState === 'ready' && styles.microphoneReady,
                microphoneState === 'recognized' && styles.microphoneRecognized,
                microphoneState === 'error' && styles.microphoneError,
              ]}
            />
            <Text style={styles.microphoneText}>{microphoneLabel}</Text>
          </View>
        </View>

        {!userId ? (
          <View style={styles.warningCard}>
            <Ionicons color="#FFCA72" name="lock-closed-outline" size={22} />
            <Text style={styles.warningText}>
              Accedi dal menu laterale per configurare la protezione sul tuo account.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Parola d’ordine</Text>
          <Text style={styles.cardDescription}>
            Rimane nello spazio locale dell’account e non viene inviata al cloud.
          </Text>
          <TextInput
            autoCapitalize="none"
            editable={!settings.enabled && !isSaving}
            onChangeText={setPassphraseDraft}
            placeholder="Inserisci una parola o una breve frase"
            placeholderTextColor="#667391"
            secureTextEntry
            style={styles.input}
            value={passphraseDraft}
          />
          <Pressable
            disabled={settings.enabled || isSaving || !userId}
            onPress={() => void savePassphrase()}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              (settings.enabled || isSaving || !userId) && styles.disabled,
            ]}>
            <Text style={styles.secondaryButtonText}>SALVA PAROLA</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Durata della modalità</Text>
          <Text style={styles.durationValue}>{durationLabel}</Text>
          <View style={styles.durationGrid}>
            {DURATION_OPTIONS.map((option) => (
              <Pressable
                disabled={settings.enabled || !userId}
                key={option.value}
                onPress={() => void setDuration(option.value)}
                style={[
                  styles.durationChip,
                  settings.durationMinutes === option.value && styles.durationChipSelected,
                  settings.enabled && styles.disabled,
                ]}>
                <Text
                  style={[
                    styles.durationChipText,
                    settings.durationMinutes === option.value &&
                      styles.durationChipTextSelected,
                  ]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {settings.enabled ? (
            <View style={styles.remainingRow}>
              <Ionicons color="#78D8FF" name="time-outline" size={18} />
              <Text style={styles.remainingText}>
                {formatRemainingTime(settings.expiresAt, now)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Test locale</Text>
          <Text style={styles.cardDescription}>
            Il test ascolta una sola volta e verifica la frase esclusivamente sul dispositivo.
          </Text>
          <Pressable
            disabled={isSaving || microphoneState === 'testing' || !userId}
            onPress={() => void runVoiceTest()}
            style={({ pressed }) => [
              styles.testButton,
              pressed && styles.buttonPressed,
              (isSaving || microphoneState === 'testing' || !userId) &&
                styles.disabled,
            ]}>
            <Ionicons color="#FFFFFF" name="mic" size={20} />
            <Text style={styles.testButtonText}>
              {microphoneState === 'testing' ? 'ASCOLTO…' : 'TEST'}
            </Text>
          </Pressable>
          {testTranscript ? (
            <Text style={styles.transcript}>Riconosciuto: “{testTranscript}”</Text>
          ) : null}
        </View>

        {message ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : null}

        <View style={styles.privacyCard}>
          <Ionicons color="#A78BFA" name="shield-checkmark-outline" size={24} />
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyTitle}>Privacy locale</Text>
            <Text style={styles.privacyText}>
              Nessuna registrazione permanente e nessun servizio cloud. Android mostra
              una notifica persistente quando la protezione è attiva. Il consumo dipende
              dal dispositivo e dalle impostazioni di risparmio energetico.
            </Text>
            <Pressable
              onPress={() => void VoiceProtectionService.openBatterySettings()}
              style={styles.batteryButton}>
              <Ionicons color="#C8BEFF" name="battery-half-outline" size={17} />
              <Text style={styles.batteryButtonText}>IMPOSTAZIONI BATTERIA</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#050816', flex: 1 },
  content: { gap: 14, padding: 18, paddingBottom: 42 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', paddingBottom: 8, paddingTop: 12 },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(120, 104, 255, 0.2)',
    borderColor: 'rgba(167, 139, 250, 0.5)',
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#7868FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    width: 64,
  },
  eyebrow: { color: '#7868FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: {
    color: '#F7FAFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 5,
  },
  subtitle: {
    color: '#A8B5D1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 330,
    textAlign: 'center',
  },
  card: {
    backgroundColor: 'rgba(12, 20, 48, 0.86)',
    borderColor: 'rgba(120, 104, 255, 0.24)',
    borderRadius: 20,
    borderWidth: 1,
    padding: 17,
  },
  cardActive: {
    borderColor: 'rgba(69, 214, 165, 0.6)',
    shadowColor: '#45D6A5',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
  },
  switchRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  switchCopy: { flex: 1 },
  cardLabel: { color: '#8392B2', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  status: { fontSize: 22, fontWeight: '900', marginTop: 4 },
  statusActive: { color: '#45D6A5' },
  statusInactive: { color: '#A8B5D1' },
  microphoneRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginTop: 14,
    paddingTop: 13,
  },
  microphoneDot: { backgroundColor: '#58647E', borderRadius: 6, height: 12, width: 12 },
  microphoneReady: { backgroundColor: '#45D6A5' },
  microphoneTesting: { backgroundColor: '#45B7FF' },
  microphoneRecognized: { backgroundColor: '#A78BFA' },
  microphoneError: { backgroundColor: '#FF607A' },
  microphoneText: { color: '#C8D3EA', fontSize: 13, fontWeight: '700' },
  warningCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(90, 57, 15, 0.35)',
    borderColor: 'rgba(255, 202, 114, 0.35)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  warningText: { color: '#FFE0A8', flex: 1, fontSize: 13, lineHeight: 18 },
  cardTitle: { color: '#F7FAFF', fontSize: 18, fontWeight: '900' },
  cardDescription: { color: '#A8B5D1', fontSize: 13, lineHeight: 19, marginTop: 5 },
  input: {
    backgroundColor: 'rgba(5, 8, 22, 0.7)',
    borderColor: 'rgba(69, 183, 255, 0.28)',
    borderRadius: 14,
    borderWidth: 1,
    color: '#F7FAFF',
    fontSize: 15,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(69, 183, 255, 0.55)',
    borderRadius: 13,
    borderWidth: 1,
    marginTop: 11,
    padding: 12,
  },
  secondaryButtonText: {
    color: '#78D8FF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  durationValue: { color: '#A78BFA', fontSize: 15, fontWeight: '800', marginTop: 5 },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  durationChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  durationChipSelected: {
    backgroundColor: 'rgba(120, 104, 255, 0.22)',
    borderColor: '#7868FF',
  },
  durationChipText: { color: '#A8B5D1', fontSize: 12, fontWeight: '700' },
  durationChipTextSelected: { color: '#E9E5FF' },
  remainingRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 15 },
  remainingText: { color: '#78D8FF', fontSize: 14, fontWeight: '800' },
  testButton: {
    alignItems: 'center',
    backgroundColor: '#7868FF',
    borderRadius: 15,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    marginTop: 14,
    padding: 14,
    shadowColor: '#7868FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  testButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  transcript: { color: '#C8D3EA', fontSize: 13, fontStyle: 'italic', marginTop: 12 },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  messageCard: {
    backgroundColor: 'rgba(69, 183, 255, 0.1)',
    borderColor: 'rgba(69, 183, 255, 0.28)',
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  messageText: { color: '#CFEAFF', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  privacyCard: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(88, 55, 145, 0.18)',
    borderColor: 'rgba(167, 139, 250, 0.3)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  privacyCopy: { flex: 1 },
  privacyTitle: { color: '#E9E5FF', fontSize: 15, fontWeight: '900' },
  privacyText: { color: '#A8B5D1', fontSize: 12, lineHeight: 18, marginTop: 4 },
  batteryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  batteryButtonText: {
    color: '#C8BEFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
