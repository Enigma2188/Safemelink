import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule as Speech } from 'expo-speech-recognition';
import { Link } from 'expo-router';
import { useAuth } from '@/backend/auth/AuthProvider';
import { readVoiceLab, resetVoiceLabCounts, startVoiceLab, stopVoiceLab, voiceLabEnabled, VoiceLabStartError } from '@/services/VoiceLabCoordinator';

export default function VoiceLabScreen() {
  const { session } = useAuth();
  const user = session?.user;
  const [message, setMessage] = useState('');
  const [phrase, setPhrase] = useState('');
  const [automaticGain, setAutomaticGain] = useState(false);
  const [snapshot, setSnapshot] = useState(() => readVoiceLab(user?.id ?? null));
  const action = useRef(0);
  const pendingAction = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setPhrase(''); setAutomaticGain(false); setMessage(''); action.current++; pendingAction.current = null; setPending(false);
    const refresh = () => { if (AppState.currentState === 'active') setSnapshot(readVoiceLab(owner.current ?? null)); };
    refresh(); const timer = setInterval(refresh, 500);
    const subscription = AppState.addEventListener('change', refresh);
    // View unmount only stops display updates, never the native recognition service.
    return () => { clearInterval(timer); subscription.remove(); };
  }, [user?.id]);
  if (!voiceLabEnabled()) return <View style={{ padding: 24 }}><Text>Laboratorio non disponibile in questa versione.</Text></View>;
  const launch = async () => {
    const id = user?.id;
    if (!id || pendingAction.current !== null) return;
    const revision = ++action.current;
    pendingAction.current = revision;
    const current = () => mounted.current && owner.current === id && action.current === revision;
    setPending(true);
    try {
      if (!phrase.trim() || phrase.length > 100) { setMessage('Inserisci una frase di prova da 1 a 100 caratteri.'); return; }
      const microphone = await Speech.getMicrophonePermissionsAsync();
      if (!current()) return;
      if (!microphone.granted) {
        const permission = await Speech.requestMicrophonePermissionsAsync();
        if (!permission.granted || !current()) { if (current()) setMessage('Microfono non concesso. Nessuna prova avviata.'); return; }
      }
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const notices = await Notifications.getPermissionsAsync();
        if (!current()) return;
        if (!notices.granted) {
          const permission = await Notifications.requestPermissionsAsync();
          if (!permission.granted || !current()) { if (current()) setMessage('Notifiche necessarie per vedere e fermare la prova.'); return; }
        }
      }
      await startVoiceLab(id, phrase, current, automaticGain);
      if (current()) { setMessage('Avvio richiesto: attendi lo stato nativo. Non è una protezione.'); }
    }
    catch (error) { if (current()) setMessage(error instanceof VoiceLabStartError ? `${error.message} (Codice: ${error.code})` : 'Verifica o avvio non completati. Nessun ascolto confermato; riprova e controlla lo stato SOS dalla Protezione Vocale.'); }
    finally { if (mounted.current && pendingAction.current === revision) { pendingAction.current = null; setPending(false); } }
  };
  const stop = () => {
    action.current++; pendingAction.current = null;
    try { stopVoiceLab(); } catch { setMessage('Arresto non confermato: verifica lo stato nativo o usa Ferma prova nella notifica.'); }
    setSnapshot(readVoiceLab(user?.id ?? null)); setPending(false);
  };
  const reasons: Record<string, string> = { word_not_in_model: 'Frase non supportata dal vocabolario: scegli altre parole.',
    model_or_capture_failed: 'Caricamento modello o acquisizione audio non riusciti.', service_start_failed: 'Avvio servizio rifiutato: verifica permessi e notifiche.',
    model_prepare_failed: 'Preparazione dei file del modello non riuscita.', model_load_failed: 'Il motore non riesce a caricare il modello incluso.',
    vocabulary_check_failed: 'Controllo del vocabolario nativo non riuscito.', capture_start_failed: 'Android non ha consentito di avviare la registrazione.', capture_read_failed: 'Acquisizione audio interrotta o non disponibile.',
    native_state_unknown: 'Stato nativo non verificabile: non dichiarato in ascolto.', session_limit: 'Limite di 30 minuti raggiunto.',
    gain_unavailable: 'Guadagno automatico non disponibile su questo telefono: prova ON interrotta.',
    gain_control_unavailable: 'Android non concede il controllo del guadagno: prova ON interrotta.',
    gain_enable_failed: 'Attivazione del guadagno non confermata da Android: prova ON interrotta.',
    gain_control_lost: 'Guadagno disattivato o controllo perso durante la prova: ascolto interrotto.',
    audio_silenced: 'Acquisizione silenziata da Android.', audio_interrupted: 'Interruzione audio: prova fermata.',
    permission_or_privacy: 'Microfono non più disponibile.', notifications_blocked: 'Notifiche laboratorio bloccate: prova fermata.', core_service_started: 'Servizio di sicurezza avviato: prova fermata.' };
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 20, backgroundColor: '#061B36', flexGrow: 1 }} keyboardShouldPersistTaps="handled">
    <Text style={{ color: '#FFFFFF', fontSize: 24 }}>Prova motore vocale Vosk</Text>
    <Text style={{ color: '#BDE9FF' }}>Questa è la prova del nuovo motore. La schermata Protezione Vocale usa ancora il motore precedente.</Text>
    <Text style={{ color: '#FFFFFF' }}>Laboratorio offline, nessun SOS o SMS. Può continuare con Home e schermo spento; stop da notifica o da qui. Limite 30 minuti. Nessun riavvio automatico.</Text>
    <Text style={{ color: '#FFFFFF' }}>Stato: {snapshot.state === 'LISTENING' ? 'PROVA IN ASCOLTO — nessuna protezione' : snapshot.state === 'PREPARING' ? 'PREPARAZIONE — non ancora in ascolto' : snapshot.state === 'STOPPING' ? 'ARRESTO IN CORSO' : 'NON IN ASCOLTO'}</Text>
    <Text selectable style={{ color: '#FFFFFF' }}>Build: {process.env.EXPO_PUBLIC_BUILD_SHA || 'non disponibile'} · Stato nativo: {snapshot.state} · Codice: {snapshot.reason || 'nessuno'}</Text>
    <Text style={{ color: '#FFFFFF' }}>{reasons[snapshot.reason] ?? (snapshot.reason ? 'Prova interrotta o fermata.' : '')}</Text>
    <Text style={{ color: '#FFFFFF' }}>Rilevazioni finali: {snapshot.detections}. I risultati parziali non sono contati. Zero non prova l’assenza della frase.</Text>
    <Text style={{ color: '#FFFFFF' }}>Confronta la stessa frase: prima guadagno OFF, poi ON; per ciascuna scelta prova a telefono libero e in tasca. Ferma la prova prima di cambiare opzione. La frase resta solo in memoria in questa schermata.</Text>
    <View style={{ gap: 8 }}>
      <Text style={{ color: '#FFFFFF' }}>Prova guadagno automatico del microfono: {automaticGain ? 'ON' : 'OFF'}</Text>
      <Switch accessibilityLabel="Prova guadagno automatico del microfono" value={automaticGain}
        disabled={pending || snapshot.busy || !user} onValueChange={setAutomaticGain} />
    </View>
    <Text style={{ color: '#BDE9FF' }}>Su alcuni telefoni il guadagno può essere indisponibile o peggiorare il riconoscimento. OFF non aggiunge l’effetto: eventuali elaborazioni automatiche del produttore non sono escluse.</Text>
    <Text style={{ color: '#FFFFFF' }}>Sessione nativa: guadagno richiesto {snapshot.gainRequested ? 'ON' : 'OFF'} · effetto aggiunto {snapshot.gainActive ? 'attivato e verificato' : 'non attivo'}</Text>
    <Text accessibilityLabel="Livello audio relativo" style={{ color: '#FFFFFF' }}>Segnale corrente: {snapshot.audioLevel}/100 · Picco della sessione: {snapshot.audioPeak}/100</Text>
    <Text style={{ color: '#BDE9FF' }}>Indicatore relativo del PCM inviato al riconoscitore (livello RMS, scala da −60 dBFS a fondo scala). NON è una probabilità di riconoscimento né una misura calibrata del volume. Il picco è il massimo di questo indicatore.</Text>
    <TextInput accessibilityLabel="Frase solo di prova" value={phrase} onChangeText={setPhrase} maxLength={100} editable={!snapshot.busy && !pending}
      autoCorrect={false} spellCheck={false} importantForAutofill="no" autoComplete="off" placeholder="Frase di prova, non la parola operativa" placeholderTextColor="#9AB0C5" style={{ color: '#FFFFFF', borderColor: '#BDE9FF', borderWidth: 1, padding: 12 }} />
    <Text style={{ color: '#FFFFFF', fontSize: 17 }}>{message}</Text>
    <Pressable accessibilityRole="button" disabled={pending || !user || snapshot.busy} onPress={() => void launch()}
      style={{ minHeight: 48, padding: 16, backgroundColor: '#BDE9FF', borderRadius: 12 }}>
      <Text>{pending ? 'Verifica disponibilità…' : 'Avvia prova Vosk'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={stop} style={{ padding: 16, backgroundColor: '#BDE9FF' }}><Text>Ferma prova</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => { resetVoiceLabCounts(); setSnapshot(readVoiceLab(user?.id ?? null)); }} style={{ padding: 16, backgroundColor: '#BDE9FF' }}><Text>Azzera contatori</Text></Pressable>
    <Link href={'/voice-protection' as never} style={{ color: '#BDE9FF', padding: 16 }}>Apri Protezione Vocale → VERIFICA SOS</Link>
  </ScrollView>;
}
