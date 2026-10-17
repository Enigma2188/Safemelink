import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { ReceivedEmergencyProfileRequest, type EmergencyInformation } from '@/services/ReceivedEmergencyProfile';

export function ReceivedEmergencyInformation({ sosId, snapshot }: { sosId: string; snapshot: object }) {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [data, setData] = useState<{ owner: string; sosId: string; snapshot: object; fields: EmergencyInformation } | null>(null);
  const context = useRef({ userId, sosId, snapshot, allowed: false });
  const allowed = Platform.OS === 'android' && !!userId && !isInitializing && focused && foreground;
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
    const request = new ReceivedEmergencyProfileRequest(fields => {
      if (current()) setData(fields.length ? { owner: userId, sosId, snapshot, fields } : null);
    });
    void request.load(sosId, current);
    return () => { disposed = true; request.clear(); };
  }, [allowed, userId, sosId, snapshot]);

  // Render-time identity guard hides old data before passive effect cleanup.
  if (!allowed || !data || data.owner !== userId || data.sosId !== sosId || data.snapshot !== snapshot) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>INFORMAZIONI DI EMERGENZA</Text>
    <Text style={styles.notice}>Informazioni dichiarate dall&apos;utente</Text>
    {data.fields.map(field => <View key={field.label}>
      <Text style={styles.label}>{field.label}</Text>
      <Text style={styles.value}>{field.value}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#dce3e8' },
  heading: { color: '#11181c', fontSize: 17, fontWeight: '800' },
  notice: { color: '#52616b', fontSize: 14, marginTop: 4 },
  label: { color: '#52616b', fontSize: 13, fontWeight: '700', marginTop: 12 },
  value: { color: '#11181c', fontSize: 16, marginTop: 3, flexShrink: 1 },
});
