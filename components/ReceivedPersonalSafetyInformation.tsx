import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { EmergencyPrivateDetailsService } from '@/services/EmergencyPrivateDetails';
type Field = { label: string; value: string };
export function ReceivedPersonalSafetyInformation({ sosId, snapshot }: { sosId: string; snapshot: object }) {
  const { session, isInitializing } = useAuth(); const owner = session?.user.id;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [data, setData] = useState<{ owner: string; sosId: string; snapshot: object; fields: Field[] } | null>(null);
  const [message, setMessage] = useState('');
  const context = useRef({ owner, sosId, snapshot, allowed: false });
  const allowed = Platform.OS === 'android' && !!owner && !isInitializing && focused && foreground;
  context.current = { owner, sosId, snapshot, allowed };
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { context.current.allowed = false; generation.current++; setData(null); }
      setForeground(state === 'active');
    }); return () => listener.remove();
  }, []);
  useEffect(() => {
    const epoch = generation;
    const revision = ++generation.current; setData(null); setMessage(''); busy.current = false;
    if (allowed && owner) void EmergencyPrivateDetailsService.received(sosId).then(fields => {
      const c = context.current;
      if (revision === generation.current && c.allowed && c.owner === owner && c.sosId === sosId && c.snapshot === snapshot)
        setData(fields.length ? { owner, sosId, snapshot, fields } : null);
    }).catch(() => { /* Never retain or log protected contents. */ });
    return () => { epoch.current++; };
  }, [allowed, owner, sosId, snapshot]);
  const current = (revision: number) => generation.current === revision && context.current.allowed && context.current.owner === owner &&
    context.current.sosId === sosId && context.current.snapshot === snapshot;
  if (!allowed || !data || data.owner !== owner || data.sosId !== sosId || data.snapshot !== snapshot) return null;
  const phone = data.fields.find(f => f.label === 'Numero ICE autorizzato')?.value;
  const openPhone = () => {
    const revision = generation.current;
    if (!phone || busy.current || !current(revision)) return;
    Alert.alert('Apri numero ICE', 'Il numero sarà visibile nel telefono e può restare nella cronologia. Non viene effettuata una chiamata automatica.', [
      { text: 'Annulla', style: 'cancel' }, { text: 'Apri nel telefono', onPress: () => {
        if (!current(revision) || busy.current) return;
        busy.current = true;
        void (async () => {
          try {
            const verified = await EmergencyPrivateDetailsService.received(sosId);
            if (!current(revision)) return;
            if (!verified.some(f => f.label === 'Numero ICE autorizzato' && f.value === phone)) { setData(null); return; }
            const url = `tel:${phone}`;
            const available = await Linking.canOpenURL(url);
            if (!current(revision)) return;
            if (!available) { setMessage('Telefono non disponibile.'); return; }
            await Linking.openURL(url);
          } catch { if (current(revision)) setMessage('Impossibile aprire il telefono.'); }
          finally { if (current(revision)) busy.current = false; }
        })();
      } },
    ]);
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>INFORMAZIONI PERSONALI DI SICUREZZA</Text>
    <Text style={styles.copy}>Informazioni dichiarate dall’utente</Text>
    {data.fields.map(field => <View key={field.label}><Text style={styles.label}>{field.label}</Text><Text style={styles.copy}>{field.value}</Text></View>)}
    {phone ? <Pressable accessibilityRole="button" style={styles.button} onPress={openPhone}><Text style={styles.buttonText}>Apri numero ICE nel telefono</Text></Pressable> : null}
    {message ? <Text style={styles.copy}>{message}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ card: { paddingTop: 16, marginTop: 16, borderTopWidth: 1, borderTopColor: '#dce3e8' },
  title: { color: '#11181c', fontSize: 17, fontWeight: '800' }, copy: { color: '#52616b', fontSize: 15, marginTop: 6, lineHeight: 22 },
  label: { color: '#11181c', fontSize: 15, fontWeight: '700', marginTop: 12 }, button: { minHeight: 48, padding: 14, marginTop: 12, backgroundColor: '#0a7ea4', borderRadius: 6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' } });
