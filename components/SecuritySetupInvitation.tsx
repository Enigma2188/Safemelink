import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { readSecuritySetup } from '@/services/SecuritySetup';

const KEY = 'safemelink.security-setup.invitation.v1';
// A passive, dismissible invitation, never a redirect over an emergency screen.
export function SecuritySetupInvitation() {
  const { session } = useAuth();
  const router = useRouter();
  const segments = useSegments().map(String);
  const [visible, setVisible] = useState(false);
  const home = String(segments[0]) === '(tabs)' && (!segments[1] || String(segments[1]) === 'index');
  useEffect(() => {
    let active = true;
    setVisible(false);
    if (Platform.OS !== 'android' || !session?.user.id || !home) return;
    void (async () => {
      if (await AsyncStorage.getItem(KEY)) return;
      const state = await readSecuritySetup();
      const configured = [state.notifications, state.channel, state.location, state.gps, state.alarms].every(s => s === 'ready');
      if (active) setVisible(!configured);
    })().catch(() => { /* Manual configuration remains available in Settings. */ });
    return () => { active = false; };
  }, [session?.user.id, home]);
  const dismiss = () => {
    setVisible(false);
    void AsyncStorage.setItem(KEY, 'seen').catch(() => {});
  };
  if (!visible || !home || Platform.OS !== 'android') return null;
  return <View style={{ backgroundColor: '#17213A', padding: 12 }}>
    <Pressable accessibilityRole="button" onPress={() => { dismiss(); router.push('/security-setup' as Href); }}>
      <Text style={{ color: '#FFFFFF', fontSize: 17, paddingVertical: 10 }}>Configura la tua sicurezza</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={dismiss}><Text style={{ color: '#A7D8FF', paddingVertical: 10 }}>Non ora — disponibile nelle Impostazioni</Text></Pressable>
  </View>;
}
