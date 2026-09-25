import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import { KeyboardSafeScrollView as ScrollView, KeyboardSafeTextInput as TextInput } from '@/components/KeyboardSafeForm';
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
  NETWORK_FEED_RADIUS_METERS,
  NETWORK_FEED_RADIUS_OPTIONS,
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
    if (error.category === 'forbidden') return 'Questa operazione NETWORK non è disponibile per il tuo account.';
    if (error.category === 'network') return 'Connessione non disponibile. Riprova tra poco.';
  }
  return fallback;
};

const formatRadius = (meters: number) => meters >= 1_000
  ? `${(meters / 1_000).toFixed(1).replace('.0', '')} km`
  : `${meters} m`;

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
  const [feedRadius, setFeedRadius] = useState(NETWORK_FEED_RADIUS_METERS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
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
      setLoadError(null);
      setFirstName(status.firstName ?? '');
      setLastName(status.lastName ?? '');
      setNickname(status.nickname ?? '');
      setPhone(status.phone ?? '');
      if (!status.eligible || status.restrictionStatus === 'FULL_NETWORK_BLOCKED') {
        setReports([]);
        return;
      }
      const savedRadius = await NetworkService.getFeedRadius();
      if (!isCurrent(expectedUser, generation, request)) return;
      setFeedRadius(savedRadius);
      const feed = await NetworkService.loadFeed(savedRadius);
      if (isCurrent(expectedUser, generation, request)) setReports(feed.reports);
    } catch (error) {
      if (isCurrent(expectedUser, generation, request)) {
        setLoadError(friendlyError('Impossibile caricare NETWORK. Riprova tra poco.')(error));
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
    setFeedRadius(NETWORK_FEED_RADIUS_METERS);
    setMessage(null);
    setLoadError(null);
    setFirstName('');
    setLastName('');
    setNickname('');
    setPhone('');
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

  const saveIdentity = () => {
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    if (firstName.trim().length < 2 || lastName.trim().length < 2
      || nickname.trim().length < 2 || phoneDigits.length < 6 || phoneDigits.length > 15) {
      setMessage('Completa nome, cognome, nickname e numero di telefono.');
      return;
    }
    void runAction(
      () => NetworkService.updateIdentity({ firstName, lastName, nickname, phone }),
      'Dati NETWORK aggiornati.',
    );
  };

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

  const changeFeedRadius = (radiusMeters: number) => {
    if (radiusMeters === feedRadius) return;
    void runAction(
      () => NetworkService.setFeedRadius(radiusMeters),
      `Raggio NETWORK aggiornato a ${formatRadius(radiusMeters)}.`,
      () => setFeedRadius(radiusMeters),
    );
  };

  const resolve = (reportId: string) => void runAction(
    () => NetworkService.resolve(reportId),
    'Segnalazione conclusa.',
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Torna indietro" hitSlop={12} onPress={() => (
          router.canGoBack() ? router.back() : router.replace('/(tabs)')
        )} style={styles.iconButton}>
          <Ionicons color="#3656A3" name="arrow-back" size={24} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>NETWORK</Text>
          <Text style={styles.headerSubtitle}>Segnalazioni di sicurezza vicino a te</Text>
        </View>
        <Pressable accessibilityLabel="Aggiorna NETWORK" disabled={busy || loading} hitSlop={12} onPress={() => void load()} style={styles.iconButton}>
          <Ionicons color="#3656A3" name="refresh" size={22} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#45B7FF" />}>
          <View style={styles.hero}>
            <Ionicons color="#45B7FF" name="shield-checkmark-outline" size={42} />
            <Text style={styles.title}>Bacheca di sicurezza territoriale</Text>
            <Text style={styles.body}>Condividi e consulta segnalazioni utili. La posizione mostrata è sempre approssimativa.</Text>
          </View>

          {message ? (
            <View accessibilityLiveRegion="polite" style={styles.message}>
              <Text style={styles.messageText}>{message}</Text>
              <Pressable accessibilityLabel="Chiudi messaggio" onPress={() => setMessage(null)}><Ionicons color="#52627A" name="close" size={20} /></Pressable>
            </View>
          ) : null}

          {loadError ? (
            <View accessibilityLiveRegion="polite" style={styles.message}>
              <Text style={styles.messageText}>{loadError}</Text>
              <PrimaryButton compact disabled={loading} label="RIPROVA" onPress={() => void load()} />
            </View>
          ) : null}

          {!userId ? (
            <View style={styles.card}><Text style={styles.cardTitle}>Accedi per usare NETWORK</Text><Text style={styles.body}>Le segnalazioni sono riservate agli account verificati.</Text></View>
          ) : null}

          {userId && onboarding && !onboarding.eligible ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Completa il tuo account</Text>
              <Requirement ok={onboarding.emailVerified} text="Email verificata" />
              <Requirement ok={onboarding.firstNamePresent} text="Nome reale inserito" />
              <Requirement ok={onboarding.lastNamePresent} text="Cognome reale inserito" />
              <Requirement ok={onboarding.nicknamePresent} text="Nickname impostato" />
              <Requirement ok={onboarding.phonePresent} text="Numero di telefono inserito" />
              <Requirement ok={onboarding.termsAccepted} text="Condizioni NETWORK accettate" />
              <Text style={styles.hint}>Nome, cognome e telefono restano dati interni. Nel NETWORK viene mostrato soltanto il nickname.</Text>
              <TextInput autoCapitalize="words" editable={!busy} maxLength={60} onChangeText={setFirstName} placeholder="Nome" placeholderTextColor="#71809B" style={styles.shortInput} value={firstName} />
              <TextInput autoCapitalize="words" editable={!busy} maxLength={60} onChangeText={setLastName} placeholder="Cognome" placeholderTextColor="#71809B" style={styles.shortInput} value={lastName} />
              <TextInput autoCapitalize="none" editable={!busy} maxLength={40} onChangeText={setNickname} placeholder="Nickname pubblico" placeholderTextColor="#71809B" style={styles.shortInput} value={nickname} />
              <TextInput editable={!busy} keyboardType="phone-pad" maxLength={32} onChangeText={setPhone} placeholder="Numero di telefono" placeholderTextColor="#71809B" style={styles.shortInput} value={phone} />
              <PrimaryButton disabled={busy} label="SALVA DATI NETWORK" onPress={saveIdentity} />
              {!onboarding.termsAccepted ? <PrimaryButton disabled={busy} label="ACCETTA LE CONDIZIONI NETWORK" onPress={acceptTerms} /> : null}
              {!onboarding.phoneVerified ? <Text style={styles.hint}>La verifica SMS del telefono è facoltativa in questa versione.</Text> : null}
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
                  label={composerOpen ? 'CHIUDI' : 'NUOVA SEGNALAZIONE'}
                  onPress={() => {
                    setPublishMessage(null);
                    setComposerOpen((value) => !value);
                  }}
                  compact
                />
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Segnalazioni entro</Text>
                <View style={styles.chips}>{NETWORK_FEED_RADIUS_OPTIONS.map((radius) => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    key={radius}
                    onPress={() => changeFeedRadius(radius)}
                    style={[styles.chip, feedRadius === radius && styles.chipSelected]}>
                    <Text style={[styles.chipText, feedRadius === radius && styles.chipTextSelected]}>{formatRadius(radius)}</Text>
                  </Pressable>
                ))}</View>
              </View>

              {publishMessage ? (
                <View accessibilityLiveRegion="polite" style={styles.message}>
                  <Text style={styles.messageText}>{publishMessage}</Text>
                  <Pressable accessibilityLabel="Chiudi messaggio pubblicazione" onPress={() => setPublishMessage(null)}>
                    <Ionicons color="#52627A" name="close" size={20} />
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
                <View style={styles.emptyCard}>
                  <Ionicons color="#3656A3" name="shield-checkmark-outline" size={30} />
                  <Text style={styles.cardTitle}>Nessuna segnalazione attiva in questa zona</Text>
                  <Text style={styles.body}>NETWORK mostra le segnalazioni condivise dalla community vicino a te.</Text>
                </View>
              ) : null}

              {reports.map((report) => (
                <View key={report.id} style={styles.card}>
                  <View style={styles.reportHeader}>
                    <View style={styles.categoryCopy}>
                      <Ionicons color="#3656A3" name="shield-outline" size={18} />
                      <Text style={styles.category}>{getNetworkCategoryLabel(report.category)}</Text>
                    </View>
                    <Text style={[styles.status, report.status !== 'ACTIVE' && styles.statusResolved]}>{report.status === 'ACTIVE' ? 'ATTIVA' : 'CONCLUSA'}</Text>
                  </View>
                  <Text style={styles.description}>{report.description}</Text>
                  <Text style={styles.meta}>Zona approssimativa</Text>
                  <Text style={styles.meta}>Segnalata da {report.authorNickname}</Text>
                  {report.status === 'RESOLVED' ? <Text style={styles.body}>Segnalazione conclusa</Text> : null}
                  {report.status === 'ACTIVE' ? (
                    <View style={styles.reportActions}>
                      {report.isMine ? (
                        <SecondaryButton disabled={busy} label="NON PIÙ PRESENTE" onPress={() => resolve(report.id)} selected={false} />
                      ) : (
                        <>
                          <SecondaryButton disabled={busy || onboarding.restrictionStatus === 'READ_ONLY' || onboarding.restrictionStatus === 'INTERACTIONS_BLOCKED'} label={`CONFERMA · ${report.confirmationCount}`} onPress={() => respond(report.id, 'CONFIRMED')} selected={report.myConfirmation === 'CONFIRMED'} />
                          <SecondaryButton disabled={busy || onboarding.restrictionStatus === 'READ_ONLY' || onboarding.restrictionStatus === 'INTERACTIONS_BLOCKED'} label="NON PIÙ PRESENTE" onPress={() => respond(report.id, 'NO_LONGER_PRESENT')} selected={report.myConfirmation === 'NO_LONGER_PRESENT'} />
                        </>
                      )}
                    </View>
                  ) : null}
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
  screen: { flex: 1, backgroundColor: '#F7F9FC' }, flex: { flex: 1 },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E3E8F0' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, paddingHorizontal: 8 }, headerTitle: { color: '#18243D', fontSize: 19, fontWeight: '800', letterSpacing: 1.2 }, headerSubtitle: { color: '#61708A', fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 96, gap: 14 }, hero: { alignItems: 'center', gap: 8, paddingVertical: 12 }, title: { color: '#18243D', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  body: { color: '#5E6D84', fontSize: 15, lineHeight: 21 }, card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E6EF', borderRadius: 16, padding: 16, gap: 11 }, emptyCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE5F2', borderRadius: 16, padding: 18, gap: 9 },
  cardTitle: { color: '#18243D', fontSize: 18, fontWeight: '700' }, message: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 13, backgroundColor: '#EEF3FF' }, messageText: { flex: 1, color: '#273A5A', lineHeight: 20 },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: 9 }, requirementText: { color: '#34445F', fontSize: 15 }, hint: { color: '#6B7890', fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { color: '#18243D', fontSize: 19, fontWeight: '700', flexShrink: 1 },
  primaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: '#3656A3', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }, compactButton: { minHeight: 44, flexShrink: 1 }, primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', textAlign: 'center' }, disabled: { opacity: 0.45 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: '#CBD5E4', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8 }, chipSelected: { backgroundColor: '#E8EEFF', borderColor: '#6B83C5' }, chipText: { color: '#52627A', fontSize: 13 }, chipTextSelected: { color: '#263E78', fontWeight: '700' },
  input: { minHeight: 112, borderWidth: 1, borderColor: '#CBD5E4', borderRadius: 13, padding: 12, color: '#18243D', backgroundColor: '#FFFFFF', textAlignVertical: 'top', fontSize: 15 }, counter: { color: '#71809B', textAlign: 'right', fontSize: 12 },
  shortInput: { minHeight: 48, borderWidth: 1, borderColor: '#CBD5E4', borderRadius: 13, paddingHorizontal: 12, color: '#18243D', backgroundColor: '#FFFFFF', fontSize: 15 },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, categoryCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }, category: { flexShrink: 1, color: '#3656A3', fontWeight: '700', fontSize: 15 }, status: { color: '#1B8A5A', fontSize: 11, fontWeight: '800' }, statusResolved: { color: '#71809B' }, description: { color: '#263650', fontSize: 16, lineHeight: 23 }, meta: { color: '#71809B', fontSize: 13 }, reportActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  secondaryButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#AEBBD0', borderRadius: 12, paddingHorizontal: 12 }, secondarySelected: { backgroundColor: '#E8EEFF', borderColor: '#6B83C5' }, secondaryText: { color: '#344B75', fontSize: 12, fontWeight: '700' },
});
