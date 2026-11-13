import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NetworkOperationalDetailV2 } from '@/services/NetworkMapContractV2';

/** Future authorized presenters/actions. No local imitation of persistence/social RPCs. */
export type NetworkV2SocialSlots = Partial<Record<'confirmations' | 'follow' | 'conversation' | 'activity', (detail: NetworkOperationalDetailV2) => ReactNode>>;
export function NetworkEventSocial({ detail, slots = {} }: { detail: NetworkOperationalDetailV2; slots?: NetworkV2SocialSlots }) {
  return <View style={s.card}>
    <Text style={s.title}>Partecipazione</Text>
    {slots.confirmations ? slots.confirmations(detail) : <>
      <Text style={s.body}>{detail.confirmations.confirmedCount} conferme · {detail.confirmations.noLongerPresentCount} non più presenti</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={s.disabled}><Text style={s.body}>Confermo · funzione non collegata</Text></Pressable>
    </>}
    {slots.follow ? slots.follow(detail) : <Text style={s.muted}>Segui segnalazione: non disponibile, nessuna iscrizione attivata.</Text>}
    {slots.conversation ? slots.conversation(detail) : <Text style={s.muted}>Conversazione: RPC non disponibile. Nessun commento locale nel percorso reale.</Text>}
    {slots.activity ? slots.activity(detail) : <Text style={s.muted}>Attività recente della comunità: servizio non collegato.</Text>}
    {detail.updates.length ? <View><Text style={s.title}>Aggiornamenti dell’autore</Text>{detail.updates.map(update => <View key={update.publicId} style={s.update}>
      <Text style={s.body}>{update.body}</Text><Text style={s.muted}>{new Date(update.createdAt).toLocaleString()}</Text>
    </View>)}</View> : null}
  </View>;
}
const s = StyleSheet.create({ card: { padding: 14, gap: 12, borderRadius: 16, backgroundColor: '#123957' },
  title: { color: '#F4F8FD', fontSize: 17, fontWeight: '700' }, body: { color: '#E2ECF6', fontSize: 15, lineHeight: 22 },
  muted: { color: '#B8CBE0', fontSize: 13, lineHeight: 20 }, disabled: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#527B9D', borderRadius: 12, padding: 10, opacity: 0.65 },
  update: { paddingVertical: 10, gap: 5 } });
