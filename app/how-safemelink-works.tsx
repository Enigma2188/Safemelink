import { Ionicons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

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
    after: 'SafeMeLink salva l’evento, acquisisce la posizione e prova ad avvisare i destinatari selezionati dal backend. La consegna delle notifiche dipende anche da rete e dispositivo.',
    data: 'Posizione dell’emergenza, stato SOS e notifiche. Gli eventuali SMS ai contatti fidati seguono le preferenze configurate.',
  },
  {
    title: 'Rete SafeMeLink',
    icon: 'people-circle-outline',
    purpose: 'Renderti disponibile a ricevere richieste SOS realmente vicine.',
    activation: 'Aderisci dalla Home o dalla schermata Rete SafeMeLink e concedi i permessi richiesti.',
    after: 'L’app mantiene una disponibilità tecnica limitata nel tempo. Non mostra una lista pubblica delle persone vicine.',
    data: 'Posizione usata per stabilire la vicinanza agli SOS, con controlli di consenso e durata.',
  },
  {
    title: 'NETWORK',
    icon: 'shield-checkmark-outline',
    purpose: 'Consultare e condividere segnalazioni territoriali di sicurezza e prevenzione entro 5 km.',
    activation: 'Completa i requisiti NETWORK, accetta le condizioni e apri il feed.',
    after: 'Puoi pubblicare, confermare o aggiornare segnalazioni. Non è una chat o un social generico.',
    data: 'Nickname e posizione pubblica approssimata. Le coordinate precise non vengono mostrate nel feed.',
  },
  {
    title: 'Rete di quartiere',
    icon: 'home-outline',
    purpose: 'Creare una rete privata e ristretta tra persone invitate.',
    activation: 'Crea una rete come amministratore oppure entra con un invito o token NQ.',
    after: 'L’amministratore gestisce inviti e membri, identificati tramite nickname. Non esiste una directory globale.',
    data: 'Nome della rete, nickname, ruoli e inviti necessari al funzionamento del gruppo.',
  },
  {
    title: 'Checkpoint',
    icon: 'checkmark-circle-outline',
    purpose: 'Programmare una verifica di sicurezza dopo un intervallo scelto.',
    activation: 'Scegli la durata e avvia il Checkpoint dalla Home.',
    after: 'Alla scadenza compare “Stai bene?”. Se non rispondi, parte il normale percorso SOS previsto.',
    data: 'Durata e scadenza salvate sul dispositivo. Il suono dipende anche dalle impostazioni notifiche del telefono.',
  },
  {
    title: 'Torno a casa',
    icon: 'navigate-outline',
    purpose: 'Impostare un controllo legato alla durata stimata del rientro.',
    activation: 'Salva Casa, scegli il mezzo di trasporto e avvia il percorso.',
    after: 'SafeMeLink calcola una stima indicativa e alla scadenza chiede se sei arrivato/a. Una mancata risposta segue il percorso SOS esistente.',
    data: 'Posizione Casa salvata localmente, posizione iniziale, mezzo scelto e scadenza.',
  },
  {
    title: 'Protezione vocale',
    icon: 'mic-outline',
    purpose: 'Su Android, avviare il countdown SOS pronunciando la parola configurata.',
    activation: 'Salva una parola, abilita la protezione e mantieni disponibili microfono e servizio richiesto da Android.',
    after: 'Il riconoscimento avviene sul dispositivo. Una corrispondenza valida usa lo stesso countdown del pulsante SOS.',
    data: 'Microfono e parola salvata localmente. Audio e trascrizioni non vengono caricati. Su altre piattaforme le modalità possono differire.',
  },
  {
    title: 'Notifiche',
    icon: 'notifications-outline',
    purpose: 'Richiamare l’attenzione su SOS e verifiche di sicurezza.',
    activation: 'Il permesso viene richiesto quando serve. Su Android puoi controllare i canali nelle impostazioni.',
    after: 'Gli avvisi operativi possono essere sonori; rete, modalità silenziosa, DND o impostazioni del canale possono limitarli.',
    data: 'Token tecnico del dispositivo associato in modo protetto all’account; non viene mostrato agli altri utenti.',
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
        {sections.map((section) => (
          <View key={section.title} style={styles.card}>
            <View style={styles.cardTitleRow}>
              <View style={styles.iconWrap}>
                <Ionicons color="#57C5FF" name={section.icon} size={22} />
              </View>
              <Text style={styles.cardTitle}>{section.title}</Text>
            </View>
            <GuideRow label="A COSA SERVE" value={section.purpose} />
            <GuideRow label="COME SI ATTIVA" value={section.activation} />
            <GuideRow label="COSA SUCCEDE DOPO" value={section.after} />
            <GuideRow label="DATI E PERMESSI" value={section.data} />
          </View>
        ))}
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
  cardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
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
