import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NetworkRecoveryState, NetworkWriteRecovery } from '@/services/NetworkWriteRecovery';
export function NetworkRecoveryPanel({ recovery, state }: { recovery: NetworkWriteRecovery; state: NetworkRecoveryState }) {
  const waiting = ['LOADING','VERIFYING','WRITING'].includes(state.phase);
  const cleanup = state.pending?.rpc === 'finish_my_network_event_v2' || state.pending?.rpc === 'remove_my_network_social_v2';
  const button = (label: string, run: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled}
    accessibilityState={{ disabled }} onPress={run} style={[s.button, disabled && s.disabled]}><Text style={s.text}>{label}</Text></Pressable>;
  return <View style={s.card}><Text style={s.title}>{state.phase === 'READY' ? 'Risultato recuperato' : 'Verifica operazione NETWORK'}</Text>
    <Text accessibilityLiveRegion="polite" style={s.text}>{state.notice ?? 'Lettura del registro locale… Nessun nuovo invio automatico.'}</Text>
    {state.phase !== 'READY' ? button('Rileggi registro locale', () => { void recovery.reload(); }, waiting) : null}
    {state.pending ? <>
      {button(cleanup ? 'Riprova la stessa chiusura o rimozione' : 'Verifica ricevuta sul server', () => { void recovery.resolve(); }, waiting || state.phase === 'ERROR')}
      {!cleanup ? button('Impedisci un invio tardivo', () => Alert.alert('Verificare e fermare il vecchio tentativo?',
        'Se il server lo ha già ricevuto, verrà recuperata la ricevuta: nessuna segnalazione verrà cancellata. Solo se non esiste ancora verrà impedito l’arrivo tardivo di quel tentativo.',
        [{ text: 'Annulla', style: 'cancel' }, { text: 'Conferma', onPress: () => { void recovery.resolve(true); } }]), waiting || state.phase === 'ERROR') : null}
    </> : null}
    {state.phase === 'READY' && state.recoveredEvent ? button('Ritira il mio invio recuperato', () => Alert.alert('Ritirare il tuo invio?',
      'Il server verifica che appartenga al tuo account. Non viene eliminato lo storico.', [{ text: 'Annulla', style: 'cancel' },
        { text: 'Ritira', onPress: () => { void recovery.withdrawRecovered(); } }])) : null}
    {state.phase === 'READY' ? button('Ho letto, torna alla mappa', () => recovery.acknowledge()) : null}
    <Text style={s.muted}>Registro locale: solo identificativi tecnici, nessun testo o posizione. Una ricevuta assente non prova il fallimento.</Text>
  </View>;
}
const s = StyleSheet.create({ card: { padding: 16, gap: 10, backgroundColor: '#08233F' }, title: { fontSize: 18, color: '#F4F8FD', fontWeight: '700' },
  text: { color: '#E2ECF6', fontSize: 15, lineHeight: 22 }, muted: { color: '#B8CBE0', fontSize: 12 },
  button: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#79B8FF', padding: 10 }, disabled: { opacity: 0.5 } });
