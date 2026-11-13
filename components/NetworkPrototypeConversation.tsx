/** Local development prototype only. No persistence, transport or real moderation. */
import { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NetworkDemoEvent } from '@/services/NetworkPrototypeDemo';

export type NetworkDemoComment = Readonly<{
  id: string; eventPublicId: string; nickname: string; createdAt: string;
  body: string; state: 'VISIBLE' | 'HIDDEN' | 'DELETED';
}>;
export const DEMO_COMMENT_MAX_LENGTH = 500;
export function seedNetworkDemoComments(events: readonly NetworkDemoEvent[]): readonly NetworkDemoComment[] {
  return events.flatMap(event => {
    if (!('authorNickname' in event.detail)) return [];
    const { marker, authorNickname } = event.detail;
    return [
      { id: `comment-demo-${marker.publicId}-1`, eventPublicId: marker.publicId, nickname: authorNickname,
        createdAt: marker.createdAt, body: 'Conversazione di esempio: condividiamo informazioni utili, senza dati personali.', state: 'VISIBLE' as const },
      { id: `comment-demo-${marker.publicId}-2`, eventPublicId: marker.publicId, nickname: 'Demo_Vicinato',
        createdAt: marker.updatedAt, body: 'Grazie per le informazioni! Questo messaggio è soltanto dimostrativo.', state: 'VISIBLE' as const },
    ];
  });
}
export function appendNetworkDemoComment(comments: readonly NetworkDemoComment[], events: readonly NetworkDemoEvent[],
  comment: NetworkDemoComment): readonly NetworkDemoComment[] {
  const event = events.find(entry => entry.detail.marker.publicId === comment.eventPublicId);
  const body = comment.body.trim();
  if (!event || event.detail.marker.kind !== 'OPERATIONAL_EVENT' || !body || body.length > DEMO_COMMENT_MAX_LENGTH ||
    comment.nickname !== 'Demo_Tu' || comment.state !== 'VISIBLE' || !Number.isFinite(Date.parse(comment.createdAt)) ||
    comments.some(item => item.id === comment.id) ||
    comments.filter(item => item.eventPublicId === comment.eventPublicId && item.nickname === 'Demo_Tu').length >= 30) return comments;
  return [...comments, { ...comment, body }];
}
export function NetworkPrototypeConversation({ eventPublicId, authorNickname, comments, onPublish }: {
  eventPublicId: string; authorNickname: string; comments: readonly NetworkDemoComment[];
  onPublish: (comment: NetworkDemoComment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const sequence = useRef(0);
  const rows = comments.filter(item => item.eventPublicId === eventPublicId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const localLimit = rows.filter(item => item.nickname === 'Demo_Tu').length >= 30;
  const publish = () => {
    const body = draft.trim();
    if (!body || body.length > DEMO_COMMENT_MAX_LENGTH || localLimit) return;
    // Clear the input ref synchronously: stale/double press callbacks cannot duplicate a post.
    if (lastSubmitted.current === draft) return;
    lastSubmitted.current = draft;
    onPublish({ id: `local-comment-${eventPublicId}-${Date.now()}-${++sequence.current}`,
      eventPublicId, nickname: 'Demo_Tu', createdAt: new Date().toISOString(), body, state: 'VISIBLE' });
    setDraft(''); setFeedback('Commento pubblicato soltanto nella demo locale. Nessun invio reale.');
  };
  const lastSubmitted = useRef<string | null>(null);
  return <View style={s.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Chiudi conversazione demo' : 'Apri conversazione demo'}
      accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={s.heading}>
      <View style={s.flex}><Text style={s.title}>Conversazione</Text><Text style={s.sub}>{rows.length} commenti · solo demo</Text></View>
      <Ionicons accessible={false} name={open ? 'chevron-up' : 'chatbubbles-outline'} size={24} color="#BDE9FF" />
    </Pressable>
    {open ? <>
      <Text style={s.notice}>Spazio dimostrativo locale. Non inserire dati personali. Segnalazione, moderazione e blocco utenti non sono servizi attivi.</Text>
      {rows.map(item => <View key={item.id} style={s.comment}>
        <View style={s.avatar}><Text style={s.avatarText}>{item.nickname.replace('Demo_', '').slice(0, 1)}</Text></View>
        <View style={s.flex}><View style={s.identity}><Text style={s.nickname}>{item.nickname}</Text>
          {item.nickname === authorNickname ? <Text style={s.badge}>AUTORE</Text> : null}</View>
          <Text style={s.date}>{new Date(item.createdAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>
          <Text style={s.body}>{item.state === 'VISIBLE' ? item.body : item.state === 'HIDDEN' ? 'Commento nascosto · demo' : 'Commento eliminato · demo'}</Text>
          {item.state === 'VISIBLE' ? <Pressable accessibilityRole="button" accessibilityLabel={`Segnala commento demo ${item.id}`}
            disabled={reported.has(item.id)} onPress={() => { setReported(old => new Set([...old, item.id])); setFeedback('Segnalazione registrata solo in questa anteprima. Nessun moderatore è stato avvisato.'); }} style={s.report}>
            <Text style={s.reportText}>{reported.has(item.id) ? 'Segnalato · demo' : 'Segnala · demo'}</Text>
          </Pressable> : null}
        </View>
      </View>)}
      <View style={s.composer}><Text style={s.nickname}>Demo_Tu</Text>
        <TextInput accessibilityLabel="Scrivi un commento demo" placeholder="Aggiungi un messaggio utile…" placeholderTextColor="#A7C5DC"
          multiline maxLength={DEMO_COMMENT_MAX_LENGTH} value={draft} onChangeText={value => { lastSubmitted.current = null; setDraft(value); setFeedback(''); }} style={s.input} />
        <View style={s.heading}><Text style={[s.sub, s.flex]}>{draft.length}/{DEMO_COMMENT_MAX_LENGTH}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Pubblica commento demo" disabled={!draft.trim() || localLimit}
            accessibilityState={{ disabled: !draft.trim() || localLimit }} onPress={publish} style={[s.publish, (!draft.trim() || localLimit) && s.disabled]}>
            <Ionicons accessible={false} name="send" size={18} color="#061B36" /><Text style={s.publishText}>Pubblica</Text>
          </Pressable></View>
        {localLimit ? <Text style={s.notice}>Limite dimostrativo raggiunto: 30 commenti locali per evento.</Text> : null}
      </View>
      {feedback ? <Text accessibilityLiveRegion="polite" style={s.feedback}>{feedback}</Text> : null}
    </> : null}
  </View>;
}
const s = StyleSheet.create({
  section: { borderRadius: 16, borderWidth: 1, borderColor: '#456C8C', padding: 14, gap: 14, backgroundColor: '#10314C' },
  flex: { flex: 1, minWidth: 0 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  title: { color: '#F4F8FD', fontSize: 19, fontWeight: '800' }, sub: { color: '#B8CBE0', fontSize: 13, lineHeight: 19 },
  notice: { color: '#C8DDF0', fontSize: 13, lineHeight: 20 }, comment: { flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#315570' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#275573', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#D4EEFF', fontSize: 16, fontWeight: '800' }, identity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  nickname: { color: '#D4EEFF', fontSize: 15, fontWeight: '700' }, badge: { color: '#061B36', backgroundColor: '#BDE9FF', borderRadius: 5, padding: 3, fontSize: 10, fontWeight: '800' },
  date: { color: '#A7C5DC', fontSize: 12, marginVertical: 4 }, body: { color: '#E2ECF6', fontSize: 15, lineHeight: 23 },
  report: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' }, reportText: { color: '#BDE9FF', fontSize: 12 },
  composer: { gap: 8, backgroundColor: '#08233F', padding: 12, borderRadius: 14 }, input: { minHeight: 88, maxHeight: 160, color: '#F4F8FD', fontSize: 16, lineHeight: 23, textAlignVertical: 'top', padding: 8, borderWidth: 1, borderColor: '#527B9D', borderRadius: 10 },
  publish: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#BDE9FF' },
  publishText: { color: '#061B36', fontSize: 15, fontWeight: '800' }, disabled: { opacity: 0.5 }, feedback: { color: '#A8E7D8', fontSize: 13, lineHeight: 20 },
});
