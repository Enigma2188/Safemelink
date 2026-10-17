import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeForm';
import { EMPTY_PRIVATE_DETAILS, EmergencyPrivateDetailsService, PRIVATE_TEXT_LIMITS, type PrivateDetails, type PrivateTextField } from '@/services/EmergencyPrivateDetails';

const labels: Record<PrivateTextField, string> = { ice_name: 'Nome ICE', ice_relation: 'Relazione', ice_phone: 'Telefono ICE (+prefisso internazionale)',
  stalking: 'Stalking (facoltativo)', domestic_violence: 'Violenza domestica (facoltativo)', other_risk: 'Altra situazione di rischio', instructions: 'Indicazioni personali per chi riceve il SOS' };
export function EmergencyPrivateDetailsForm({ externalBusy = false, onBusyChange }: {
  externalBusy?: boolean; onBusyChange?: (busy: boolean) => void;
} = {}) {
  const { session, isInitializing } = useAuth();
  const owner = session?.user.id;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const allowed = Platform.OS === 'android' && !!owner && !isInitializing && focused && foreground;
  const context = useRef({ owner, allowed }); context.current = { owner, allowed: allowed && !externalBusy };
  const generation = useRef(0);
  const writing = useRef(false);
  const [record, setRecord] = useState<{ owner: string; draft: PrivateDetails } | null>(null);
  const [ownBusy, setBusy] = useState(false);
  const busy = ownBusy || externalBusy;
  const [message, setMessage] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  useEffect(() => { onBusyChange?.(ownBusy); }, [ownBusy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { context.current.allowed = false; generation.current++; setRecord(null); }
      setForeground(state === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    const epoch = generation;
    const revision = ++generation.current;
    setRecord(null); setMessage(''); setBusy(false);
    if (allowed && owner) {
      setBusy(true);
      void EmergencyPrivateDetailsService.load(owner).then(draft => {
        if (revision === generation.current && context.current.allowed && context.current.owner === owner) setRecord({ owner, draft });
      }).catch(() => {
        if (revision === generation.current && context.current.allowed && context.current.owner === owner) setMessage('Sezione non disponibile. Il backend avanzato deve essere installato e verificato; il profilo precedente resta utilizzabile.');
      }).finally(() => { if (revision === generation.current) setBusy(false); });
    }
    return () => { epoch.current++; };
  }, [allowed, owner, reloadVersion]);
  if (!allowed) return null;
  const draft = record?.owner === owner ? record.draft : null;
  const current = (revision: number, expected: string) => generation.current === revision && context.current.allowed && context.current.owner === expected;
  const change = (patch: Partial<PrivateDetails>) => {
    if (!draft || busy || !owner || context.current.owner !== owner || !context.current.allowed) return;
    setRecord({ owner, draft: { ...draft, ...patch } }); setMessage('');
  };
  const save = async () => {
    if (!draft || !owner || busy || writing.current || !current(generation.current, owner)) return;
    writing.current = true;
    const revision = generation.current; setBusy(true); onBusyChange?.(true); setMessage('');
    try {
      const saved = await EmergencyPrivateDetailsService.save(owner, draft);
      if (current(revision, owner)) { setRecord({ owner, draft: saved }); setMessage('Dati privati e consensi salvati.'); }
    } catch (error) {
      if (current(revision, owner)) setMessage(error instanceof Error ? error.message : 'Salvataggio non confermato. Ricarica per verificare.');
    } finally { writing.current = false; if (current(revision, owner)) { setBusy(false); onBusyChange?.(false); } }
  };
  const remove = () => {
    if (!draft || !owner || busy || writing.current) return;
    const revision = generation.current;
    Alert.alert('Cancella dati avanzati', 'Elimina ICE strutturato e informazioni personali di sicurezza. Il profilo legacy non viene cancellato.', [
      { text: 'Annulla', style: 'cancel' }, { text: 'Cancella', style: 'destructive', onPress: () => {
        if (!current(revision, owner) || writing.current) return;
        writing.current = true;
        setBusy(true); onBusyChange?.(true);
        void EmergencyPrivateDetailsService.remove(owner).then(() => {
          if (current(revision, owner)) { setRecord({ owner, draft: { ...EMPTY_PRIVATE_DETAILS } }); setMessage('Dati avanzati cancellati.'); }
        }).catch(() => { if (current(revision, owner)) setMessage('Cancellazione non confermata. Ricarica per verificare.'); })
          .finally(() => { writing.current = false; if (current(revision, owner)) { setBusy(false); onBusyChange?.(false); } });
      } },
    ]);
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>ICE strutturato e sicurezza personale</Text>
    <Text style={styles.copy}>Facoltativo: puoi salvare senza condividere. Informazioni dichiarate dall’utente, non verificate da SafeMeLink. Questa sezione ha un salvataggio separato.</Text>
    <Text style={styles.copy}>Le condivisioni valgono solo durante un SOS attivo, per i contatti fidati collegati. Anche un aggressore potrebbe essere fra loro: controlla i tuoi contatti prima di attivare un consenso. Nessuna condivisione con vicini, NETWORK o community.</Text>
    <Text style={styles.copy}>Il campo ICE precedente resta invariato: se contiene un numero ed è condiviso con il consenso legacy, quel numero resta visibile. Non viene importato o estratto automaticamente qui.</Text>
    {draft ? <>
      {(Object.keys(labels) as PrivateTextField[]).map(field => <View key={field}>
        <Text style={styles.label}>{labels[field]}</Text>
        <KeyboardSafeTextInput accessibilityLabel={labels[field]} value={draft[field]} editable={!busy}
          onChangeText={value => change({ [field]: value })} maxLength={PRIVATE_TEXT_LIMITS[field]}
          multiline={!field.startsWith('ice_')} keyboardType={field === 'ice_phone' ? 'phone-pad' : 'default'}
          placeholder={field === 'instructions' ? 'Es. non telefonarmi; non affrontare la persona' : 'Facoltativo'}
          placeholderTextColor="#687076" style={styles.input} />
      </View>)}
      {(['share_ice', 'share_ice_phone', 'share_safety'] as const).map(field => <View key={field} style={styles.row}>
        <Text style={[styles.copy, styles.flex]}>{field === 'share_ice' ? 'Condividi nome e relazione ICE' : field === 'share_ice_phone'
          ? 'Condividi anche il numero ICE. Il destinatario potrà conoscerlo e aprirlo nel telefono; una chiamata tradizionale non nasconde il numero e può lasciarlo nella cronologia.'
          : 'Condividi le informazioni personali di sicurezza con tutti i contatti fidati autorizzati durante il SOS.'}</Text>
        <Switch accessibilityLabel={field === 'share_ice' ? 'Condividi ICE' : field === 'share_ice_phone' ? 'Condividi numero ICE' : 'Condividi informazioni di sicurezza'}
          value={draft[field]} disabled={busy || (field === 'share_ice_phone' && !draft.share_ice)}
          onValueChange={value => change(field === 'share_ice' && !value ? { share_ice: false, share_ice_phone: false } : { [field]: value })} />
      </View>)}
      <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void save()}><Text style={styles.buttonText}>Salva dati avanzati e consensi</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={remove}><Text style={styles.buttonText}>Cancella dati avanzati</Text></Pressable>
    </> : null}
    {busy ? <Text style={styles.copy}>Verifica in corso…</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => setReloadVersion(v => v + 1)}><Text style={styles.buttonText}>Ricarica dati avanzati dal server</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 16, marginTop: 20, backgroundColor: '#fff', borderRadius: 8 }, title: { fontSize: 19, fontWeight: '800', color: '#11181c' },
  copy: { fontSize: 14, color: '#52616b', lineHeight: 21, marginTop: 8 }, label: { color: '#11181c', fontSize: 16, marginTop: 14 },
  input: { color: '#11181c', backgroundColor: '#f0f3f5', minHeight: 48, padding: 12, marginTop: 6, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 }, flex: { flex: 1, paddingRight: 12 },
  button: { minHeight: 48, padding: 14, marginTop: 12, backgroundColor: '#0a7ea4', borderRadius: 6 }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' } });
