import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import { ProtectionSignalService, type ProtectionSignalDraft } from '@/services/ProtectionSignalService';
import { ProtectionSignalTrustedContactService } from '@/services/ProtectionSignalTrustedContactService';

const steps = [
  { title: 'A chi sta succedendo?', values: [['SELF', 'A me'], ['WITNESSED', "L’ho visto"], ['TOLD', 'Me ne hanno parlato'], ['PREFER_NOT_TO_SAY', 'Preferisco non dirlo']] },
  { title: 'Che cosa sta succedendo?', values: [['HUMILIATION', 'Prese in giro / umiliazioni'], ['THREATS', 'Minacce'], ['ASSAULT', 'Aggressioni'], ['EXCLUSION', 'Esclusione ripetuta'], ['PRESSURE', 'Ricatti / pressioni'], ['CYBERBULLYING', 'Cyberbullismo'], ['OTHER', 'Altro']] },
  { title: 'Quanto spesso?', values: [['ONCE', 'Una volta'], ['REPEATED', 'Più volte'], ['OFTEN', 'Succede spesso'], ['UNKNOWN', 'Non so']] },
  { title: 'Dove?', values: [['SCHOOL', 'Scuola'], ['COMMUTE', 'Tragitto scuola/casa'], ['SPORT', 'Sport / attività'], ['PUBLIC_PLACE', 'Parco / luogo pubblico'], ['ONLINE', 'Online'], ['OTHER', 'Altro']] },
];

export default function ProtectionSignalScreen() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<ProtectionSignalDraft>>({});
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<TrustedContact | null>(null);
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
    if (needsHelp === 'DANGER_NOW') {
      Alert.alert('Sei in pericolo?', 'Apri subito il normale SOS SafeMeLink.', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Apri SOS', onPress: () => router.replace('/(tabs)') },
      ]);
      return;
    }
    if (!complete || saving) return;
    setSaving(true);
    try {
      await ProtectionSignalService.create({ ...draft, needsHelp } as ProtectionSignalDraft);
      if (needsHelp === 'ADULT' && selectedContact) {
        const delivery = await ProtectionSignalTrustedContactService.send(selectedContact);
        if (delivery === 'sent' || delivery === 'composer') {
          Alert.alert('Segnale inviato', delivery === 'composer' ? 'Il messaggio è pronto nel composer SMS. Premi Invia per completare.' : 'Segnale inviato al tuo contatto fidato.', [{ text: 'Fine', onPress: () => router.back() }]);
          return;
        }
        Alert.alert('Segnale salvato', 'Il segnale è stato salvato, ma non è stato possibile contattare il destinatario.');
        return;
      }
      Alert.alert('Segnale inviato', 'Grazie. Il tuo segnale è privato e non identifica persone.', [
        { text: 'Fine', onPress: () => router.back() },
      ]);
    } catch (error: unknown) {
      Alert.alert('Non è stato possibile inviare il segnale', error instanceof Error ? error.message : 'Riprova più tardi.');
    } finally { setSaving(false); }
  };

  const save = async (needsHelp: ProtectionSignalDraft['needsHelp']) => {
    if (needsHelp === 'ADULT' && !selectedContact) {
      Alert.alert('Scegli un contatto fidato', 'Seleziona prima l’adulto che vuoi invitare a contattarti.');
      return;
    }
    if (needsHelp === 'ADULT' && selectedContact) {
      Alert.alert('Inviare il Segnale Silenzioso?', 'Verrà inviato solo un messaggio neutro al contatto scelto, senza dettagli della segnalazione.', [{ text: 'Annulla', style: 'cancel' }, { text: 'Conferma', onPress: () => void submit(needsHelp) }]);
      return;
    }
    await submit(needsHelp);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}><Ionicons name="shield-checkmark" size={44} color="#91D8FF" /><Text style={styles.title}>Segnale Tutela</Text><Text style={styles.subtitle}>A volte chiedere aiuto è difficile. Puoi iniziare con un segnale.</Text></View>
      {step < steps.length ? <><Text style={styles.step}>Passo {step + 1} di {steps.length}</Text><Text style={styles.heading}>{current.title}</Text><View style={styles.options}>{current.values.map(([value, label]) => <Pressable key={value} style={styles.option} onPress={() => select(value)}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View></> : <>
        <View style={styles.areaSection}><Text style={styles.areaHeading}>Tutela nella tua zona</Text>{areaAlerts.length > 0 ? areaAlerts.map((alert) => <View key={alert.context_label} style={styles.alert}><Ionicons name="shield-checkmark" size={24} color="#FFCC66" /><View style={styles.alertCopy}><Text style={styles.alertTitle}>ATTENZIONE TUTELA</Text><Text style={styles.alertText}>Negli ultimi giorni sono emersi più segnali indipendenti relativi a {alert.context_label.toLowerCase()} in quest’area.</Text></View></View>) : <Text style={styles.note}>Gli avvisi vengono mostrati solo quando SafeMeLink rileva più segnali indipendenti compatibili nella stessa area.</Text>}</View>
        {online && draft.category === 'CYBERBULLYING' ? <><Text style={styles.heading}>Dove online?</Text><View style={styles.options}>{[['SOCIAL', 'Social'], ['CHAT', 'Chat / gruppo'], ['GAMING', 'Gaming'], ['OTHER', 'Altro']].map(([value, label]) => <Pressable key={value} style={styles.option} onPress={() => setDraft((p) => ({ ...p, onlineContext: value as ProtectionSignalDraft['onlineContext'] }))}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View></> : null}
        {contacts.length > 0 ? <><Text style={styles.note}>Puoi indicare un adulto di fiducia; il messaggio non contiene dettagli personali.</Text><View style={styles.options}>{contacts.slice(0, 3).map((contact) => <Pressable key={contact.id} style={[styles.option, selectedContact?.id === contact.id && styles.selected]} onPress={() => { setSelectedContact(contact); setDraft((p) => ({ ...p, trustedContactId: contact.remoteId ?? null })); }}><Text style={styles.optionText}>{contact.name}</Text></Pressable>)}</View></> : <Text style={styles.note}>Non hai ancora un contatto fidato configurato.</Text>}
        <Text style={styles.heading}>Hai bisogno di aiuto adesso?</Text><View style={styles.options}>{[['NO', 'No'], ['ADULT', 'Vorrei parlare con un adulto'], ['DANGER_NOW', 'Sono in pericolo adesso']].map(([value, label]) => <Pressable key={value} disabled={saving} style={styles.option} onPress={() => void save(value as ProtectionSignalDraft['needsHelp'])}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View>
      </>}
    </ScrollView>
  );
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
  note: { color: '#B8C8E8', lineHeight: 21, textAlign: 'center' },
  areaSection: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#365476', backgroundColor: '#0D1832' },
  areaHeading: { color: '#F7FAFF', fontSize: 19, fontWeight: '800' },
  alert: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#2A2740' },
  alertCopy: { flex: 1, gap: 4 },
  alertTitle: { color: '#FFCC66', fontWeight: '800' },
  alertText: { color: '#F7FAFF', lineHeight: 20 },
});
