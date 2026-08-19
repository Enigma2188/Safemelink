import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  AppState,
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

import { useAuth } from '@/backend/auth/AuthProvider';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
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
const VOICE_SETTINGS_LOAD_TIMEOUT_MS = 8_000;
const VOICE_SETTINGS_SAVE_TIMEOUT_MS = 8_000;

type MicrophoneState = 'off' | 'ready' | 'error';
type PassphraseSaveFeedback = {
  status: 'pending' | 'success' | 'error';
  text: string;
};

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

const loadSettingsWithTimeout = async (userId: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      VoiceProtectionStorage.get(userId),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Caricamento locale troppo lento. Riprova.')),
          VOICE_SETTINGS_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const runWithTimeout = async <T,>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [activationFeedback, setActivationFeedback] = useState('');
  const [italianModelDownloadRequired, setItalianModelDownloadRequired] = useState(false);
  const [passphraseSaveFeedback, setPassphraseSaveFeedback] =
    useState<PassphraseSaveFeedback | null>(null);
  const [now, setNow] = useState(Date.now());
  const screenActiveRef = useRef(false);
  const screenGenerationRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshRequestedRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const activationInFlightRef = useRef(false);
  const settingsRefreshPendingRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!italianModelDownloadRequired) {
      return;
    }

    let verificationGeneration = 0;
    const verifyDownloadedModel = async () => {
      const generation = verificationGeneration + 1;
      verificationGeneration = generation;
      const readiness = await VoiceProtectionService.getRecognitionReadiness('it-IT');
      if (
        generation !== verificationGeneration ||
        !screenActiveRef.current ||
        readiness !== 'ready'
      ) {
        return;
      }
      setItalianModelDownloadRequired(false);
      setMessage('Modello italiano offline disponibile. Ora puoi attivare la protezione.');
    };
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void verifyDownloadedModel();
      }
    });

    return () => {
      verificationGeneration += 1;
      appStateSubscription.remove();
    };
  }, [italianModelDownloadRequired]);

  const refreshState = useCallback(async (showLoading = true) => {
    if (refreshInFlightRef.current) {
      refreshRequestedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    const refreshGeneration = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = refreshGeneration;

    if (!userId) {
      if (screenActiveRef.current) {
        setSettings(DEFAULT_VOICE_PROTECTION_SETTINGS);
        setPassphraseDraft('');
        setMicrophoneState('off');
        setLoadError(null);
        setIsLoading(false);
      }
      refreshInFlightRef.current = false;
      return;
    }

    if (showLoading && screenActiveRef.current) {
      setIsLoading(true);
    }
    if (screenActiveRef.current) {
      setLoadError(null);
    }

    try {
      const storedSettings = await loadSettingsWithTimeout(userId);
      const hasExpired =
        storedSettings.expiresAt !== null &&
        new Date(storedSettings.expiresAt).getTime() <= Date.now();
      const shouldReconcileStoppedState =
        storedSettings.enabled && (hasExpired || !VoiceProtectionService.isRunning());
      const reconciledSettings: VoiceProtectionSettings = shouldReconcileStoppedState
        ? {
            ...storedSettings,
            enabled: false,
            enabledAt: null,
            expiresAt: null,
          }
        : storedSettings;

      if (
        shouldReconcileStoppedState &&
        screenActiveRef.current &&
        refreshGenerationRef.current === refreshGeneration
      ) {
        await runWithTimeout(
          VoiceProtectionStorage.save(userId, reconciledSettings),
          VOICE_SETTINGS_SAVE_TIMEOUT_MS,
          'Il salvataggio locale non risponde. Riprova.',
        );
        VoiceProtectionRuntime.notifySettingsChanged(userId);
      }

      if (
        screenActiveRef.current &&
        refreshGenerationRef.current === refreshGeneration
      ) {
        setSettings(reconciledSettings);
        setPassphraseDraft(reconciledSettings.passphrase);
        setMicrophoneState(reconciledSettings.enabled ? 'ready' : 'off');
      }
    } catch (error) {
      if (
        screenActiveRef.current &&
        refreshGenerationRef.current === refreshGeneration
      ) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Impossibile caricare le impostazioni di Protezione Vocale.';
        setSettings(DEFAULT_VOICE_PROTECTION_SETTINGS);
        setPassphraseDraft('');
        setMicrophoneState('error');
        setLoadError(errorMessage);
        setMessage(errorMessage);
      }
    } finally {
      refreshInFlightRef.current = false;
      if (screenActiveRef.current) {
        setIsLoading(false);
      }
      if (refreshRequestedRef.current && screenActiveRef.current) {
        refreshRequestedRef.current = false;
        void refreshState(false);
      }
    }
  }, [userId]);

  useEffect(
    () =>
      VoiceProtectionRuntime.onSettingsChanged((changedUserId) => {
        if (changedUserId !== userId || !screenActiveRef.current) {
          return;
        }
        if (activationInFlightRef.current) {
          settingsRefreshPendingRef.current = true;
          return;
        }
        void refreshState(false);
      }),
    [refreshState, userId],
  );

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      screenGenerationRef.current += 1;
      setIsSaving(saveInFlightRef.current);
      void refreshState(true);

      return () => {
        refreshGenerationRef.current += 1;
        refreshRequestedRef.current = false;
        screenActiveRef.current = false;
      };
    }, [refreshState]),
  );

  useEffect(() => {
    if (!settings.enabled || !settings.expiresAt) {
      return;
    }

    const clock = setInterval(() => {
      const currentTime = Date.now();
      if (screenActiveRef.current) {
        setNow(currentTime);
      }
      const expiresAt = settingsRef.current.expiresAt;

      if (
        screenActiveRef.current &&
        settingsRef.current.enabled &&
        expiresAt &&
        new Date(expiresAt).getTime() <= currentTime
      ) {
        void refreshState(false);
      }
    }, 1000);

    return () => {
      clearInterval(clock);
    };
  }, [refreshState, settings.enabled, settings.expiresAt]);

  const durationLabel = useMemo(
    () =>
      DURATION_OPTIONS.find((option) => option.value === settings.durationMinutes)
        ?.label ?? '1 ora',
    [settings.durationMinutes],
  );

  const savePassphrase = async () => {
    if (saveInFlightRef.current) {
      console.info('[VoiceProtection] salvataggio ignorato: operazione già in corso');
      return;
    }

    if (!userId) {
      const feedback = 'Accedi prima di configurare Protezione Vocale.';
      setPassphraseSaveFeedback({ status: 'error', text: feedback });
      setMessage(feedback);
      return;
    }

    const trimmedPassphrase = passphraseDraft.trim();
    const normalizedPassphrase = normalizePassphrase(trimmedPassphrase);

    if (normalizedPassphrase.length < 3) {
      const feedback = 'La parola d’ordine deve contenere almeno 3 caratteri.';
      setPassphraseSaveFeedback({ status: 'error', text: feedback });
      setMessage(feedback);
      return;
    }

    const startedAt = Date.now();
    const screenGeneration = screenGenerationRef.current;
    saveInFlightRef.current = true;
    refreshGenerationRef.current += 1;
    setIsSaving(true);
    setMessage('');
    setPassphraseSaveFeedback({ status: 'pending', text: 'Salvataggio in corso…' });
    console.info('[VoiceProtection] inizio salvataggio parola');

    try {
      const updatedSettings: VoiceProtectionSettings = {
        ...settingsRef.current,
        passphrase: trimmedPassphrase,
      };

      console.info('[VoiceProtection] scrittura storage avviata');
      await runWithTimeout(
        VoiceProtectionStorage.save(userId, updatedSettings),
        VOICE_SETTINGS_SAVE_TIMEOUT_MS,
        'Il salvataggio locale non risponde. Riprova.',
      );
      console.info('[VoiceProtection] scrittura storage completata');

      console.info('[VoiceProtection] lettura di verifica avviata');
      const storedSettings = await runWithTimeout(
        VoiceProtectionStorage.get(userId),
        VOICE_SETTINGS_SAVE_TIMEOUT_MS,
        'La verifica del salvataggio locale non risponde. Riprova.',
      );
      console.info('[VoiceProtection] lettura di verifica completata');

      if (storedSettings.passphrase !== trimmedPassphrase) {
        throw new Error('La parola salvata non coincide con il valore inserito. Riprova.');
      }

      console.info('[VoiceProtection] conferma salvataggio riuscita', {
        durationMs: Date.now() - startedAt,
      });
      if (
        screenActiveRef.current &&
        screenGenerationRef.current === screenGeneration
      ) {
        refreshGenerationRef.current += 1;
        setSettings(storedSettings);
        setPassphraseDraft(storedSettings.passphrase);
        setMessage('Parola d’ordine salvata soltanto su questo dispositivo.');
        setPassphraseSaveFeedback({
          status: 'success',
          text: 'Parola d’ordine salvata.',
        });
        VoiceProtectionRuntime.notifySettingsChanged(userId);
      }
    } catch (error) {
      console.error('[VoiceProtection] salvataggio fallito', {
        durationMs: Date.now() - startedAt,
        category: error instanceof Error ? 'storage_error' : 'unknown_error',
      });
      if (
        screenActiveRef.current &&
        screenGenerationRef.current === screenGeneration
      ) {
        const feedback =
          error instanceof Error &&
          (error.message.startsWith('Il salvataggio locale non risponde') ||
            error.message.startsWith('La verifica del salvataggio locale non risponde') ||
            error.message.startsWith('La parola salvata non coincide'))
            ? error.message
            : 'Impossibile salvare la parola d’ordine. Riprova.';
        setPassphraseSaveFeedback({ status: 'error', text: feedback });
        setMessage(feedback);
      }
    } finally {
      saveInFlightRef.current = false;
      console.info('[VoiceProtection] salvataggio terminato', {
        durationMs: Date.now() - startedAt,
      });
      if (screenActiveRef.current) {
        setIsSaving(false);
      }
    }
  };

  const activateProtection = async () => {
    if (activationInFlightRef.current) {
      return;
    }
    if (!userId) {
      const feedback = 'Accedi prima di attivare Protezione Vocale.';
      setActivationFeedback(feedback);
      setMessage(feedback);
      return;
    }
    if (!normalizePassphrase(settings.passphrase)) {
      const feedback = 'Configura e salva prima una parola d’ordine.';
      setActivationFeedback(feedback);
      setMessage(feedback);
      return;
    }

    activationInFlightRef.current = true;
    refreshGenerationRef.current += 1;
    setIsSaving(true);
    setMessage('');
    setActivationFeedback('Avvio della protezione in corso…');

    try {
      if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
        const feedback = 'Il riconoscimento vocale locale non è supportato dal dispositivo.';
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }
      const recognitionReadiness = await VoiceProtectionService.getRecognitionReadiness('it-IT');
      if (recognitionReadiness === 'recognition_unavailable') {
        const feedback = 'Riconoscimento vocale non disponibile su questo dispositivo.';
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }
      if (recognitionReadiness === 'on_device_unavailable') {
        const feedback = 'Il riconoscimento vocale locale non è supportato dal dispositivo.';
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }
      if (recognitionReadiness === 'italian_model_missing') {
        const feedback = 'Installa il modello italiano offline prima di attivare la protezione.';
        setItalianModelDownloadRequired(true);
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }

      const permissions = await VoiceProtectionService.requestPermissions();
      if (!permissions.microphoneGranted) {
        const feedback =
          'Permesso microfono non concesso. La protezione non è stata attivata.';
        setMicrophoneState('error');
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }
      if (!permissions.notificationsGranted) {
        const feedback =
          'Autorizza le notifiche per avviare l’avviso persistente di protezione.';
        setMicrophoneState('error');
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }

      const activation = await VoiceProtectionService.start(
        userId,
        settings.durationMinutes,
      );
      if (!VoiceProtectionService.isRunning()) {
        await VoiceProtectionService.stop().catch(() => {});
        const feedback =
          'Il servizio di protezione non si è avviato. Il controllo resta disattivato.';
        setMicrophoneState('error');
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }

      const activeSettings: VoiceProtectionSettings = {
        ...settings,
        enabled: true,
        enabledAt: activation.enabledAt,
        expiresAt: activation.expiresAt,
      };

      try {
        await runWithTimeout(
          VoiceProtectionStorage.save(userId, activeSettings),
          VOICE_SETTINGS_SAVE_TIMEOUT_MS,
          'Il salvataggio locale non risponde. Riprova.',
        );
      } catch {
        await VoiceProtectionService.stop().catch(() => {});
        const inactiveSettings: VoiceProtectionSettings = {
          ...settingsRef.current,
          enabled: false,
          enabledAt: null,
          expiresAt: null,
        };
        setSettings(inactiveSettings);
        void VoiceProtectionStorage.save(userId, inactiveSettings).catch(() => {});
        const feedback =
          'Impossibile salvare l’attivazione. Il servizio è stato arrestato: puoi riprovare.';
        setMicrophoneState('error');
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }

      if (!VoiceProtectionService.isRunning()) {
        const inactiveSettings: VoiceProtectionSettings = {
          ...settingsRef.current,
          enabled: false,
          enabledAt: null,
          expiresAt: null,
        };
        await VoiceProtectionService.stop().catch(() => {});
        setSettings(inactiveSettings);
        void VoiceProtectionStorage.save(userId, inactiveSettings).catch(() => {});
        const feedback =
          'Il servizio di protezione si è interrotto durante l’attivazione. Puoi riprovare.';
        setMicrophoneState('error');
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }

      const recognitionStarted = VoiceProtectionRuntime.waitForRecognitionStart(userId, 8_000);
      refreshGenerationRef.current += 1;
      setItalianModelDownloadRequired(false);
      VoiceProtectionRuntime.notifySettingsChanged(userId);
      if (!(await recognitionStarted)) {
        const inactiveSettings: VoiceProtectionSettings = {
          ...activeSettings,
          enabled: false,
          enabledAt: null,
          expiresAt: null,
        };
        await VoiceProtectionService.stop().catch(() => {});
        await VoiceProtectionStorage.save(userId, inactiveSettings).catch(() => {});
        refreshGenerationRef.current += 1;
        setSettings(inactiveSettings);
        setMicrophoneState('error');
        VoiceProtectionRuntime.notifySettingsChanged(userId);
        const feedback =
          'Il riconoscimento locale non si è avviato. Verifica il modello italiano e riprova.';
        setActivationFeedback(feedback);
        setMessage(feedback);
        return;
      }
      setSettings(activeSettings);
      setMicrophoneState('ready');
      const feedback = 'Protezione attiva. SafeMeLink sta ascoltando la parola d’ordine.';
      setActivationFeedback(feedback);
      setMessage(feedback);
    } catch {
      await VoiceProtectionService.stop().catch(() => {});
      const feedback =
        'Il servizio di protezione non si è avviato. Controlla i permessi e riprova.';
      setMicrophoneState('error');
      setActivationFeedback(feedback);
      setMessage(feedback);
    } finally {
      activationInFlightRef.current = false;
      setIsSaving(false);
      if (settingsRefreshPendingRef.current) {
        settingsRefreshPendingRef.current = false;
        void refreshState(false);
      }
    }
  };

  const deactivateProtection = async () => {
    if (!userId || activationInFlightRef.current) {
      return;
    }

    activationInFlightRef.current = true;
    refreshGenerationRef.current += 1;
    setIsSaving(true);
    try {
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
      await runWithTimeout(
        VoiceProtectionStorage.save(userId, inactiveSettings),
        VOICE_SETTINGS_SAVE_TIMEOUT_MS,
        'Il salvataggio locale non risponde. Riprova.',
      );
      refreshGenerationRef.current += 1;
      setSettings(inactiveSettings);
      setMicrophoneState('off');
      VoiceProtectionRuntime.notifySettingsChanged(userId);
      setMessage('Protezione disattivata.');
    } catch (error) {
      setMicrophoneState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossibile disattivare Protezione Vocale.',
      );
    } finally {
      activationInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const requestItalianModelDownload = async () => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setMessage('Apertura installazione del modello italiano offline…');
    try {
      const result = await VoiceProtectionService.requestItalianModelDownload();
      if (result.status === 'download_success') {
        const readiness = await VoiceProtectionService.getRecognitionReadiness('it-IT');
        const modelReady = readiness === 'ready';
        setItalianModelDownloadRequired(!modelReady);
        setMessage(
          modelReady
            ? 'Modello italiano offline installato. Ora puoi attivare la protezione.'
            : 'Download completato, ma il modello italiano non è ancora verificabile. Riprova la verifica.',
        );
      } else if (result.status === 'opened_dialog') {
        setMessage('Completa l’installazione del modello italiano nella finestra Android.');
      } else {
        setMessage('Installazione annullata. Puoi riprovare quando vuoi.');
      }
    } catch {
      setMessage(
        'Non riesco ad aprire l’installazione automatica. Installa la lingua italiana nelle impostazioni del riconoscimento vocale Android.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const setDuration = async (durationMinutes: VoiceProtectionDurationMinutes) => {
    if (settings.enabled || !userId) {
      return;
    }

    const previousSettings = settingsRef.current;
    const updatedSettings = { ...previousSettings, durationMinutes };
    refreshGenerationRef.current += 1;
    setSettings(updatedSettings);
    try {
      await runWithTimeout(
        VoiceProtectionStorage.save(userId, updatedSettings),
        VOICE_SETTINGS_SAVE_TIMEOUT_MS,
        'Il salvataggio locale non risponde. Riprova.',
      );
      setSettings(updatedSettings);
    } catch (error) {
      if (screenActiveRef.current) {
        setSettings(previousSettings);
        setMessage(
          error instanceof Error
            ? error.message
            : 'Impossibile salvare la durata della protezione.',
        );
      }
    }
  };

  const microphoneLabel =
    microphoneState === 'error'
      ? 'Richiede attenzione'
      : microphoneState === 'ready'
        ? 'Ascolto locale attivo'
        : 'Non in uso';

  const toggleUnavailableFeedback = isSaving
    ? 'Operazione in corso…'
    : !userId
      ? 'Accedi per attivare Protezione Vocale.'
      : !settings.enabled && !settings.passphrase
        ? 'Salva prima una parola d’ordine.'
        : '';
  const showPermissionSettings =
    activationFeedback.startsWith('Permesso microfono non concesso') ||
    activationFeedback.startsWith('Autorizza le notifiche');

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
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
              disabled={isSaving || !userId || (!settings.enabled && !settings.passphrase)}
              onValueChange={(enabled) =>
                void (enabled ? activateProtection() : deactivateProtection())
              }
              thumbColor="#F7FAFF"
              trackColor={{ false: '#33405F', true: '#7868FF' }}
              value={settings.enabled}
            />
          </View>

          {toggleUnavailableFeedback || activationFeedback ? (
            <Text accessibilityLiveRegion="polite" style={styles.cardDescription}>
              {toggleUnavailableFeedback || activationFeedback}
            </Text>
          ) : null}
          {showPermissionSettings ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void Linking.openSettings().catch(() => {
                  setMessage('Apri manualmente le impostazioni di SafeMeLink per autorizzare il permesso.');
                });
              }}
              style={styles.batteryButton}>
              <Ionicons color="#C8BEFF" name="settings-outline" size={17} />
              <Text style={styles.batteryButtonText}>APRI IMPOSTAZIONI APP</Text>
            </Pressable>
          ) : null}

          <View style={styles.microphoneRow}>
            <View
              style={[
                styles.microphoneDot,
                microphoneState === 'ready' && styles.microphoneReady,
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

        {loadError ? (
          <View style={styles.warningCard}>
            <Ionicons color="#FFCA72" name="warning-outline" size={22} />
            <View style={styles.retryCopy}>
              <Text style={[styles.warningText, styles.retryMessage]}>{loadError}</Text>
              <Pressable
                onPress={() => void refreshState(true)}
                style={styles.retryButton}>
                <Text style={styles.retryButtonText}>RIPROVA</Text>
              </Pressable>
            </View>
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
            onChangeText={(value) => {
              setPassphraseDraft(value);
              setPassphraseSaveFeedback(null);
            }}
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
          {passphraseSaveFeedback ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.passphraseSaveFeedback,
                passphraseSaveFeedback.status === 'success' &&
                  styles.passphraseSaveFeedbackSuccess,
                passphraseSaveFeedback.status === 'error' &&
                  styles.passphraseSaveFeedbackError,
              ]}>
              {passphraseSaveFeedback.text}
            </Text>
          ) : null}
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

        {italianModelDownloadRequired ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Modello italiano offline</Text>
            <Text style={styles.cardDescription}>
              Installa il modello locale richiesto prima di attivare la protezione.
            </Text>
            <Pressable
              disabled={isSaving}
              onPress={() => void requestItalianModelDownload()}
              style={[styles.batteryButton, isSaving && styles.disabled]}>
              <Ionicons color="#C8BEFF" name="download-outline" size={17} />
              <Text style={styles.batteryButtonText}>INSTALLA MODELLO ITALIANO</Text>
            </Pressable>
          </View>
        ) : null}

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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#050816', flex: 1 },
  keyboardAvoidingView: { flex: 1 },
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
  retryCopy: { flex: 1 },
  retryMessage: { flex: 0 },
  retryButton: { alignSelf: 'flex-start', marginTop: 9, paddingVertical: 4 },
  retryButtonText: { color: '#FFCA72', fontSize: 12, fontWeight: '900' },
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
  passphraseSaveFeedback: {
    color: '#A8B5D1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
    textAlign: 'center',
  },
  passphraseSaveFeedbackSuccess: { color: '#45D6A5' },
  passphraseSaveFeedbackError: { color: '#FF9AAA' },
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
