import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/backend/auth/AuthProvider';
import { ReceivedEmergencyInformation } from '@/components/ReceivedEmergencyInformation';
import { ReceivedSOSMap } from '@/components/ReceivedSOSMap';
import { ReceivedPersonalSafetyInformation } from '@/components/ReceivedPersonalSafetyInformation';
import { describePositionAge, ReceivedSOSDetailController, type ReceivedDetailState } from '@/services/ReceivedSOSDetail';

const labels = { open: 'Attivo', accepted: 'Accettato', closed: 'Chiuso', cancelled: 'Annullato' };
const initial: ReceivedDetailState = { context: null, kind: 'paused', sos: null, lifecycle: null,
  selection: { position: null, lastKnown: false, issue: null }, refreshedAt: null, accepting: false };

export default function AndroidReceivedSOSScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const sosId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id;
  const focused = useIsFocused();
  const router = useRouter();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [state, setState] = useState<ReceivedDetailState>(initial);
  const [navigationError, setNavigationError] = useState(false);
  const controller = useRef<ReceivedSOSDetailController | null>(null);
  if (!controller.current) controller.current = new ReceivedSOSDetailController(setState);
  const allowed = focused && foreground && !isInitializing && !!userId && !!sosId;
  const visible = allowed && state.context?.userId === userId && state.context.sosId === sosId;
  const [mapRequest, setMapRequest] = useState<{ scope: string } | null>(null);
  const mapOwner = useRef<string | null>(null);
  const scope = `${userId}:${sosId}`;
  // Invalidate immediately on render, not only in a passive cleanup effect.
  if (!visible || (state.kind !== 'active' && state.kind !== 'loading')) mapOwner.current = null;
  const showMap = visible && mapOwner.current === scope && mapRequest?.scope === scope &&
    (state.kind === 'active' || state.kind === 'loading');
  const liveContext = useRef({ allowed, userId, sosId, state });
  liveContext.current = { allowed, userId, sosId, state };
  const currentState = () => {
    const current = liveContext.current;
    const identity = current.state.context;
    return current.allowed && identity !== null && identity.userId === current.userId &&
      identity.sosId === current.sosId && current.state.kind === 'active' ? current.state : null;
  };
  const navigating = useRef(false);
  const goBack = () => {
    if (navigating.current) return;
    navigating.current = true;
    try { if (router.canGoBack()) router.back(); else router.replace('/'); }
    catch { navigating.current = false; setNavigationError(true); }
  };

  useEffect(() => {
    const listener = AppState.addEventListener('change', value => {
      if (value !== 'active') controller.current?.configure(null);
      setForeground(value === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    const current = controller.current!;
    current.configure(allowed && userId && sosId ? { userId, sosId } : null);
    setNavigationError(false);
    return () => current.configure(null);
  }, [allowed, userId, sosId]);
  useEffect(() => {
    if (!focused) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => listener.remove();
  });

  const position = visible && state.kind === 'active' ? state.selection.position : null;
  const openNavigator = async () => {
    const point = currentState()?.selection.position;
    if (!point) return;
    try { await Linking.openURL(`https://maps.google.com/?q=${point.latitude},${point.longitude}`); }
    catch { setNavigationError(true); }
  };
  const openMap = () => {
    const verified = currentState();
    if (!verified?.selection.position || `${verified.context?.userId}:${verified.context?.sosId}` !== scope) return;
    mapOwner.current = scope;
    setMapRequest({ scope });
  };

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <Text accessibilityRole="header" style={styles.title}>SOS SafeMeLink</Text>
    {!userId && !isInitializing ? <Text style={styles.notice}>Accedi per visualizzare questo SOS.</Text> : null}
    {!sosId ? <Text style={styles.notice}>Identificativo SOS non disponibile.</Text> : null}
    {visible && state.kind === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {state.accepting ? 'Presa in carico in corso…' : 'Verifica SOS e posizione in corso…'}</Text> : null}
    {visible && state.kind === 'denied' ? <Text style={styles.notice}>SOS non disponibile o accesso non più autorizzato. Aggiornamenti interrotti.</Text> : null}
    {visible && state.kind === 'error' ? <View><Text style={styles.notice}>Impossibile verificare il SOS. I dati protetti non sono mostrati.</Text>
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void controller.current?.refresh()}><Text style={styles.link}>Riprova verifica</Text></Pressable></View> : null}
    {visible && state.kind === 'terminal' ? <View style={styles.card}><Text style={styles.value}>{state.lifecycle ? labels[state.lifecycle.sos_status] : 'SOS concluso'}</Text>
      <Text style={styles.notice}>Emergenza conclusa: posizione e informazioni protette non sono più disponibili.</Text></View> : null}
    {visible && state.kind === 'active' && state.sos ? <View style={styles.card}>
      <Text style={styles.name}>{state.sos.sender_display_name}</Text>
      <Text style={styles.notice}>Ha attivato una richiesta di aiuto.</Text>
      <Text style={styles.label}>Stato</Text><Text style={styles.value}>{labels[state.sos.sos_status]}</Text>
      <Text style={styles.label}>Data e ora SOS</Text><Text style={styles.value}>{new Date(state.sos.event_time).toLocaleString()}</Text>
      <Text style={styles.label}>{state.selection.lastKnown ? 'Ultima posizione conosciuta' : 'Posizione'}</Text>
      <Text style={styles.value}>{position ? `${position.latitude}, ${position.longitude}` : 'Posizione utilizzabile non disponibile.'}</Text>
      {position ? <>
        <Text style={styles.label}>Rilevazione GPS — timestamp dichiarato</Text>
        <Text style={styles.value}>{position.observedAt ? new Date(position.observedAt).toLocaleString() : 'Non disponibile'}</Text>
        <Text style={styles.notice}>{describePositionAge(position.observedAt, state.refreshedAt ?? Date.now())}</Text>
        <Text style={styles.label}>Accuratezza GPS</Text><Text style={styles.value}>{position.accuracy === null ? 'Non disponibile' : `Circa ±${Math.round(position.accuracy)} m`}</Text>
      </> : null}
      {state.selection.issue ? <Text style={styles.notice}>{state.selection.issue === 'future'
        ? 'Timestamp futuro anomalo: aggiornamento non utilizzato.' : state.selection.issue === 'unchanged'
          ? 'Nessuna nuova rilevazione GPS: è mostrata l’ultima posizione conosciuta.'
          : 'Aggiornamento assente, non valido o fuori ordine: non è una nuova posizione.'}</Text> : null}
      {state.selection.issue === 'future' && state.sos.location_updated_at ? <Text style={styles.value}>Timestamp anomalo ricevuto: {new Date(state.sos.location_updated_at).toLocaleString()}</Text> : null}
      <Text style={styles.label}>Ultima verifica della schermata</Text><Text style={styles.value}>{state.refreshedAt ? new Date(state.refreshedAt).toLocaleString() : 'Non disponibile'}</Text>
      <Text style={styles.notice}>L’ora di ricezione della posizione sul server non è disponibile. La verifica della schermata non è una nuova rilevazione GPS.</Text>
      <Text style={styles.label}>Riferimento evento</Text><Text style={styles.value}>{state.sos.sos_id.slice(0, 8).toUpperCase()}</Text>
      {position ? <><Pressable accessibilityRole="button" style={styles.primary} onPress={() => void openNavigator()}><Text style={styles.buttonText}>Apri nel navigatore</Text></Pressable>
        <Text style={styles.notice}>Apre una posizione esterna: la mappa già aperta non segue automaticamente i nuovi aggiornamenti SOS.</Text>
        <Text style={styles.notice}>La mappa interna usa Google Maps: il provider può conoscere l’area visualizzata. Si carica solo se la apri.</Text>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={openMap}><Text style={styles.link}>Apri mappa Live SOS</Text></Pressable></> : null}
      {state.sos.sos_status === 'open' ? <Pressable accessibilityRole="button" style={styles.primary} onPress={() => { if (currentState()) void controller.current?.accept(); }}><Text style={styles.buttonText}>Prendi in carico SOS</Text></Pressable> : null}
      {state.lifecycle?.accepted_by_me ? <Text style={styles.notice}>Hai preso in carico questo SOS.</Text> : null}
      <ReceivedEmergencyInformation key={`${userId}:${sosId}`} sosId={state.sos.sos_id} snapshot={state.sos} />
      <ReceivedPersonalSafetyInformation key={`private:${userId}:${sosId}`} sosId={state.sos.sos_id} snapshot={state.sos} />
    </View> : null}
    {showMap ? <ReceivedSOSMap key={scope} authorized={state.kind === 'active'}
      selection={state.selection} verifiedAt={state.refreshedAt} /> : null}
    {navigationError ? <Text style={styles.notice}>Impossibile completare la navigazione. Riprova.</Text> : null}
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={goBack}><Text style={styles.link}>Indietro</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f9fb' }, container: { flexGrow: 1, padding: 20 },
  title: { color: '#b71c1c', fontSize: 30, fontWeight: '900', marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 18 },
  name: { color: '#11181c', fontSize: 22, fontWeight: '900' },
  label: { color: '#52616b', fontSize: 13, fontWeight: '700', marginTop: 12 },
  value: { color: '#11181c', fontSize: 16, marginTop: 3 },
  notice: { color: '#52616b', fontSize: 15, lineHeight: 22, marginTop: 8 },
  primary: { backgroundColor: '#b71c1c', minHeight: 48, borderRadius: 6, padding: 14, marginTop: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  secondary: { minHeight: 48, padding: 14, marginTop: 14 }, link: { color: '#0a7ea4', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
