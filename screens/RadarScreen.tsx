import { Ionicons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import {
  type SOSNetworkAvailabilityStatus,
  useSOSNetworkPresence,
} from '@/components/SOSNetworkPresenceProvider';

const statusCopy: Record<SOSNetworkAvailabilityStatus, string> = {
  loading: 'Verifica della partecipazione in corso…',
  off: 'Non hai ancora aderito alla Rete SafeMeLink.',
  available: 'La tua partecipazione alla rete è attiva.',
  foreground_permission_required:
    'Autorizza la posizione per renderti disponibile alle emergenze nelle vicinanze.',
  background_permission_required:
    'La rete resta attiva mentre usi SafeMeLink. Autorizza la posizione sempre per la disponibilità in background.',
  notification_permission_required:
    'La rete è attiva. Autorizza le notifiche per ricevere richieste di aiuto.',
  location_services_required:
    'Attiva la posizione del dispositivo per aggiornare la tua disponibilità.',
  offline: 'La partecipazione verrà verificata appena torna la connessione.',
  error: 'La disponibilità della rete non può essere verificata in questo momento.',
};

export function RadarScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const network = useSOSNetworkPresence();
  const isBusy = network.isLoading || network.isSaving;

  const joinNetwork = async () => {
    try {
      await network.setEnabled(true);
    } catch (error: unknown) {
      Alert.alert(
        'Rete SafeMeLink',
        error instanceof Error
          ? error.message
          : 'Impossibile completare ora l’adesione. Riprova.',
      );
    }
  };

  const leaveNetwork = () => {
    Alert.alert(
      'Lasciare la Rete SafeMeLink?',
      'Non risulterai più disponibile per ricevere richieste SOS dalle persone nelle vicinanze.',
      [
        { text: 'Resta nella rete', style: 'cancel' },
        {
          text: 'Lascia la rete',
          style: 'destructive',
          onPress: () => {
            void network.setEnabled(false).catch((error: unknown) => {
              Alert.alert(
                'Rete SafeMeLink',
                error instanceof Error
                  ? error.message
                  : 'Impossibile aggiornare ora la partecipazione. Riprova.',
              );
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Torna alla schermata precedente"
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          style={styles.backButton}>
          <Ionicons color="#F7FAFF" name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Rete SafeMeLink</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={[styles.statusIcon, network.enabled && styles.statusIconActive]}>
            <Ionicons
              color={network.enabled ? '#35E487' : '#A8B5D1'}
              name="people-circle-outline"
              size={54}
            />
          </View>
          <Text style={styles.title}>
            {network.enabled ? 'Rete SafeMeLink attiva' : 'Entra nella Rete SafeMeLink'}
          </Text>
          <Text style={styles.description}>
            In caso di emergenza SafeMeLink può cercare automaticamente persone disponibili
            nelle vicinanze. La disponibilità di aiuto non è garantita.
          </Text>
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
            style={[styles.statusCard, network.enabled && styles.statusCardActive]}>
            <View style={[styles.statusDot, network.enabled && styles.statusDotActive]} />
            <Text style={styles.statusText}>
              {network.message ?? statusCopy[network.status]}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Una rete anonima e protetta</Text>
          <View style={styles.infoRow}>
            <Ionicons color="#45B7FF" name="eye-off-outline" size={22} />
            <Text style={styles.infoText}>
              Fuori da un’emergenza non mostriamo persone, nickname, distanze o posizioni.
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons color="#A78BFA" name="shield-checkmark-outline" size={22} />
            <Text style={styles.infoText}>
              La tua posizione di rete viene usata soltanto dal sistema per valutare richieste SOS
              realmente vicine.
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons color="#FF748C" name="location-outline" size={22} />
            <Text style={styles.infoText}>
              Durante un SOS, solo i destinatari autorizzati possono aprire la posizione reale
              dell’emergenza.
            </Text>
          </View>
        </View>

        {!session?.user.id ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeText}>Accedi per partecipare alla Rete SafeMeLink.</Text>
            <Pressable
              accessibilityLabel="Accedi a SafeMeLink"
              accessibilityRole="button"
              onPress={() => router.push('/login' as Href)}
              style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>ACCEDI</Text>
            </Pressable>
          </View>
        ) : network.enabled ? (
          <View style={styles.actionsSection}>
            <Text style={styles.persistenceText}>
              La partecipazione resta attiva dopo la chiusura o il riavvio dell’app, finché non la
              revochi esplicitamente.
            </Text>
            <Pressable
              accessibilityLabel="Lascia la Rete SafeMeLink"
              accessibilityRole="button"
              disabled={isBusy}
              onPress={leaveNetwork}
              style={[styles.secondaryButton, isBusy && styles.buttonDisabled]}>
              <Text style={styles.secondaryButtonText}>
                {network.isSaving ? 'AGGIORNAMENTO…' : 'LASCIA LA RETE'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.actionsSection}>
            <Text style={styles.consentText}>
              Partecipando consenti a SafeMeLink di mantenere una presenza tecnica protetta per
              valutare le emergenze nelle vicinanze. Nessun utente può vedere dove ti trovi.
            </Text>
            <Pressable
              accessibilityLabel="Partecipa alla Rete SafeMeLink"
              accessibilityRole="button"
              disabled={isBusy}
              onPress={() => void joinNetwork()}
              style={[styles.primaryButton, isBusy && styles.buttonDisabled]}>
              <Text style={styles.primaryButtonText}>
                {isBusy ? 'VERIFICA IN CORSO…' : 'PARTECIPA ALLA RETE'}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionsSection: { gap: 14 },
  backButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  buttonDisabled: { opacity: 0.55 },
  consentText: { color: '#A8B5D1', fontSize: 14, lineHeight: 21 },
  content: { gap: 18, padding: 18, paddingBottom: 40 },
  description: { color: '#A8B5D1', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  headerSpacer: { width: 44 },
  headerTitle: { color: '#F7FAFF', flex: 1, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  heroCard: { alignItems: 'center', backgroundColor: 'rgba(15, 27, 51, 0.82)', borderColor: 'rgba(69, 183, 255, 0.24)', borderRadius: 22, borderWidth: 1, gap: 13, padding: 22 },
  infoRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  infoText: { color: '#C7D2E8', flex: 1, fontSize: 14, lineHeight: 21 },
  noticeCard: { gap: 14 },
  noticeText: { color: '#DDE7FA', fontSize: 15, textAlign: 'center' },
  persistenceText: { color: '#A8B5D1', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: '#397FEF', borderRadius: 14, minHeight: 48, justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  screen: { backgroundColor: '#050816', flex: 1 },
  secondaryButton: { alignItems: 'center', borderColor: 'rgba(255, 116, 140, 0.55)', borderRadius: 14, borderWidth: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 18 },
  secondaryButtonText: { color: '#FF9AAC', fontSize: 13, fontWeight: '900' },
  section: { backgroundColor: 'rgba(12, 22, 43, 0.72)', borderColor: 'rgba(120, 104, 255, 0.22)', borderRadius: 18, borderWidth: 1, gap: 16, padding: 18 },
  sectionTitle: { color: '#F7FAFF', fontSize: 17, fontWeight: '800' },
  statusCard: { alignItems: 'center', backgroundColor: 'rgba(113, 128, 163, 0.12)', borderRadius: 12, flexDirection: 'row', gap: 10, paddingHorizontal: 13, paddingVertical: 11, width: '100%' },
  statusCardActive: { backgroundColor: 'rgba(53, 228, 135, 0.10)' },
  statusDot: { backgroundColor: '#7180A3', borderRadius: 5, height: 10, width: 10 },
  statusDotActive: { backgroundColor: '#35E487' },
  statusIcon: { alignItems: 'center', backgroundColor: 'rgba(168, 181, 209, 0.08)', borderRadius: 38, height: 76, justifyContent: 'center', width: 76 },
  statusIconActive: { backgroundColor: 'rgba(53, 228, 135, 0.10)' },
  statusText: { color: '#DDE7FA', flex: 1, fontSize: 13, lineHeight: 19 },
  title: { color: '#F7FAFF', fontSize: 24, fontWeight: '900', textAlign: 'center' },
});
