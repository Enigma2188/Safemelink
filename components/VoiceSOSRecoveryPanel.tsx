import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { closeVerifiedVoiceSOS, inspectVoiceRecovery, retryRequestedVoiceClosures, voiceRecoveryMessage } from '@/services/VoiceSOSRecoveryActions';
import type { VoiceSOSRecoveryResult } from '@/services/VoiceSOSRecovery';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';

export function VoiceSOSRecoveryPanel({ userId }: { userId: string | null }) {
  const [result, setResult] = useState<VoiceSOSRecoveryResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = useRef(userId); owner.current = userId;
  const revision = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { revision.current++; pending.current = false; setResult(null); setMessage(''); setBusy(false); }, [userId]);

  const verify = useCallback(async () => {
    if (!userId || pending.current) return;
    const request = ++revision.current;
    const current = () => mounted.current && owner.current === userId && revision.current === request;
    pending.current = true; setBusy(true); setResult(null); setMessage('Verifica SOS in corso…');
    try {
      const next = await inspectVoiceRecovery(userId);
      if (!current()) return;
      if (next.kind === 'clear') {
        const released = await VoiceProtectionRuntime.clearVerifiedSuspension(userId, next.attemptId, next.attempt);
        if (!current()) return;
        if (!released) { setMessage('È iniziato un altro tentativo SOS. Ripeti la verifica.'); return; }
        // OFF remains OFF: the lifecycle re-reads the user's saved choice.
        VoiceProtectionRuntime.notifySettingsChanged(userId);
      }
      setResult(next); setMessage(voiceRecoveryMessage(next));
    } catch { if (current()) setMessage('Verifica locale non completata. Nessun blocco SOS rimosso.'); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }, [userId]);

  const retryClosures = async () => {
    if (!userId || pending.current) return;
    const request = ++revision.current;
    const current = () => mounted.current && owner.current === userId && revision.current === request;
    pending.current = true; setBusy(true); setMessage('Recupero delle chiusure già richieste…');
    try {
      const recovered = await retryRequestedVoiceClosures(userId, current);
      if (!current()) return;
      setResult(null);
      setMessage(`Chiusure recuperate: ${recovered.completed.length}. Ancora da verificare: ${recovered.unresolved}.`);
    } catch { if (current()) setMessage('Recupero non completato. Le richieste sono conservate; ripeti la verifica.'); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
    if (current()) await verify();
  };

  const confirmClose = () => {
    const remoteId = result?.kind === 'active' ? result.remoteActiveId : undefined;
    if (!userId || !remoteId || pending.current) return;
    const capturedRevision = revision.current;
    Alert.alert('Concludere il tuo SOS?', 'Conferma soltanto se questa emergenza è terminata. Il server verificherà la chiusura; eventuali altri SOS resteranno aperti.', [
      { text: 'Indietro', style: 'cancel' },
      { text: 'Sì, emergenza terminata', onPress: () => {
        if (pending.current || owner.current !== userId || revision.current !== capturedRevision || !mounted.current) return;
        const request = ++revision.current;
        const current = () => mounted.current && owner.current === userId && revision.current === request;
        pending.current = true; setBusy(true); setMessage('Verifica della chiusura in corso…');
        void closeVerifiedVoiceSOS(userId, remoteId, current).then(() => {
          if (current()) { setResult(null); setMessage('Chiusura confermata. Controllo degli altri blocchi…'); }
        }).catch(() => {
          if (current()) setMessage('Chiusura non confermata. La richiesta eventualmente salvata resta conservata. Riprova la verifica o apri la Home.');
        }).finally(() => { if (current()) { pending.current = false; setBusy(false); void verify(); } });
      } },
    ]);
  };
  return <View style={{ padding: 16, gap: 12, borderColor: '#BDE9FF', borderWidth: 1, borderRadius: 12 }}>
    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Verifica del blocco SOS</Text>
    <Text style={{ color: '#FFFFFF' }}>La verifica controlla il tuo account e i dati locali. Non invia allarmi e non chiude emergenze.</Text>
    <Pressable accessibilityRole="button" disabled={!userId || busy} onPress={() => void verify()} style={{ minHeight: 48, padding: 12 }}>
      <Text style={{ color: '#BDE9FF', fontWeight: '700' }}>{busy ? 'OPERAZIONE IN CORSO…' : 'VERIFICA SOS'}</Text>
    </Pressable>
    {!!result && <Text selectable style={{ color: '#FFFFFF' }}>
      {`Registro SOS: ${result.attempt?.phase ?? 'assente'} · riferimento locale ${result.attempt?.eventId ? 'presente' : 'assente'} · remoto ${result.attempt?.remoteId ? 'presente' : 'assente'}\nEventi locali attivi: ${result.localActiveCount ?? '?'} · chiusure pendenti: ${result.pendingClosures ?? '?'}${result.closureCheckFailed ? ' (verifica non riuscita)' : ''}`}
    </Text>}
    {((result?.pendingClosures ?? 0) > 0 || result?.closureCheckFailed) && <>
      <Text style={{ color: '#FFFFFF' }}>Questo recupero riprende soltanto le chiusure già richieste. Può completarle sul server; non chiude gli altri SOS.</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void retryClosures()} style={{ minHeight: 48, padding: 12 }}>
        <Text style={{ color: '#FFD28E', fontWeight: '700' }}>RIPRENDI CHIUSURE GIÀ RICHIESTE</Text>
      </Pressable>
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" selectable style={{ color: '#FFFFFF' }}>{message}{result?.reason ? `\nCodice: ${result.reason}` : ''}</Text>}
    {result?.kind === 'active' && result.remoteActiveId ? <>
      <Text style={{ color: '#FFFFFF' }}>SOS rilevato: {result.remoteActiveId.slice(0, 8)}. Può essere presente sul server anche se manca nella Home.</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={confirmClose} style={{ minHeight: 48, padding: 12 }}>
        <Text style={{ color: '#FFD28E', fontWeight: '700' }}>CONCLUDI QUESTO SOS…</Text>
      </Pressable>
    </> : null}
    <Link href={'/' as never} style={{ color: '#BDE9FF', padding: 12 }}>Apri Home SOS</Link>
  </View>;
}
