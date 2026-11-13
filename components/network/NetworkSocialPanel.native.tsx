import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NetworkOperationalDetailV2 } from '@/services/NetworkMapContractV2';
import type { NetworkSocialController } from './NetworkSocialController';

/** Uses the existing social slot, not another route or demo. Plain text only, no WebView. */
export function NetworkSocialPanel({ controller, detail }: { controller: NetworkSocialController; detail: NetworkOperationalDetailV2 }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [body, setBody] = useState('');
  useEffect(() => {
    setBody(''); controller.select(detail);
    if (AppState.currentState !== 'active') controller.suspend();
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') controller.resume(); else controller.suspend(); });
    return () => { subscription.remove(); controller.select(null); };
  }, [controller, detail]);
  useEffect(() => { if (state.notice?.startsWith('Commento ricevuto')) setBody(''); }, [state.notice]);
  const snapshot = state.eventId === detail.marker.publicId ? state.snapshot : null;
  const busy = state.write !== 'IDLE';
  const canClean = !!snapshot && state.phase === 'READY' && !busy;
  const canWrite = !!snapshot && state.phase === 'READY' && !busy && detail.marker.status === 'ACTIVE';
  const comments = snapshot?.comments.filter(c => !detail.updates.some(u => u.publicId === c.publicId)) ?? [];
  const button = (label: string, run: () => void, disabled = false) => <Pressable key={label} accessibilityRole="button"
    accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={run} style={[s.button, disabled && s.disabled]}><Text style={s.text}>{label}</Text></Pressable>;
  return <View style={s.card}>
    {state.notice ? <Text accessibilityRole="alert" style={s.text}>{state.notice}</Text> : null}
    <Text style={s.muted}>Il follow salva la scelta per consultare gli aggiornamenti. Nessuna notifica push è attiva.</Text>
    {state.phase === 'LOADING' ? <Text style={s.text}>Verifica social in corso…</Text> : null}
    {snapshot ? <>
      <Text style={s.text}>{snapshot.confirmedCount} conferme · {snapshot.noLongerPresentCount} non più presenti</Text>
      <Text style={s.muted}>La tua indicazione: {snapshot.myVote === 'CONFIRMED' ? 'Confermato' : snapshot.myVote === 'NO_LONGER_PRESENT' ? 'Non più presente' : 'Nessuna'}</Text>
      {button('Confermo', () => { void controller.act('VOTE', 'CONFIRMED'); }, !canWrite)}
      {button('Non più presente', () => { void controller.act('VOTE', 'NO_LONGER_PRESENT'); }, !canWrite)}
      {button('Rimuovi la mia conferma', () => { void controller.act('VOTE', 'NONE'); }, !canClean || snapshot.myVote === null)}
      {button(snapshot.following ? 'Non seguire più' : 'Segui segnalazione', () => { void controller.act('FOLLOW', snapshot.following ? 'OFF' : 'ON'); }, snapshot.following ? !canClean : !canWrite)}
      <Text style={s.title}>Conversazione</Text>
      {comments.length ? comments.map(c => <View key={c.publicId} style={s.comment}>
        <Text style={s.text}>{c.nickname} · {new Date(c.createdAt).toLocaleString()}</Text><Text style={s.text}>{c.body}</Text>
        {c.canWithdraw ? button('Ritira questo commento', () => { void controller.withdrawComment(c.publicId); }, !canClean) : null}
      </View>) : <Text style={s.muted}>Nessun commento pubblicato disponibile in questa pagina.</Text>}
      {state.hasOlder && snapshot.comments.length ? button('Commenti precedenti', () => {
        const last = snapshot.comments.at(-1); if (last) void controller.refresh({ createdAt: last.createdAt, publicId: last.publicId });
      }, busy) : null}
      <TextInput accessibilityLabel="Commento alla segnalazione" placeholder="Scrivi senza inserire dati personali" placeholderTextColor="#B8CBE0"
        multiline maxLength={1000} value={body} editable={canWrite} onChangeText={setBody} style={s.input} />
      {button('Invia alla moderazione', () => { void controller.act('COMMENT', body.trim()); }, !canWrite || body.trim().length < 2)}
      <Text style={s.muted}>Se sei l’autore puoi inviare un aggiornamento (massimo 300 caratteri). Il server verifica la proprietà; è richiesta la stessa moderazione dei commenti.</Text>
      {button('Invia aggiornamento dell’autore', () => { void controller.act('COMMENT', body.trim(), true); }, !canWrite || body.trim().length < 2 || body.trim().length > 300)}
      <Text style={s.title}>Attività recente · segnalazioni seguite</Text>
      {state.activity.length ? state.activity.map(a => <Text key={a.publicId} style={s.muted}>Partecipazione approvata · {new Date(a.createdAt).toLocaleString()}</Text>)
        : <Text style={s.muted}>Nessun aggiornamento autorizzato disponibile.</Text>}
      <Text style={s.muted}>Mostrati fino a 50 aggiornamenti; dati riletti su richiesta, non un flusso push.</Text>
    </> : <Text style={s.muted}>Stato social non verificato: nessun conteggio o invio è considerato riuscito.</Text>}
    {button('Aggiorna stato social', () => { void controller.refresh(); }, state.write === 'SENDING')}
    {state.write === 'UNKNOWN' ? <>
      {button('Verifica ricevuta', () => { void controller.verify(); })}
      {button('Riprova lo stesso tentativo', () => { void controller.retry(); }, !state.canRetryHere)}
    </> : null}
  </View>;
}
const s = StyleSheet.create({ card: { gap: 10 }, title: { fontSize: 17, fontWeight: '700', color: '#F4F8FD' },
  text: { color: '#E2ECF6', fontSize: 15, lineHeight: 22 }, muted: { color: '#B8CBE0', fontSize: 13, lineHeight: 20 },
  button: { minHeight: 44, borderWidth: 1, borderColor: '#6FADD1', borderRadius: 10, padding: 10, justifyContent: 'center' },
  disabled: { opacity: 0.5 }, input: { color: '#E2ECF6', borderColor: '#6FADD1', borderWidth: 1, borderRadius: 10, minHeight: 80, padding: 10 },
  comment: { borderLeftWidth: 2, borderColor: '#6FADD1', paddingLeft: 10, gap: 4 } });
