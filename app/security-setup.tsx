import { useEffect, useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { configureSecurityRequirement, readSecuritySetup, type SetupRequirement, type SetupSnapshot } from '@/services/SecuritySetup';

const requirements: { id: SetupRequirement; title: string; reason: string }[] = [
  { id: 'notifications', title: 'Notifiche Android', reason: 'Per ricevere gli avvisi di sicurezza fuori dall’app.' },
  { id: 'channel', title: 'Canale avvisi di sicurezza', reason: 'Checkpoint e Torno a casa richiedono importanza alta e suono. Le scelte Android non vengono aggirate.' },
  { id: 'location', title: 'Posizione durante l’uso', reason: 'Per condividere la posizione nelle funzioni che scegli di utilizzare.' },
  { id: 'gps', title: 'Servizi di posizione', reason: 'La posizione richiede anche che i servizi GPS del telefono siano abilitati.' },
  { id: 'background', title: 'Posizione in background — facoltativa', reason: 'Configura solo se usi tracking SOS o funzioni di posizione a schermo spento. Prima consenti la posizione durante l’uso; poi scegli “Consenti sempre”, se disponibile.' },
  { id: 'microphone', title: 'Microfono — Protezione Vocale', reason: 'Configura solo se vuoi utilizzare la parola d’ordine. Questa procedura non avvia l’ascolto.' },
  { id: 'recognizer', title: 'Riconoscimento italiano sul telefono', reason: 'Richiede Android 12 o successivo e un servizio vocale locale compatibile. Controlla il modello italiano offline nelle impostazioni del servizio vocale; non viene attivato un servizio cloud.' },
  { id: 'microphonePrivacy', title: 'Accesso globale al microfono', reason: 'Da verificare: controlla che “Accesso al microfono” sia attivo nei comandi rapidi o in Privacy Android. Il permesso dell’app non prova che questo interruttore sia attivo. Le opzioni variano sul telefono.' },
  { id: 'alarms', title: 'Allarmi esatti', reason: 'Per le scadenze di Checkpoint e Torno a casa. Non garantiscono da soli la puntualità sul dispositivo.' },
  { id: 'visibility', title: 'Comparsa e schermata bloccata', reason: 'Da verificare nelle impostazioni del canale: attiva gli avvisi a comparsa e sulla schermata bloccata se desiderati. Non disturbare può limitarli. L’app non può confermare che un avviso sia stato visto.' },
  { id: 'battery', title: 'Energia e restrizioni del produttore', reason: 'Da verificare: nelle impostazioni batteria controlla le restrizioni di SafeMeLink. Su Xiaomi verifica anche avvio automatico e notifiche a comparsa. Non esiste un controllo universale affidabile per queste opzioni.' },
];

export default function SecuritySetupScreen() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const refresh = async () => {
    const current = ++revision.current;
    const result = await readSecuritySetup();
    if (mounted.current && current === revision.current) setSnapshot(result);
  };
  useEffect(() => {
    mounted.current = true;
    if (Platform.OS === 'android') void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && Platform.OS === 'android') void refresh();
    });
    return () => { mounted.current = false; subscription.remove(); };
  }, []);
  const configure = async (id: SetupRequirement) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { await configureSecurityRequirement(id); }
    catch (error) {
      if (mounted.current) setMessage(error instanceof Error && error.message.startsWith('Prima configura') ? error.message : 'Impossibile completare la configurazione. Apri le impostazioni dell’app e verifica il requisito.');
    } finally {
      if (mounted.current) { await refresh(); if (mounted.current) setBusy(false); }
      inFlight.current = false;
    }
  };
  if (Platform.OS !== 'android') return <SafeAreaView><Text>Configurazione guidata disponibile su Android.</Text></SafeAreaView>;
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.link}>‹ Indietro</Text></Pressable>
      <Text style={styles.title}>Configura la tua sicurezza</Text>
      <Text style={styles.text}>Scegli cosa configurare, un requisito alla volta. Nessun permesso viene concesso automaticamente. Gli stati OK riguardano solo il controllo indicato, non garantiscono il funzionamento dell’intera modalità.</Text>
      {!!message && <Text accessibilityRole="alert" style={styles.warning}>{message}</Text>}
      {requirements.map(item => {
        const status = snapshot?.[item.id];
        return <SafeAreaView key={item.id} edges={[]} style={styles.card}>
          <Text style={styles.heading}>{item.title}</Text>
          <Text style={styles.text}>{item.reason}</Text>
          {item.id === 'recognizer' && snapshot?.recognitionDetail ? <Text style={styles.text}>{snapshot.recognitionDetail}</Text> : null}
          <Text style={styles.status}>{!status ? 'Verifica in corso…' : status === 'ready' ? 'OK — requisito disponibile' : status === 'missing' ? 'Da configurare' : 'Da verificare'}</Text>
          {status !== 'ready' && <Pressable accessibilityRole="button" accessibilityLabel={`Configura ${item.title}`} disabled={busy || !snapshot} style={styles.button} onPress={() => void configure(item.id)}><Text style={styles.link}>Configura</Text></Pressable>}
        </SafeAreaView>;
      })}
      <Text style={styles.heading}>SMS automatici e rubrica</Text>
      <Text style={styles.text}>Il consenso SMS e i relativi permessi si configurano nei Contatti fidati, solo se desideri l’invio automatico. L’accesso alla rubrica viene richiesto quando scegli un contatto.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/contacts' as Href)}><Text style={styles.link}>Apri Contatti fidati</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings().catch(() => setMessage('Impostazioni non disponibili su questo dispositivo.'))}><Text style={styles.link}>Apri impostazioni SafeMeLink</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080D20' }, content: { padding: 20, gap: 16 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' }, heading: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  text: { color: '#DFE6F4', fontSize: 16 }, status: { color: '#FFE09A', fontSize: 16 },
  card: { backgroundColor: '#17213A', padding: 16, borderRadius: 12, gap: 10 },
  link: { color: '#A7D8FF', fontSize: 17, paddingVertical: 12 }, button: { minHeight: 48 }, warning: { color: '#FFE09A', fontSize: 16 },
});
