import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import { useAuth } from '@/backend/auth/AuthProvider';
import { ProtectionSignalService, type ProtectionSignalDraft } from '@/services/ProtectionSignalService';
import { ProtectionSignalTrustedContactService } from '@/services/ProtectionSignalTrustedContactService';
import { SOSLaunchRuntime } from '@/services/SOSLaunchRuntime';

const steps = [
  { title: 'A chi sta succedendo?', values: [['SELF', 'A me'], ['WITNESSED', "L’ho visto"], ['TOLD', 'Me ne hanno parlato'], ['PREFER_NOT_TO_SAY', 'Preferisco non dirlo']] },
  { title: 'Che cosa sta succedendo?', values: [['HUMILIATION', 'Prese in giro / umiliazioni'], ['THREATS', 'Minacce'], ['ASSAULT', 'Aggressioni'], ['EXCLUSION', 'Esclusione ripetuta'], ['PRESSURE', 'Ricatti / pressioni'], ['CYBERBULLYING', 'Cyberbullismo'], ['OTHER', 'Altro']] },
  { title: 'Quanto spesso?', values: [['ONCE', 'Una volta'], ['REPEATED', 'Più volte'], ['OFTEN', 'Succede spesso'], ['UNKNOWN', 'Non so']] },
  { title: 'Dove?', values: [['SCHOOL', 'Scuola'], ['COMMUTE', 'Tragitto scuola/casa'], ['SPORT', 'Sport / attività'], ['PUBLIC_PLACE', 'Parco / luogo pubblico'], ['ONLINE', 'Online'], ['OTHER', 'Altro']] },
];

