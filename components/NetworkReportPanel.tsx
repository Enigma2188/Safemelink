import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { NetworkService } from '@/services/NetworkService';
import { getNetworkCategoryLabel, type NetworkFeedReport, type NetworkReportDetail } from '@/services/NetworkModels';

type Props = { report: NetworkFeedReport; ownerId: string; canPublish: boolean; canInteract: boolean; onClose: () => void };
export function NetworkReportPanel({ report, ownerId, canPublish, canInteract, onClose }: Props) {
  const { session } = useAuth();
  const actor = session?.user.id ?? null;
  const actorRef = useRef(actor); actorRef.current = actor;
  const live = useRef(false);
  const writing = useRef(false);
  const [detail, setDetail] = useState<NetworkReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (detail?.status !== 'ACTIVE') return;
    const expiry = Date.parse(detail.expiresAt);
    if (!Number.isFinite(expiry)) { onClose(); return; }
    const timer = setTimeout(onClose, Math.min(Math.max(0, expiry - Date.now()), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [detail, onClose]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') onClose(); });
    return () => listener.remove();
  }, [onClose]);
  useEffect(() => {
    let valid = true; live.current = true;
    setDetail(null); setError(null);
    if (actor === ownerId) void NetworkService.getReport(report.id).then(value => {
      if (!valid || actorRef.current !== ownerId) return;
      if (!value || value.id !== report.id) { setError('Segnalazione non più disponibile o autorizzazione scaduta. Aggiorna il feed.'); return; }
      setDetail(value);
    }).catch(() => { if (valid && actorRef.current === ownerId) setError('Non è possibile verificare la segnalazione. Nessun contenuto precedente viene conservato.'); });
    return () => { valid = false; live.current = false; };
  }, [actor, ownerId, report.id, revision]);
  const current = () => live.current && actorRef.current === ownerId;
  const write = async (operation: () => Promise<unknown>, success: string) => {
    if (!current() || writing.current || !detail) return;
    writing.current = true; setBusy(true); setNotice(null);
    try {
      await operation();
      if (current()) { setBody(''); setNotice(success); setRevision(v => v + 1); }
    } catch {
      if (current()) { setDetail(null); setError('Operazione non confermata. Riapri il dettaglio dal feed aggiornato.'); }
    } finally { writing.current = false; if (current()) setBusy(false); }
  };
  if (actor !== ownerId) return null;
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
      <Pressable accessibilityRole="button" onPress={onClose} style={s.button}><Text style={s.buttonText}>CHIUDI DETTAGLIO</Text></Pressable>
      <Text accessibilityRole="header" style={s.title}>La segnalazione</Text>
      {error ? <Text accessibilityRole="alert" style={s.notice}>{error}</Text> : !detail ? <Text style={s.text}>Verifica di accesso in corso…</Text> : <>
        <Text style={s.kicker}>{getNetworkCategoryLabel(detail.category)} · {detail.status === 'ACTIVE' ? 'PRESENTE' : 'CONCLUSA'}</Text>
        <Text style={s.text}>{detail.description}</Text>
        <Text style={s.note}>Pubblicata il {new Date(detail.createdAt).toLocaleString('it-IT')} · {detail.authorNickname}</Text>
        <Text style={s.note}>Area approssimativa: {detail.publicArea}. Nessun indirizzo privato viene ricostruito.</Text>
        <Text accessibilityRole="header" style={s.title}>Aggiornamenti dell’autore</Text>
        {!detail.updates.length ? <Text style={s.note}>Nessun aggiornamento disponibile.</Text> : detail.updates.map(update => <View style={s.card} key={update.id}>
          <Text style={s.note}>{new Date(update.createdAt).toLocaleString('it-IT')}</Text><Text style={s.text}>{update.body}</Text>
        </View>)}
        {report.isMine && canPublish && detail.status === 'ACTIVE' ? <View style={s.card}>
          <Text style={s.text}>Aggiungi un aggiornamento alla tua segnalazione</Text>
          <TextInput accessibilityLabel="Aggiornamento dell’autore" value={body} onChangeText={setBody} multiline maxLength={300} editable={!busy}
            placeholder="Solo fatti utili, senza nomi o dati privati" placeholderTextColor="#BDD2EE" style={s.input} />
          <Pressable accessibilityRole="button" disabled={busy || body.trim().length < 2} style={[s.button, (busy || body.trim().length < 2) && s.disabled]}
            onPress={() => void write(() => NetworkService.addUpdate(report.id, body), 'Aggiornamento confermato dal server.')}><Text style={s.buttonText}>PUBBLICA AGGIORNAMENTO</Text></Pressable>
        </View> : null}
        <Text style={s.note}>Commenti pubblici non abilitati. Gli aggiornamenti non sono una discussione aperta.</Text>
        {!report.isMine && canInteract ? <View style={s.card}>
          <Text style={s.text}>Segnala un contenuto ai moderatori</Text>
          <Text style={s.note}>Non è un nuovo avviso pubblico e non attiva un SOS.</Text>
          {([{ reason: 'PERSONAL_DATA', label: 'Dati personali' }, { reason: 'PERSONAL_ACCUSATION', label: 'Accuse identificabili' }, { reason: 'SPAM', label: 'Spam o contenuto ripetuto' }] as const).map(item =>
            <Pressable key={item.reason} accessibilityRole="button" disabled={busy} style={[s.button, busy && s.disabled]}
              onPress={() => void write(() => NetworkService.reportContent({ reportId: report.id, reason: item.reason }), 'Contenuto segnalato alla moderazione.')}><Text style={s.buttonText}>{item.label}</Text></Pressable>)}
        </View> : null}
      </>}
      {notice ? <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text> : null}
      <Text style={s.note}>Sono mostrati soltanto i dati attualmente restituiti dal server. Lo storico di mesi precedenti non è ancora disponibile.</Text>
    </ScrollView>
  </Modal>;
}
const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#071C39', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 40, gap: 18 },
  title: { color: '#F5FAFF', fontSize: 23, fontWeight: '800' }, text: { color: '#F5FAFF', fontSize: 16, lineHeight: 24 },
  kicker: { color: '#8ADFFF', fontSize: 15, fontWeight: '700' }, note: { color: '#BDD2EE', fontSize: 14, lineHeight: 21 },
  notice: { color: '#FFE2A9', fontSize: 16, lineHeight: 23 }, card: { borderRadius: 18, borderWidth: 1, borderColor: '#346A99', padding: 16, gap: 12, backgroundColor: '#0C274A' },
  button: { minHeight: 48, justifyContent: 'center', padding: 14, backgroundColor: '#8ADFFF', borderRadius: 14 }, buttonText: { color: '#08213E', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  input: { minHeight: 90, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#69D5FF', color: '#FFF', fontSize: 16, textAlignVertical: 'top' }, disabled: { opacity: 0.45 },
});
