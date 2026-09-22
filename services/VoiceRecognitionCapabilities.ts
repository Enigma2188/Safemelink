import { ExpoSpeechRecognitionModule as Speech } from 'expo-speech-recognition';
import { Platform } from 'react-native';

export type VoiceRecognitionReadiness = 'ready' | 'recognition_unavailable' | 'on_device_unavailable' | 'italian_model_missing' | 'model_status_unknown' | 'android_version_unsupported';

export const voiceReadinessMessage = (state: VoiceRecognitionReadiness): string => {
  switch (state) {
    case 'android_version_unsupported': return 'Per garantire il riconoscimento solo sul telefono serve Android 12 o successivo. Non viene usato il riconoscimento online.';
    case 'recognition_unavailable': return 'Servizio vocale non disponibile. Nelle impostazioni Android controlla che un servizio di riconoscimento sia installato, aggiornato e abilitato.';
    case 'on_device_unavailable': return 'Il servizio vocale locale non è disponibile al momento. Aggiorna o abilita il servizio vocale nelle impostazioni Android e controlla le lingue offline. Il riconoscimento online non viene usato.';
    case 'italian_model_missing': return 'Il motore non elenca il modello italiano installato. Scarica la lingua italiana offline e riprova.';
    default: return '';
  }
};

// Only fixed categories are logged: never engine messages, transcript or identifiers.
export function logVoiceEngineError(code: unknown) {
  const known = ['aborted', 'audio-capture', 'bad-grammar', 'busy', 'client', 'language-not-supported', 'network', 'no-speech', 'not-allowed', 'service-not-allowed', 'speech-timeout'];
  console.info('[VoiceProtection] engine', { code: typeof code === 'string' && known.includes(code) ? code : 'unknown' });
}

export async function getVoiceRecognitionReadiness(locale = 'it-IT'): Promise<VoiceRecognitionReadiness> {
  const apiLevel = Platform.OS === 'android' ? Number(Platform.Version) : null;
  let general: boolean | null = null;
  let onDevice: boolean | null = null;
  let result: VoiceRecognitionReadiness = 'model_status_unknown';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    general = Speech.isRecognitionAvailable();
    onDevice = Speech.supportsOnDeviceRecognition();
    if (apiLevel !== null && apiLevel < 31) return (result = 'android_version_unsupported');
    // The on-device recognizer does not require a default generic recognizer.
    if (!onDevice) return (result = general ? 'on_device_unavailable' : 'recognition_unavailable');
    if (Platform.OS !== 'android') return (result = 'ready');
    if (apiLevel === 31 || apiLevel === 32) return result; // Language enumeration requires API 33.
    const { installedLocales } = await Promise.race([
      Speech.getSupportedLocales({}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 5_000); }),
    ]);
    // Some engines cannot enumerate languages. Empty is unknown, not proof of absence.
    if (!installedLocales.length) return result;
    const normalize = (value: string) => value.replace(/_/g, '-').toLowerCase();
    result = installedLocales.some((value) => normalize(value) === normalize(locale))
      ? 'ready'
      : installedLocales.some((value) => normalize(value).split('-')[0] === normalize(locale).split('-')[0])
        ? 'model_status_unknown' : 'italian_model_missing';
    return result;
  } catch {
    // Capability query failure must never enable a potentially remote recognizer.
    result = onDevice === true ? 'model_status_unknown' : 'on_device_unavailable';
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    console.info('[VoiceProtection] capabilities', { apiLevel, general, onDevice, result });
  }
}
