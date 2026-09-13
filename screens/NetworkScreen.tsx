import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import type { NetworkConfirmationKind, NetworkReportCategory } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { RemoteRequestTimeoutError } from '@/backend/remoteRequest';
import {
  LocationPermissionError,
  LocationTimeoutError,
  LocationUnavailableError,
} from '@/services/LocationService';
import {
  getNetworkCategoryLabel,
  NETWORK_CATEGORIES,
  type NetworkFeedReport,
  type NetworkOnboardingStatus,
} from '@/services/NetworkModels';
import { NetworkService } from '@/services/NetworkService';

const friendlyError = (fallback: string) => (error: unknown) => {
  if (error instanceof LocationPermissionError) {
    return 'Autorizza SafeMeLink ad accedere alla posizione, poi riprova.';
  }
  if (error instanceof LocationUnavailableError) {
    return 'Attiva la posizione sul dispositivo, poi riprova.';
  }
  if (error instanceof LocationTimeoutError) {
    return 'La posizione non è arrivata in tempo. Controlla il GPS e riprova.';
  }
  if (error instanceof RemoteRequestTimeoutError) {
    return 'Il servizio NETWORK non risponde. Riprova tra poco.';
  }
  if (error instanceof BackendError) {
    if (error.category === 'backend_unavailable') {
      return 'Il servizio NETWORK deve essere aggiornato. Riprova dopo l’aggiornamento.';
    }
    if (error.category === 'unauthenticated') return 'Sessione scaduta. Accedi di nuovo.';
    if (error.category === 'forbidden') return 'Completa i requisiti NETWORK prima di continuare.';
    if (error.category === 'network') return 'Connessione non disponibile. Riprova tra poco.';
  }
  return fallback;
};

const formatDistance = (meters: number) => meters >= 1_000
  ? `entro ${(meters / 1_000).toFixed(1).replace('.0', '')} km`
  : `entro ${Math.max(50, Math.round(meters / 50) * 50)} m`;