export default function ProtectionSignalScreen() {
  const { session } = useAuth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<ProtectionSignalDraft>>({});
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<TrustedContact | null>(null);
  const [selectedNeedsHelp, setSelectedNeedsHelp] = useState<ProtectionSignalDraft['needsHelp']>('NO');
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [signalSent, setSignalSent] = useState(false);
  const [sendingContact, setSendingContact] = useState(false);
  const [areaAlerts, setAreaAlerts] = useState<{ context_label: string; period_label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const current = steps[step];
  const online = draft.placeType === 'ONLINE';
  const complete = useMemo(() => Boolean(draft.subjectRelation && draft.category && draft.frequency && draft.placeType), [draft]);

  useEffect(() => {
    void ContactsService.list().then((next) => setContacts(next.filter((contact) => Boolean(contact.remoteId)))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!draft.placeType || draft.placeType === 'ONLINE') {
      setAreaAlerts([]);
      return;
    }
    void ProtectionSignalService.getAreaAlerts().then((alerts) => setAreaAlerts(alerts.map(({ context_label, period_label }) => ({ context_label, period_label })))).catch(() => undefined);
  }, [draft.placeType]);

  const select = (value: string) => {
    const key = ['subjectRelation', 'category', 'frequency', 'placeType'][step] as keyof ProtectionSignalDraft;
    setDraft((previous) => ({ ...previous, [key]: value } as Partial<ProtectionSignalDraft>));
    setStep((previous) => previous + 1);
  };

  const submit = async (needsHelp: ProtectionSignalDraft['needsHelp']) => {
    if (needsHelp === 'DANGER_NOW') return;
    if (!complete || saving) return;
    setSaving(true);
    try {
      await ProtectionSignalService.create({ ...draft, needsHelp } as ProtectionSignalDraft);
      setSignalSent(true);
    } catch (error: unknown) {
      Alert.alert('Non è stato possibile inviare il segnale', error instanceof Error ? error.message : 'Riprova più tardi.');
    } finally { setSaving(false); }
  };

  const launchSOS = () => {
    if (session?.user.id) SOSLaunchRuntime.request(session.user.id);
  };

  const notifyTrustedContact = async () => {
    if (!selectedContact || sendingContact) return;
    setSendingContact(true);
    const result = await ProtectionSignalTrustedContactService.send(selectedContact);
    setSendingContact(false);
    Alert.alert(
      result === 'sent' || result === 'composer' ? 'Segnale inviato' : 'Invio non completato',
      result === 'composer' ? 'Il messaggio è pronto nel composer SMS. Premi Invia per completare.' : result === 'sent' ? 'Segnale inviato al tuo contatto fidato.' : 'Il segnale resta valido, ma non è stato possibile contattare il destinatario.',
      result === 'sent' || result === 'composer' ? [{ text: 'Fine', onPress: () => router.back() }] : [{ text: 'OK' }],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}><Ionicons name="shield-checkmark" size={44} color="#91D8FF" /><Text style={styles.title}>Segnale Tutela</Text><Text style={styles.subtitle}>A volte chiedere aiuto è difficile. Puoi iniziare con un segnale.</Text></View>
      {step < steps.length ? <><Text style={styles.step}>Passo {step + 1} di {steps.length}</Text><Text style={styles.heading}>{current.title}</Text><View style={styles.options}>{current.values.map(([value, label]) => <Pressable key={value} style={styles.option} onPress={() => select(value)}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View></> : <>
        <View style={styles.areaSection}><Text style={styles.areaHeading}>Tutela nella tua zona</Text>{areaAlerts.length > 0 ? areaAlerts.map((alert) => <View key={alert.context_label} style={styles.alert}><Ionicons name="shield-checkmark" size={24} color="#FFCC66" /><View style={styles.alertCopy}><Text style={styles.alertTitle}>ATTENZIONE TUTELA</Text><Text style={styles.alertText}>Negli ultimi giorni sono emersi più segnali indipendenti relativi a {alert.context_label.toLowerCase()} in quest’area.</Text></View></View>) : <Text style={styles.note}>Gli avvisi vengono mostrati solo quando SafeMeLink rileva più segnali indipendenti compatibili nella stessa area.</Text>}</View>
        {online && draft.category === 'CYBERBULLYING' ? <><Text style={styles.heading}>Dove online?</Text><View style={styles.options}>{[['SOCIAL', 'Social'], ['CHAT', 'Chat / gruppo'], ['GAMING', 'Gaming'], ['OTHER', 'Altro']].map(([value, label]) => <Pressable key={value} style={styles.option} onPress={() => setDraft((p) => ({ ...p, onlineContext: value as ProtectionSignalDraft['onlineContext'] }))}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View></> : null}
        {signalSent ? <View style={styles.successBox}><Text style={styles.successTitle}>Segnale ricevuto</Text><Text style={styles.note}>Il tuo segnale resta protetto e non viene mostrato singolarmente alla comunità.</Text><PrimaryAction label="Per ora basta così" onPress={() => router.back()} /><Text style={styles.note}>Puoi anche chiedere a una persona di fiducia di contattarti.</Text>{contacts.length > 0 ? <><View style={styles.options}>{contacts.slice(0, 3).map((contact) => <Pressable key={contact.id} style={[styles.option, selectedContact?.id === contact.id && styles.selected]} onPress={() => setSelectedContact(contact)}><Text style={styles.optionText}>{contact.name}</Text></Pressable>)}</View><PrimaryAction disabled={!selectedContact || sendingContact} label="Avvisa una persona di fiducia" onPress={() => void notifyTrustedContact()} /></> : <Text style={styles.note}>Non hai ancora un contatto fidato configurato.</Text>}</View> : emergencyMode ? <View style={styles.emergencyBox}><Text style={styles.emergencyTitle}>Sei in pericolo adesso</Text><Text style={styles.emergencyHint}>Attiva il normale SOS SafeMeLink.</Text><PrimaryAction label="ATTIVA SOS ORA" onPress={launchSOS} /><Pressable onPress={() => setEmergencyMode(false)}><Text style={styles.backText}>Indietro</Text></Pressable></View> : <><Text style={styles.heading}>Hai bisogno di aiuto adesso?</Text><View style={styles.options}>{[['NO', 'No'], ['ADULT', 'Vorrei parlare con un adulto'], ['DANGER_NOW', 'Sono in pericolo adesso']].map(([value, label]) => <Pressable key={value} disabled={saving} style={[styles.option, selectedNeedsHelp === value && styles.selected]} onPress={() => value === 'DANGER_NOW' ? setEmergencyMode(true) : setSelectedNeedsHelp(value as ProtectionSignalDraft['needsHelp'])}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View><PrimaryAction disabled={saving} label="INVIA SEGNALE TUTELA" onPress={() => void submit(selectedNeedsHelp)} /></>}
      </>}
    </ScrollView>
  );
}

function PrimaryAction({ disabled, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryAction, disabled && styles.disabled]}><Text style={styles.primaryActionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 22, gap: 16, backgroundColor: '#070D22' },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  title: { color: '#F7FAFF', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#B8C8E8', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  step: { color: '#91D8FF', fontWeight: '700' },
  heading: { color: '#F7FAFF', fontSize: 22, fontWeight: '800' },
  options: { gap: 10 },
  option: { minHeight: 54, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: '#365476', backgroundColor: '#10213D' },
  optionText: { color: '#F7FAFF', fontSize: 16, fontWeight: '700' },
  selected: { borderColor: '#25D7FF', backgroundColor: '#153E5A' },
  disabled: { opacity: 0.5 },
  note: { color: '#B8C8E8', lineHeight: 21, textAlign: 'center' },
  areaSection: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#365476', backgroundColor: '#0D1832' },
  areaHeading: { color: '#F7FAFF', fontSize: 19, fontWeight: '800' },
  alert: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#2A2740' },
  alertCopy: { flex: 1, gap: 4 },
  alertTitle: { color: '#FFCC66', fontWeight: '800' },
  alertText: { color: '#F7FAFF', lineHeight: 20 },
  successBox: { gap: 14, padding: 18, borderRadius: 16, backgroundColor: '#102A38' },
  successTitle: { color: '#8CE7C0', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  primaryAction: { minHeight: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#138DCE', paddingHorizontal: 18 },
  primaryActionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emergencyBox: { gap: 18, alignItems: 'stretch', padding: 20, borderRadius: 18, backgroundColor: '#3A1020', borderWidth: 1, borderColor: '#FF5270' },
  emergencyTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  emergencyHint: { color: '#FFD6DE', textAlign: 'center', lineHeight: 21 },
  backText: { color: '#FFD6DE', textAlign: 'center', fontWeight: '700', padding: 10 },
});
