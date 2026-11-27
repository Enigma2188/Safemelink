import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { ReceivedEmergencyProfileRequest, type EmergencyInformationResult } from '@/services/ReceivedEmergencyProfile';

export function ReceivedEmergencyInformation({ sosId, snapshot }: { sosId: string; snapshot: object }) {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [data, setData] = useState<{ owner: string; sosId: string; snapshot: object; result: EmergencyInformationResult } | null>(null);
  const [retry, setRetry] = useState(0);
  const context = useRef({ userId, sosId, snapshot, allowed: false });
  const allowed = !!userId && !isInitializing && focused && foreground;
  context.current = { userId, sosId, snapshot, allowed };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { context.current.allowed = false; setData(null); }
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let disposed = false;
    setData(null);
    if (!allowed || !userId) return;
    const current = () => !disposed && context.current.allowed && context.current.userId === userId &&
      context.current.sosId === sosId && context.current.snapshot === snapshot;
    const request = new ReceivedEmergencyProfileRequest(result => {
      if (current()) setData({ owner: userId, sosId, snapshot, result });
    });
    void request.load(sosId, current);
    return () => { disposed = true; request.clear(); };
  }, [allowed, userId, sosId, snapshot, retry]);

  // Render-time identity guard hides old data before passive effect cleanup.
  if (!allowed || !data || data.owner !== userId || data.sosId !== sosId || data.snapshot !== snapshot) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>INFORMAZIONI DI EMERGENZA</Text>
    {data.result.kind === 'available' ? <Text style={styles.notice}>Informazioni dichiarate dall&apos;utente, non verificate da SafeMeLink.</Text> : null}
    {data.result.kind === 'loading' ? <Text style={styles.notice}>Verifica delle informazioni condivise in corso…</Text> : null}
    {data.result.kind === 'empty' ? <Text style={styles.notice}>Nessuna informazione sanitaria disponibile per questo SOS. Il profilo potrebbe non essere compilato, condiviso o accessibile a questo account.</Text> : null}
    {data.result.kind === 'error' ? <>
      <Text style={styles.notice}>Non è stato possibile verificare le informazioni sanitarie. Non considerarle disponibili finché la verifica non riesce.</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.retry}>
        <Text style={styles.retryText}>Riprova verifica profilo</Text>
      </Pressable>
    </> : null}
    {data.result.fields.map(field => <View key={field.label}>
      <Text style={styles.label}>{field.label}</Text>
      <Text style={styles.value}>{field.value}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#dce3e8' },
  heading: { color: '#11181c', fontSize: 17, fontWeight: '800' },
  notice: { color: '#52616b', fontSize: 14, marginTop: 4 },
  retry: { minHeight: 48, justifyContent: 'center', marginTop: 8 },
  retryText: { color: '#0a7ea4', fontSize: 15, fontWeight: '700' },
  label: { color: '#52616b', fontSize: 13, fontWeight: '700', marginTop: 12 },
  value: { color: '#11181c', fontSize: 16, marginTop: 3, flexShrink: 1 },
});
