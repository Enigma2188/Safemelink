import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import { InterfaceModeStorage, type InterfaceMode } from '@/storage/InterfaceModeStorage';
import { ensureOperationalChannel, openOperationalChannelSettings, SAFETY_NOTIFICATION_CHANNEL_ID } from '@/services/OperationalNotificationChannels';
import { SafetyNotificationPreferenceStorage } from '@/storage/SafetyNotificationPreferenceStorage';

type NotificationState = 'loading' | 'active' | 'permission' | 'blocked' | 'disabled';

export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [mode, setMode] = useState<InterfaceMode>('complete');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationState, setNotificationState] = useState<NotificationState>('loading');
  const [channelBlocked, setChannelBlocked] = useState(false);
  const [testInFlight, setTestInFlight] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void InterfaceModeStorage.get().then((stored) => {
      if (active && stored) setMode(stored);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    void SafetyNotificationPreferenceStorage.get(session.user.id).then(setNotificationsEnabled);
  }, [session?.user.id]);

  const refreshNotificationState = useCallback(async (enabledOverride = notificationsEnabled) => {
    if (!enabledOverride) {
      setChannelBlocked(false);
      setNotificationState('disabled');
      return;
    }
    setNotificationState('loading');
    try {
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) {
        setChannelBlocked(!permission.canAskAgain);
        setNotificationState(permission.canAskAgain ? 'permission' : 'blocked');
        return;
      }
      if (Platform.OS === 'android') {
        const channel = await Notifications.getNotificationChannelAsync(SAFETY_NOTIFICATION_CHANNEL_ID);
        const silent = channel === null || channel.importance < Notifications.AndroidImportance.DEFAULT || channel.sound === null;
        setChannelBlocked(silent);
        setNotificationState(silent ? 'blocked' : 'active');
        return;
      }
      setChannelBlocked(false);
      setNotificationState('active');
    } catch {
      setChannelBlocked(false);
      setNotificationState('permission');
    }
  }, [notificationsEnabled]);

  useEffect(() => {
    void refreshNotificationState();
  }, [notificationsEnabled, refreshNotificationState]);

  const chooseMode = (nextMode: InterfaceMode) => {
    setMode(nextMode);
    void InterfaceModeStorage.set(nextMode);
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (!session?.user.id) return;
    await SafetyNotificationPreferenceStorage.set(session.user.id, enabled);
    setNotificationsEnabled(enabled);
    if (enabled) {
      await Notifications.requestPermissionsAsync();
      await ensureOperationalChannel(SAFETY_NOTIFICATION_CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
    }
    await refreshNotificationState(enabled);
  };

  const openNotificationSettings = () => {
    if (Platform.OS === 'android' && channelBlocked) {
      void openOperationalChannelSettings(SAFETY_NOTIFICATION_CHANNEL_ID).catch(() => Linking.openSettings());
      return;
    }
    void Linking.openSettings();
  };

  const sendTestNotification = async () => {
    if (testInFlight || !notificationsEnabled) return;
    setTestInFlight(true);
    setTestMessage(null);
    try {
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) {
        setTestMessage('Autorizza prima gli avvisi nelle impostazioni del telefono.');
        await refreshNotificationState();
        return;
      }
      await ensureOperationalChannel(SAFETY_NOTIFICATION_CHANNEL_ID, 'Verifiche di sicurezza', Notifications.AndroidImportance.HIGH);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'SafeMeLink — Notifica di prova',
          body: 'Gli avvisi di sicurezza possono essere mostrati su questo telefono.',
          sound: 'default',
          data: { type: 'safety_check_test' },
        },
        trigger: Platform.OS === 'android' ? { channelId: SAFETY_NOTIFICATION_CHANNEL_ID } : null,
      });
      setTestMessage('Notifica di prova programmata.');
    } catch {
      setTestMessage('Non è stato possibile programmare la notifica di prova.');
    } finally {
      setTestInFlight(false);
    }
  };

  const notificationLabel = notificationState === 'active'
    ? 'Attive'
    : notificationState === 'blocked'
      ? 'Bloccate dal telefono'
    : notificationState === 'permission'
        ? 'Da autorizzare'
        : notificationState === 'disabled'
          ? 'Disattivate in SafeMeLink'
        : 'Verifica in corso…';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Torna indietro" hitSlop={10} onPress={() => router.back()} style={styles.iconButton}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Impostazioni</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>INTERFACCIA</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Modalità interfaccia</Text>
          <Text style={styles.cardText}>Puoi cambiare questa scelta quando vuoi.</Text>
          <View style={styles.modeRow}>
            {(['essential', 'complete'] as InterfaceMode[]).map((item) => (
              <Pressable key={item} accessibilityRole="button" onPress={() => chooseMode(item)} style={[styles.modeButton, mode === item && styles.modeButtonSelected]}>
                <Text style={[styles.modeText, mode === item && styles.modeTextSelected]}>{item === 'essential' ? 'Essenziale' : 'Completa'}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionLabel}>NOTIFICHE DI SICUREZZA</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowCopy}>
              <Text style={styles.cardTitle}>Avvisi di sicurezza</Text>
              <Text style={styles.cardText}>Stato reale di permessi e canale degli avvisi.</Text>
            </View>
            <Switch value={notificationsEnabled} onValueChange={(value) => void toggleNotifications(value)} disabled={!session} trackColor={{ false: '#CBD5E4', true: '#A9C0F0' }} thumbColor={notificationsEnabled ? '#3656A3' : '#71809B'} />
          </View>
          <Text style={[styles.status, notificationState !== 'active' && styles.statusWarning]}>{notificationState === 'active' ? '✓ ' : '⚠ '}{notificationLabel}</Text>
          {notificationsEnabled && notificationState !== 'active' ? <Pressable accessibilityRole="button" onPress={openNotificationSettings} style={styles.actionButton}><Text style={styles.actionText}>APRI IMPOSTAZIONI NOTIFICHE</Text></Pressable> : null}
          {notificationsEnabled ? <Pressable accessibilityRole="button" disabled={testInFlight} onPress={() => void sendTestNotification()} style={[styles.secondaryButton, testInFlight && styles.disabledButton]}><Text style={styles.secondaryText}>{testInFlight ? 'PROGRAMMAZIONE…' : 'PROVA NOTIFICA'}</Text></Pressable> : null}
          {testMessage ? <Text style={styles.cardText}>{testMessage}</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => void refreshNotificationState()} style={styles.secondaryButton}><Text style={styles.secondaryText}>AGGIORNA STATO</Text></Pressable>
        </View>

        <Text style={styles.sectionLabel}>APP</Text>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" onPress={() => router.push('/how-safemelink-works' as Href)} style={styles.linkRow}><Text style={styles.linkText}>Come funziona SafeMeLink</Text><Text style={styles.chevron}>›</Text></Pressable>
          <Text style={styles.cardText}>{session ? 'Account connesso e impostazioni salvate sul dispositivo.' : 'Accedi per usare tutte le funzioni di sicurezza.'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F9FC' },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E3E8F0' },
  iconButton: { width: 44, height: 44, justifyContent: 'center' }, back: { color: '#3656A3', fontSize: 36, lineHeight: 40 }, headerSpacer: { width: 44 }, title: { flex: 1, color: '#18243D', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  content: { padding: 16, paddingBottom: 48, gap: 10 }, sectionLabel: { color: '#6B7890', fontSize: 12, fontWeight: '800', letterSpacing: 1.1, marginTop: 12 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E6EF', borderRadius: 16, padding: 16, gap: 12 }, cardTitle: { color: '#18243D', fontSize: 17, fontWeight: '700' }, cardText: { color: '#5E6D84', fontSize: 14, lineHeight: 20 },
  modeRow: { flexDirection: 'row', gap: 8 }, modeButton: { flex: 1, minHeight: 46, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#CBD5E4', borderRadius: 12 }, modeButtonSelected: { backgroundColor: '#E8EEFF', borderColor: '#6B83C5' }, modeText: { color: '#52627A', fontWeight: '700' }, modeTextSelected: { color: '#263E78' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 10 }, rowCopy: { flex: 1 }, status: { color: '#1B8A5A', fontWeight: '700' }, statusWarning: { color: '#B26B00' }, actionButton: { minHeight: 48, borderRadius: 12, backgroundColor: '#3656A3', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, actionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', textAlign: 'center' }, secondaryButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#AEBBD0', justifyContent: 'center', alignItems: 'center' }, secondaryText: { color: '#344B75', fontWeight: '700', fontSize: 13 },
  disabledButton: { opacity: 0.55 },
  linkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, linkText: { color: '#3656A3', fontSize: 16, fontWeight: '700' }, chevron: { color: '#3656A3', fontSize: 28 },
});
