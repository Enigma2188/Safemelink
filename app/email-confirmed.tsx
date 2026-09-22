import * as Linking from 'expo-linking';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { verifyEmailConfirmation, type EmailConfirmationResult } from '@/backend/auth/EmailConfirmation';

const messages: Record<EmailConfirmationResult, string> = {
  verified: 'Email verificata correttamente. Puoi tornare a SafeMeLink e accedere con la tua password.',
  invalid: 'Questo link non conferma la verifica dell’email. Potrebbe essere scaduto o già utilizzato. Prova ad accedere a SafeMeLink.',
  unavailable: 'Non possiamo controllare la conferma adesso. Controlla la connessione e prova ad accedere a SafeMeLink.',
  login_required: 'Se hai completato la conferma dell’email, puoi ora accedere a SafeMeLink. La verifica sarà controllata dal server.',
};

export default function EmailConfirmedScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const [result, setResult] = useState<EmailConfirmationResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void verifyEmailConfirmation(url).then((value) => { if (!cancelled) setResult(value); });
    return () => { cancelled = true; };
  }, [url]);
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Conferma email</Text>
      {result ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{messages[result]}</Text> : <ActivityIndicator color="#FFFFFF" />}
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/login' as Href)}>
        <Text style={styles.copy}>TORNA A SAFEMELINK</Text>
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#080D20' },
  content: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 24 },
  title: { fontSize: 26, fontWeight: '700', color: '#FFFFFF' },
  copy: { color: '#FFFFFF', fontSize: 17, lineHeight: 25 },
  button: { backgroundColor: '#5142A3', padding: 18, borderRadius: 14, minHeight: 56 },
});
