import { Ionicons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type GuideSection = {
  activation: string;
  after: string;
  data: string;
  icon: keyof typeof Ionicons.glyphMap;
  purpose: string;
  title: string;
};

const sections: readonly GuideSection[] = [
  {
    title: 'SOS',
    icon: 'alert-circle-outline',
    purpose: 'Chiedere aiuto rapidamente in una situazione reale.',
    activation: 'Tocca il pulsante SOS. Durante il breve countdown puoi annullare o scegliere “Invia subito”.',
    after: 'SafeMeLink salva l’evento e prova ad avvisare i contatti fidati collegati e le persone disponibili nelle vicinanze. L’invio non garantisce che qualcuno abbia letto o possa intervenire.',
    data: 'Posizione dell’emergenza, stato SOS e notifiche. Gli eventuali SMS ai contatti fidati seguono le preferenze configurate.',
  },
  {
    title: 'Rete SafeMeLink',
    icon: 'people-circle-outline',
    purpose: 'Renderti disponibile a ricevere richieste SOS realmente vicine.',
    activation: 'Aderisci dalla Home o dalla schermata Rete SafeMeLink e concedi i permessi richiesti.',
    after: 'Con i permessi necessari, l’app aggiorna la tua disponibilità. Se la posizione diventa troppo vecchia potresti non ricevere SOS vicini. Puoi lasciare la rete in qualunque momento; non esiste una lista pubblica delle persone vicine.',
    data: 'Posizione usata per stabilire la vicinanza agli SOS, con controlli di consenso e durata.',
  },
  {
    title: 'NETWORK',
    icon: 'shield-checkmark-outline',
    purpose: 'Consultare e condividere segnalazioni di sicurezza nella zona che scegli. È distinta dalla rete che riceve gli SOS.',
    activation: 'Apri NETWORK, completa i dati richiesti e accetta le condizioni. Puoi poi leggere l’elenco e pubblicare una segnalazione.',
    after: 'Puoi pubblicare, confermare o aggiornare segnalazioni. Non è una chat o un social generico.',
    data: 'Nickname e posizione pubblica approssimata. Le coordinate precise non vengono mostrate nel feed.',
  },
  {
    title: 'Rete di quartiere',
    icon: 'home-outline',
    purpose: 'Creare una rete privata e ristretta tra persone invitate.',
    activation: 'Crea un gruppo oppure entra tramite un invito nell’app o un codice d’invito.',
    after: 'L’amministratore gestisce inviti e membri, identificati tramite nickname. Non esiste una directory globale.',
    data: 'Nome della rete, nickname, ruoli e inviti necessari al funzionamento del gruppo.',
  },
  {
    title: 'Checkpoint',
    icon: 'checkmark-circle-outline',
    purpose: 'Programmare una verifica di sicurezza dopo un intervallo scelto.',
    activation: 'Scegli la durata e avvia il Checkpoint dalla Home.',
    after: 'Alla scadenza compare “Stai bene?”. Hai 30 secondi per confermare. Se non rispondi, SafeMeLink tenta di avviare l’SOS. Puoi annullare prima della scadenza.',
    data: 'Durata e scadenza salvate sul dispositivo. Il suono dipende anche dalle impostazioni notifiche del telefono.',
  },
  {
    title: 'Torno a casa',
    icon: 'navigate-outline',
    purpose: 'Impostare un controllo legato alla durata stimata del rientro.',
    activation: 'Salva Casa, scegli il mezzo di trasporto e avvia il percorso.',
    after: 'La durata è una stima, non un rilevamento automatico dell’arrivo. Alla scadenza conferma entro 30 secondi; altrimenti l’app tenta di avviare l’SOS. Checkpoint e Torno a casa si usano uno alla volta.',
    data: 'Posizione Casa salvata localmente, posizione iniziale, mezzo scelto e scadenza.',
  },
  {
    title: 'Protezione vocale',
    icon: 'mic-outline',
    purpose: 'Su Android, avviare il countdown SOS pronunciando la parola configurata.',
    activation: 'Salva una parola, attiva la protezione e attendi “IN ASCOLTO”. Se leggi “ASCOLTO IN RIPRISTINO”, il microfono non è ancora confermato pronto.',
    after: 'Pensata soprattutto per l’uso in background su Android. La parola riconosciuta avvia lo stesso countdown SOS. Rumore, microfono occupato o risparmio energetico possono interrompere l’ascolto: controlla lo stato prima di affidarti alla funzione.',
    data: 'La parola resta sul dispositivo. Audio e trascrizioni non vengono caricati. Serve il riconoscimento italiano offline; l’ascolto continuo non è disponibile su iPhone.',
  },
  {
    title: 'Notifiche',
    icon: 'notifications-outline',
    purpose: 'Richiamare l’attenzione su SOS e verifiche di sicurezza.',
    activation: 'Il permesso viene richiesto quando serve. Su Android puoi controllare i canali nelle impostazioni.',
    after: 'Gli avvisi operativi possono essere sonori; rete, modalità silenziosa, DND o impostazioni del canale possono limitarli.',
    data: 'L’app registra il dispositivo per recapitare gli avvisi al tuo account. Questo dato non viene mostrato agli altri utenti.',
  },
  {
    title: 'Privacy e posizione',
    icon: 'lock-closed-outline',
    purpose: 'Usare soltanto i dati necessari alla funzione scelta.',
    activation: 'Concedi o revoca i permessi dalle impostazioni del dispositivo e lascia le reti quando non vuoi partecipare.',
    after: 'Le funzioni normali evitano di mostrare coordinate precise. Un SOS autorizzato usa invece la posizione reale necessaria all’emergenza.',
    data: 'Posizione, nickname e notifiche solo secondo funzione, consenso e autorizzazioni applicabili.',
  },
];

export default function HowSafeMeLinkWorksScreen() {
  const router = useRouter();
  const [expandedSection, setExpandedSection] = useState<string | null>('SOS');

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/' as Href);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Torna indietro" accessibilityRole="button" hitSlop={10} onPress={goBack} style={styles.backButton}>
          <Ionicons color="#F7FAFF" name="arrow-back" size={24} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Come funziona SafeMeLink</Text>
          <Text style={styles.subtitle}>Una guida rapida alle funzioni principali</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.guideValue}>Tocca una funzione per leggere la spiegazione. Puoi ritrovare questa guida dalla Home e dal menu.</Text>
        {sections.map((section) => (
          <View key={section.title} style={styles.card}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedSection === section.title }}
              onPress={() => setExpandedSection(expandedSection === section.title ? null : section.title)} style={styles.cardTitleRow}>
              <View style={styles.iconWrap}>
                <Ionicons color="#57C5FF" name={section.icon} size={22} />
              </View>
              <Text style={styles.cardTitle}>{section.title}</Text>
              <Ionicons accessible={false} color="#C2CDE0" name={expandedSection === section.title ? 'chevron-up' : 'chevron-down'} size={22} />
            </Pressable>
            {expandedSection === section.title && <>
            <GuideRow label="A COSA SERVE" value={section.purpose} />
            <GuideRow label="COME SI ATTIVA" value={section.activation} />
            <GuideRow label="COSA SUCCEDE DOPO" value={section.after} />
            <GuideRow label="DATI E PERMESSI" value={section.data} />
            </>}
          </View>
        ))}
        <Text style={styles.guideValue}>SafeMeLink non sostituisce i soccorsi. Batteria scarica, arresto forzato dell’app, permessi disattivati o assenza di rete possono impedire gli avvisi.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function GuideRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.guideRow}>
      <Text style={styles.guideLabel}>{label}</Text>
      <Text style={styles.guideValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: { alignItems: 'center', borderColor: '#263653', borderRadius: 14, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  card: { backgroundColor: 'rgba(12, 25, 50, 0.92)', borderColor: 'rgba(83, 196, 255, 0.18)', borderRadius: 18, borderWidth: 1, gap: 14, padding: 18 },
  cardTitle: { color: '#F7FAFF', flex: 1, fontSize: 20, fontWeight: '900' },
  cardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 48 },
  content: { gap: 14, padding: 18, paddingBottom: 40 },
  guideLabel: { color: '#58BFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  guideRow: { gap: 5 },
  guideValue: { color: '#C2CDE0', fontSize: 15, lineHeight: 22 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 14, paddingHorizontal: 18, paddingVertical: 14 },
  headerCopy: { flex: 1 },
  iconWrap: { alignItems: 'center', backgroundColor: 'rgba(53, 151, 255, 0.12)', borderRadius: 12, height: 42, justifyContent: 'center', width: 42 },
  screen: { backgroundColor: '#050816', flex: 1 },
  subtitle: { color: '#8FA2C2', fontSize: 13, marginTop: 3 },
  title: { color: '#F7FAFF', fontSize: 21, fontWeight: '900' },
});
