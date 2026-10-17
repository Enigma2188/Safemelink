import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { describeICEPrivacy, ICEPrivacyService, type ICEPrivacyStatus } from '@/services/ICEPrivacyService';
export function ICEPrivacyPanel({ revision, disabled, onBusyChange, onReloadForms, canRevoke }: {
  revision: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onReloadForms: () => void;
  canRevoke?: () => boolean;
}) {
  const { session, isInitializing } = useAuth(); const owner = session?.user.id;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const allowed = Platform.OS === 'android' && !!owner && !isInitializing && focused && foreground;
  const context = useRef({ owner, allowed, revision }); context.current = { owner, allowed, revision };
  const epoch = useRef(0), pending = useRef(false);
  const [record, setRecord] = useState<{ status: ICEPrivacyStatus; revision: string } | null>(null);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [reload, setReload] = useState(0);
  const current = (token: number, expected: string, version: string) => epoch.current === token && context.current.allowed &&
    context.current.owner === expected && context.current.revision === version;
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { context.current.allowed = false; epoch.current++; setRecord(null); }
      setForeground(state === 'active');
    }); return () => listener.remove();
  }, []);
  useEffect(() => {
    const guard = epoch; const token = ++guard.current;
    setRecord(null); setMessage(previous => previous.startsWith('REVOCA NON CONFERMATA') ? previous : ''); setChecking(false);
    if (allowed && owner && !disabled) {
      setChecking(true);
      void ICEPrivacyService.status(owner).then(status => {
        if (current(token, owner, revision)) setRecord({ status, revision });
      }).catch(() => {
        if (current(token, owner, revision)) setMessage('STATO ICE NON VERIFICATO. Servizio privacy non disponibile o verifica fallita; nessuna revoca confermata.');
      }).finally(() => { if (current(token, owner, revision)) setChecking(false); });
    }
    return () => { guard.current++; };
    // current reads only live refs; identity/version are the explicit dependencies.
  }, [allowed, owner, revision, reload, disabled]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  if (!allowed) return null;
  const status = !disabled && record?.revision === revision && record.status.owner_id === owner ? record.status : null;
  const revoke = () => {
    if (!owner || !status || disabled || checking || pending.current || canRevoke?.() === false) return;
    const token = epoch.current;
    Alert.alert('Disattiva tutte le condivisioni ICE', 'Revoca i tre consensi senza cancellare nome, numero o testo. I dati avanzati non salvati verranno ricaricati. '
      + (status.ice_blocked !== undefined ? 'Il blocco server richiederà un nuovo consenso esplicito per riattivare ICE. ' : 'Senza protezione persistente verificata, le vecchie APK possono riattivare il consenso legacy. ')
      + 'I dati già visti o copiati non possono essere ritirati.', [
      { text: 'Annulla', style: 'cancel' }, { text: 'Disattiva', onPress: () => {
        if (!current(token, owner, revision) || pending.current || canRevoke?.() === false) return;
        pending.current = true; onBusyChange(true); setRecord(null); setMessage('Revoca in verifica…');
        void ICEPrivacyService.revoke(owner).then(result => {
          if (!current(token, owner, revision)) return;
          setRecord({ status: result, revision });
          setMessage(result.ice_blocked === true ? 'Revoca persistente confermata dal server al momento indicato. La riattivazione richiede il nuovo consenso esplicito.'
            : 'Revoca dei tre consensi confermata dal server al momento indicato. Non impedisce nuove attivazioni da altri client.');
          onReloadForms();
        }).catch(() => {
          if (current(token, owner, revision)) {
            setMessage('REVOCA NON CONFERMATA. Verifica lo stato sul server; non presumere che il numero sia nascosto.');
            onReloadForms(); // Read-only reload on uncertain completion too; never a success signal.
          }
        }).finally(() => { pending.current = false; onBusyChange(false); });
      } },
    ]);
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Privacy ICE — verifica congiunta</Text>
    <Text accessibilityLiveRegion="polite" style={styles.copy}>{status ? describeICEPrivacy(status) : 'Stato non verificato o operazione in corso: nessuna garanzia di riservatezza.'}</Text>
    {status ? <><Text style={styles.copy}>Ultima verifica server: {new Date(status.verified_at).toLocaleString()}</Text>
      <Text style={styles.copy}>ICE legacy: {status.legacy_shared ? 'ON' : 'OFF'} · ICE strutturato: {status.structured_shared ? 'ON' : 'OFF'} · Numero strutturato: {status.phone_shared ? 'ON' : 'OFF'}</Text>
      {status.legacy_text_present ? <Text style={styles.warning}>Il testo ICE precedente può contenere numeri o altre informazioni personali. Non li analizziamo né estraiamo. Se il consenso legacy è ON, l’intero testo resta condivisibile anche con vecchie APK.</Text> : null}
      <Text style={styles.copy}>Informazioni personali di sicurezza: {status.safety_shared ? 'ON' : 'OFF'} — consenso separato, non revocato da questa azione.</Text></> : null}
    {status?.ice_blocked === true ? <Text style={styles.warning}>La riattivazione con nuovo consenso esplicito non è ancora disponibile in questa build. Un tentativo ON nei vecchi moduli verrà rifiutato dal server.</Text> : null}
    <Text style={styles.copy}>Le opzioni modificate nei moduli hanno effetto solo dopo il rispettivo salvataggio. Senza un blocco persistente verificato non escludere riattivazioni da altri client. Anche note mediche o dati già copiati possono contenere il numero.</Text>
    {checking ? <Text style={styles.copy}>Verifica in corso…</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={!status || disabled || checking || pending.current} style={styles.button} onPress={revoke}><Text style={styles.buttonText}>DISATTIVA TUTTE LE CONDIVISIONI ICE</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={disabled || pending.current} style={styles.button} onPress={() => { setMessage(''); setReload(v => v + 1); }}><Text style={styles.buttonText}>Verifica stato ICE sul server</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: '#fff', padding: 16, marginTop: 16, borderRadius: 8 }, title: { color: '#11181c', fontSize: 19, fontWeight: '800' },
  copy: { color: '#52616b', fontSize: 14, lineHeight: 21, marginTop: 8 }, warning: { color: '#7a3d00', fontSize: 14, lineHeight: 21, marginTop: 8 },
  button: { minHeight: 48, backgroundColor: '#0a7ea4', padding: 14, marginTop: 12, borderRadius: 6 }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' } });
