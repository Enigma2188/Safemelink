import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { useOnboarding } from '@/components/OnboardingProvider';

const slides = [
  {
    icon: 'link-outline' as const,
    eyebrow: 'SAFE MELINK',
    title: 'Una rete silenziosa, pronta ad aiutarti.',
    body: 'Strumenti di prevenzione, contatti fidati e una rete di persone disponibili quando conta davvero.',
  },
  {
    icon: 'alert-circle-outline' as const,
    eyebrow: 'SOS',
    title: 'Aiuto con un solo gesto.',
    body: 'Il pulsante avvia un breve countdown. SafeMeLink acquisisce la posizione e prova ad avvisare i destinatari selezionati in modo sicuro dal sistema.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    eyebrow: 'PROTEZIONE',
    title: 'Sicurezza prima dell’emergenza.',
    body: 'Checkpoint verifica che tu stia bene, Torno a casa segue la durata prevista del tragitto e su Android la Protezione vocale può avviare il normale countdown SOS.',
  },
  {
    icon: 'people-outline' as const,
    eyebrow: 'COMMUNITY',
    title: 'Tre reti, scopi diversi.',
    body: 'Rete SafeMeLink riguarda la disponibilità agli SOS vicini. NETWORK raccoglie segnalazioni territoriali. Rete di quartiere è uno spazio privato accessibile tramite invito.',
  },
  {
    icon: 'lock-closed-outline' as const,
    eyebrow: 'PRIVACY E PERMESSI',
    title: 'Controllo chiaro dei tuoi dati.',
    body: 'I permessi vengono richiesti quando usi una funzione. NETWORK mostra nickname e posizione approssimata; notifiche e posizione restano controllabili dalle impostazioni del dispositivo.',
  },
] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding } = useOnboarding();
  const [slideIndex, setSlideIndex] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState('');
  const slide = slides[slideIndex];
  const isLastSlide = slideIndex === slides.length - 1;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (slideIndex === 0) return false;
      setSlideIndex((current) => Math.max(0, current - 1));
      return true;
    });

    return () => subscription.remove();
  }, [slideIndex]);

  const finish = async () => {
    if (isCompleting) return;
    setIsCompleting(true);
    setError('');

    try {
      await completeOnboarding();
      router.replace('/');
    } catch {
      setError('Non riesco a salvare la scelta. Riprova.');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>SafeMeLink</Text>
        {!isLastSlide ? (
          <Pressable accessibilityRole="button" disabled={isCompleting} hitSlop={10} onPress={() => void finish()}>
            <Text style={styles.skip}>SALTA</Text>
          </Pressable>
        ) : <View style={styles.topPlaceholder} />}
      </View>

      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons color="#53C4FF" name={slide.icon} size={48} />
        </View>
        <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>

      <View style={styles.footer}>
        <View accessibilityLabel={`Pagina ${slideIndex + 1} di ${slides.length}`} style={styles.dots}>
          {slides.map((item, index) => (
            <View key={item.eyebrow} style={[styles.dot, index === slideIndex && styles.dotActive]} />
          ))}
        </View>
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          {slideIndex > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setSlideIndex((current) => current - 1)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>INDIETRO</Text>
            </Pressable>
          ) : <View style={styles.actionPlaceholder} />}
          <Pressable
            accessibilityRole="button"
            disabled={isCompleting}
            onPress={() => isLastSlide ? void finish() : setSlideIndex((current) => current + 1)}
            style={[styles.primaryButton, isCompleting && styles.disabled]}>
            <Text style={styles.primaryButtonText}>
              {isCompleting ? 'ATTENDI…' : isLastSlide ? 'ENTRA IN SAFEMELINK' : 'AVANTI'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionPlaceholder: { flex: 1 },
  actions: { flexDirection: 'row', gap: 12 },
  body: { color: '#B6C4DE', fontSize: 17, lineHeight: 26, maxWidth: 520, textAlign: 'center' },
  brand: { color: '#F7FAFF', fontSize: 20, fontWeight: '800' },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  disabled: { opacity: 0.55 },
  dot: { backgroundColor: '#33415F', borderRadius: 4, height: 7, width: 7 },
  dotActive: { backgroundColor: '#45B7FF', width: 24 },
  dots: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  error: { color: '#FF9AAE', fontSize: 14, textAlign: 'center' },
  eyebrow: { color: '#53C4FF', fontSize: 13, fontWeight: '900', letterSpacing: 1.5, marginBottom: 14 },
  footer: { gap: 20, padding: 24 },
  iconWrap: { alignItems: 'center', backgroundColor: 'rgba(38, 145, 255, 0.12)', borderColor: 'rgba(83, 196, 255, 0.3)', borderRadius: 42, borderWidth: 1, height: 84, justifyContent: 'center', marginBottom: 28, width: 84 },
  primaryButton: { alignItems: 'center', backgroundColor: '#168FE5', borderRadius: 14, flex: 1.6, justifyContent: 'center', minHeight: 52, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  screen: { backgroundColor: '#050816', flex: 1 },
  secondaryButton: { alignItems: 'center', borderColor: '#354665', borderRadius: 14, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#C9D7EE', fontSize: 14, fontWeight: '800' },
  skip: { color: '#8FCFFF', fontSize: 14, fontWeight: '800' },
  title: { color: '#F7FAFF', fontSize: 30, fontWeight: '900', lineHeight: 37, marginBottom: 18, maxWidth: 560, textAlign: 'center' },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 64, paddingHorizontal: 24 },
  topPlaceholder: { width: 48 },
});
