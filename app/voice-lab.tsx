import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule as Speech } from 'expo-speech-recognition';
import { useAuth } from '@/backend/auth/AuthProvider';
import { readVoiceLab, resetVoiceLabCounts, startVoiceLab, stopVoiceLab, voiceLabEnabled } from '@/services/VoiceLabCoordinator';

export default function VoiceLabScreen() {
  const { session } = useAuth();
  const user = session?.user;
  const [message, setMessage] = useState('');
  const [phrase, setPhrase] = useState('');
  const [snapshot, setSnapshot] = useState(() => readVoiceLab(user?.id ?? null));
  const action = useRef(0);
  const [pending, setPending] = useState(false);
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setPhrase(''); setMessage(''); action.current++;
    const refresh = () => { if (AppState.currentState === 'active') setSnapshot(readVoiceLab(owner.current ?? null)); };
    refresh(); const timer = setInterval(refresh, 500);
    const subscription = AppState.addEventListener('change', refresh);
    // View unmount only stops display updates, never the native recognition service.
    return () => { clearInterval(timer); subscription.remove(); };
  }, [user?.id]);
  if (!voiceLabEnabled()) return <View style={{ padding: 24 }}><Text>Laboratorio non disponibile in questa versione.</Text></View>;
  const launch = async () => {
    const id = user?.id;
    if (!id || pending) return;
    const revision = ++action.current;
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
      await startVoiceLab(id, phrase, current);
      if (current()) { setPhrase(''); setMessage('Avvio richiesto: attendi lo stato nativo. Non è una protezione.'); }
    }
    catch { if (current()) setMessage('Avvio non confermato. Controlla permessi, protezione disattivata e assenza di emergenze.'); }
    finally { if (mounted.current) setPending(false); }
  };
  const stop = () => {
    action.current++;
    try { stopVoiceLab(); } catch { setMessage('Arresto non confermato: verifica lo stato nativo o usa Ferma prova nella notifica.'); }
    setSnapshot(readVoiceLab(user?.id ?? null)); setPending(false);
  };
  const reasons: Record<string, string> = { word_not_in_model: 'Frase non supportata dal vocabolario: scegli altre parole.',
    model_or_capture_failed: 'Caricamento modello o acquisizione audio non riusciti.', service_start_failed: 'Avvio servizio rifiutato: verifica permessi e notifiche.',
    native_state_unknown: 'Stato nativo non verificabile: non dichiarato in ascolto.', session_limit: 'Limite di 30 minuti raggiunto.',
    audio_silenced: 'Acquisizione silenziata da Android.', audio_interrupted: 'Interruzione audio: prova fermata.',
    permission_or_privacy: 'Microfono non più disponibile.', notifications_blocked: 'Notifiche laboratorio bloccate: prova fermata.', core_service_started: 'Servizio di sicurezza avviato: prova fermata.' };
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 20, backgroundColor: '#061B36', flexGrow: 1 }} keyboardShouldPersistTaps="handled">
    <Text style={{ color: '#FFFFFF', fontSize: 24 }}>Prova motore vocale</Text>
    <Text style={{ color: '#FFFFFF' }}>Laboratorio offline, nessun SOS o SMS. Può continuare con Home e schermo spento; stop da notifica o da qui. Limite 30 minuti. Nessun riavvio automatico.</Text>
    <Text style={{ color: '#FFFFFF' }}>Stato: {snapshot.state === 'LISTENING' ? 'PROVA IN ASCOLTO — nessuna protezione' : snapshot.state === 'PREPARING' ? 'PREPARAZIONE — non ancora in ascolto' : snapshot.state === 'STOPPING' ? 'ARRESTO IN CORSO' : 'NON IN ASCOLTO'}</Text>
    <Text style={{ color: '#FFFFFF' }}>{reasons[snapshot.reason] ?? (snapshot.reason ? 'Prova interrotta o fermata.' : '')}</Text>
    <Text style={{ color: '#FFFFFF' }}>Rilevazioni finali: {snapshot.detections}. I risultati parziali non sono contati. Zero non prova l’assenza della frase.</Text>
    <TextInput accessibilityLabel="Frase solo di prova" value={phrase} onChangeText={setPhrase} maxLength={100} editable={!snapshot.busy && !pending}
      autoCorrect={false} spellCheck={false} importantForAutofill="no" autoComplete="off" placeholder="Frase di prova, non la parola operativa" placeholderTextColor="#9AB0C5" style={{ color: '#FFFFFF', borderColor: '#BDE9FF', borderWidth: 1, padding: 12 }} />
    <Text style={{ color: '#FFFFFF', fontSize: 17 }}>{message}</Text>
    <Pressable accessibilityRole="button" disabled={pending || !user || snapshot.busy} onPress={() => void launch()}
      style={{ minHeight: 48, padding: 16, backgroundColor: '#BDE9FF', borderRadius: 12 }}>
      <Text>{pending ? 'Verifica disponibilità…' : 'Avvia prova Vosk'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={stop} style={{ padding: 16, backgroundColor: '#BDE9FF' }}><Text>Ferma prova</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => { resetVoiceLabCounts(); setSnapshot(readVoiceLab(user?.id ?? null)); }} style={{ padding: 16, backgroundColor: '#BDE9FF' }}><Text>Azzera contatori</Text></Pressable>
  </ScrollView>;
}