export function NetworkScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const mountedRef = useRef(true);
  const accountRef = useRef(userId);
  accountRef.current = userId;
  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const actionRef = useRef(false);
  const [onboarding, setOnboarding] = useState<NetworkOnboardingStatus | null>(null);
  const [reports, setReports] = useState<NetworkFeedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [category, setCategory] = useState<NetworkReportCategory>('SUSPICIOUS_ACTIVITY');
  const [description, setDescription] = useState('');
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  const isCurrent = useCallback((expectedUser: string, generation: number, request?: number) => (
    mountedRef.current
    && accountRef.current === expectedUser
    && generationRef.current === generation
    && (request === undefined || requestRef.current === request)
  ), []);

  const load = useCallback(async (showSpinner = true) => {
    const expectedUser = userId;
    const generation = generationRef.current;
    const request = ++requestRef.current;
    if (!expectedUser) {
      setOnboarding(null);
      setReports([]);
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const status = await NetworkService.getMyNetworkOnboardingStatus();
      if (!isCurrent(expectedUser, generation, request)) return;
      setOnboarding(status);
      if (!status.eligible || status.restrictionStatus === 'FULL_NETWORK_BLOCKED') {
        setReports([]);
        return;
      }
      const feed = await NetworkService.loadFeed();
      if (isCurrent(expectedUser, generation, request)) setReports(feed.reports);
    } catch (error) {
      if (isCurrent(expectedUser, generation, request)) {
        setMessage(friendlyError('Impossibile caricare NETWORK. Riprova tra poco.')(error));
      }
    } finally {
      if (isCurrent(expectedUser, generation, request)) setLoading(false);
    }
  }, [isCurrent, userId]);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    requestRef.current += 1;
    actionRef.current = false;
    setOnboarding(null);
    setReports([]);
    setMessage(null);
    setPublishMessage(null);
    setBusy(false);
    void load();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      requestRef.current += 1;
      actionRef.current = false;
    };
  }, [load]);

  const runAction = useCallback(async (
    operation: () => Promise<unknown>,
    success: string,
    onSuccess?: () => void,
    onFeedback?: (feedback: string) => void,
  ) => {
    if (actionRef.current || !userId) return;
    const expectedUser = userId;
    const generation = generationRef.current;
    actionRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      if (!isCurrent(expectedUser, generation)) return;
      onSuccess?.();
      (onFeedback ?? setMessage)(success);
      await load(false);
    } catch (error) {
      if (isCurrent(expectedUser, generation)) {
        (onFeedback ?? setMessage)(
          friendlyError('Operazione non riuscita. Riprova tra poco.')(error),
        );
      }
    } finally {
      if (isCurrent(expectedUser, generation)) {
        actionRef.current = false;
        setBusy(false);
      }
    }
  }, [isCurrent, load, userId]);

  const acceptTerms = () => onboarding && void runAction(
    () => NetworkService.acceptCurrentTerms(onboarding),
    'Condizioni NETWORK accettate.',
  );

  const publish = () => {
    const clean = description.trim();
    if (clean.length < 10 || clean.length > 500) {
      setPublishMessage('Descrivi la situazione usando da 10 a 500 caratteri.');
      return;
    }
    Keyboard.dismiss();
    setPublishMessage(null);
    void runAction(
      () => NetworkService.createReport(category, clean),
      'Segnalazione pubblicata.',
      () => {
        setDescription('');
        setComposerOpen(false);
      },
      setPublishMessage,
    );
  };

  const respond = (reportId: string, kind: NetworkConfirmationKind) => void runAction(
    () => NetworkService.respond(reportId, kind),
    kind === 'CONFIRMED' ? 'Segnalazione confermata.' : 'Indicazione aggiornata.',
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Torna indietro" hitSlop={12} onPress={() => (
          router.canGoBack() ? router.back() : router.replace('/(tabs)')
        )} style={styles.iconButton}>
          <Ionicons color="#F7FAFF" name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>NETWORK</Text>
        <Pressable accessibilityLabel="Aggiorna NETWORK" disabled={busy || loading} hitSlop={12} onPress={() => void load()} style={styles.iconButton}>
          <Ionicons color="#72C8FF" name="refresh" size={22} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#45B7FF" />}>
          <View style={styles.hero}>
            <Ionicons color="#45B7FF" name="shield-checkmark-outline" size={42} />
            <Text style={styles.title}>Sicurezza condivisa, con privacy</Text>
            <Text style={styles.body}>Segnalazioni di sicurezza vicine entro 5 km. La posizione mostrata è sempre approssimativa.</Text>
          </View>

          {message ? (
            <View accessibilityLiveRegion="polite" style={styles.message}>
              <Text style={styles.messageText}>{message}</Text>
              <Pressable accessibilityLabel="Chiudi messaggio" onPress={() => setMessage(null)}><Ionicons color="#D2DDEE" name="close" size={20} /></Pressable>
            </View>
          ) : null}

          {!userId ? (
            <View style={styles.card}><Text style={styles.cardTitle}>Accedi per usare NETWORK</Text><Text style={styles.body}>Le segnalazioni sono riservate agli account verificati.</Text></View>
          ) : null}

          {userId && onboarding && !onboarding.eligible ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Completa il tuo account</Text>
              <Requirement ok={onboarding.emailVerified} text="Email verificata" />
              <Requirement ok={onboarding.nicknamePresent} text="Nickname impostato" />
              <Requirement ok={onboarding.phoneVerified} text="Telefono verificato" />
              <Requirement ok={onboarding.termsAccepted} text="Condizioni NETWORK accettate" />
              {!onboarding.termsAccepted ? <PrimaryButton disabled={busy} label="ACCETTA LE CONDIZIONI NETWORK" onPress={acceptTerms} /> : null}
              <Text style={styles.hint}>Completa gli altri requisiti nel profilo per pubblicare e consultare le segnalazioni.</Text>
            </View>
          ) : null}

          {onboarding?.eligible && onboarding.restrictionStatus === 'FULL_NETWORK_BLOCKED' ? (
            <View style={styles.card}><Text style={styles.cardTitle}>NETWORK non disponibile</Text><Text style={styles.body}>L’accesso alla rete è temporaneamente limitato per questo account.</Text></View>
          ) : null}

          {onboarding?.eligible && onboarding.restrictionStatus !== 'FULL_NETWORK_BLOCKED' ? (
            <>
              <View style={styles.actionRow}>
                <Text style={styles.sectionTitle}>Segnalazioni vicine</Text>
                <PrimaryButton
                  disabled={busy || onboarding.restrictionStatus === 'READ_ONLY' || onboarding.restrictionStatus === 'PUBLISH_BLOCKED'}
                  label={composerOpen ? 'CHIUDI' : 'SEGNALA'}
                  onPress={() => {
                    setPublishMessage(null);
                    setComposerOpen((value) => !value);
                  }}
                  compact
                />
              </View>

              {publishMessage ? (
                <View accessibilityLiveRegion="polite" style={styles.message}>
                  <Text style={styles.messageText}>{publishMessage}</Text>
                  <Pressable accessibilityLabel="Chiudi messaggio pubblicazione" onPress={() => setPublishMessage(null)}>
                    <Ionicons color="#D2DDEE" name="close" size={20} />
                  </Pressable>
                </View>
              ) : null}

              {composerOpen ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Nuova segnalazione</Text>
                  <View style={styles.chips}>{NETWORK_CATEGORIES.map((item) => (
                    <Pressable key={item.value} onPress={() => setCategory(item.value)} style={[styles.chip, category === item.value && styles.chipSelected]}>
                      <Text style={[styles.chipText, category === item.value && styles.chipTextSelected]}>{item.label}</Text>
                    </Pressable>
                  ))}</View>
                  <TextInput
                    accessibilityLabel="Descrizione della segnalazione"
                    maxLength={500}
                    multiline
                    onChangeText={(value) => {
                      setDescription(value);
                      setPublishMessage(null);
                    }}
                    placeholder="Descrivi brevemente la situazione…"
                    placeholderTextColor="#71809B"
                    style={styles.input}
                    value={description}
                  />
                  <Text style={styles.counter}>{description.trim().length}/500</Text>
                  <PrimaryButton disabled={busy} label={busy ? 'PUBBLICAZIONE…' : 'PUBBLICA'} onPress={publish} />
                </View>
              ) : null}

              {!loading && reports.length === 0 ? (
                <View style={styles.card}><Text style={styles.cardTitle}>Nessuna segnalazione vicina</Text><Text style={styles.body}>La zona non presenta segnalazioni attive in questo momento.</Text></View>
              ) : null}

              {reports.map((report) => (
                <View key={report.id} style={styles.card}>
                  <View style={styles.reportHeader}>
                    <Text style={styles.category}>{getNetworkCategoryLabel(report.category)}</Text>
                    <Text style={styles.status}>{report.status === 'ACTIVE' ? 'ATTIVA' : 'RISOLTA'}</Text>
                  </View>
                  <Text style={styles.description}>{report.description}</Text>
                  <Text style={styles.meta}>{report.publicArea} · {formatDistance(report.distanceBucketMeters)}</Text>
                  <Text style={styles.meta}>Segnalata da {report.authorNickname}</Text>
                  <View style={styles.reportActions}>
                    <SecondaryButton disabled={busy || report.status !== 'ACTIVE' || onboarding.restrictionStatus === 'READ_ONLY' || onboarding.restrictionStatus === 'INTERACTIONS_BLOCKED'} label={`CONFERMA · ${report.confirmationCount}`} onPress={() => respond(report.id, 'CONFIRMED')} selected={report.myConfirmation === 'CONFIRMED'} />
                    <SecondaryButton disabled={busy || report.status !== 'ACTIVE' || onboarding.restrictionStatus === 'READ_ONLY' || onboarding.restrictionStatus === 'INTERACTIONS_BLOCKED'} label="NON PIÙ PRESENTE" onPress={() => respond(report.id, 'NO_LONGER_PRESENT')} selected={report.myConfirmation === 'NO_LONGER_PRESENT'} />
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Requirement({ ok, text }: { ok: boolean; text: string }) {
  return <View style={styles.requirement}><Ionicons color={ok ? '#39D98A' : '#FFB85C'} name={ok ? 'checkmark-circle' : 'alert-circle'} size={20} /><Text style={styles.requirementText}>{text}</Text></View>;
}

function PrimaryButton({ compact = false, disabled, label, onPress }: { compact?: boolean; disabled: boolean; label: string; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, compact && styles.compactButton, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>;
}

function SecondaryButton({ disabled, label, onPress, selected }: { disabled: boolean; label: string; onPress: () => void; selected: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.secondaryButton, selected && styles.secondarySelected, disabled && styles.disabled]}><Text style={styles.secondaryText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#071020' }, flex: { flex: 1 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#21314B' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: '#F7FAFF', fontSize: 19, fontWeight: '800', letterSpacing: 1.2 },
  content: { padding: 18, paddingBottom: 96, gap: 14 }, hero: { alignItems: 'center', gap: 8, paddingVertical: 12 }, title: { color: '#F7FAFF', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  body: { color: '#AEBBD0', fontSize: 15, lineHeight: 21 }, card: { backgroundColor: '#0D1A2F', borderWidth: 1, borderColor: '#1B3354', borderRadius: 18, padding: 16, gap: 11 },
  cardTitle: { color: '#F7FAFF', fontSize: 18, fontWeight: '700' }, message: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 13, backgroundColor: '#142846' }, messageText: { flex: 1, color: '#E8F2FF', lineHeight: 20 },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: 9 }, requirementText: { color: '#D8E2F2', fontSize: 15 }, hint: { color: '#8F9DB2', fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { color: '#F7FAFF', fontSize: 19, fontWeight: '700' },
  primaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: '#078DEB', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }, compactButton: { minHeight: 42 }, primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.45 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: '#344967', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8 }, chipSelected: { backgroundColor: '#113F69', borderColor: '#45B7FF' }, chipText: { color: '#B6C3D6', fontSize: 13 }, chipTextSelected: { color: '#E8F7FF' },
  input: { minHeight: 112, borderWidth: 1, borderColor: '#31445F', borderRadius: 13, padding: 12, color: '#F7FAFF', textAlignVertical: 'top', fontSize: 15 }, counter: { color: '#8492A8', textAlign: 'right', fontSize: 12 },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, category: { flex: 1, color: '#72C8FF', fontWeight: '700', fontSize: 15 }, status: { color: '#39D98A', fontSize: 11, fontWeight: '800' }, description: { color: '#F0F5FC', fontSize: 16, lineHeight: 23 }, meta: { color: '#91A1B8', fontSize: 13 }, reportActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  secondaryButton: { minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: '#335071', borderRadius: 12, paddingHorizontal: 12 }, secondarySelected: { backgroundColor: '#173B5C', borderColor: '#45B7FF' }, secondaryText: { color: '#D7E7F8', fontSize: 12, fontWeight: '700' },
});
