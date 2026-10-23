import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useAuth } from '@/backend/auth/AuthProvider';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';
import { checkpointDiagnosticsEnabled, runCheckpointNotificationDiagnostic } from '@/services/CheckpointNotificationDiagnostic';

type Result = Awaited<ReturnType<typeof runCheckpointNotificationDiagnostic>>;
const yesNo = (value: boolean | null) => value === null ? 'non disponibile' : value ? 'sì' : 'no';

export function CheckpointNotificationDiagnostic() {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const ownerRef = useRef(owner);
  const requestRevision = useRef(0);
  if (ownerRef.current !== owner) requestRevision.current++;
  ownerRef.current = owner;
  const [journal, setJournal] = useState<{ owner: string; text: string } | null>(null);
  const [journalMessage, setJournalMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [seen, setSeen] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setJournal(null); setJournalMessage(null);
    setResult(null); setSeen(false); setError(false);
    if (!owner || !checkpointDiagnosticsEnabled() || !SafeMeLinkSafety?.checkpointDiagnosticsAvailable?.()) return;
    let disposed = false;
    const refresh = async () => {
      if (AppState.currentState !== 'active') return;
      const revision = ++requestRevision.current;
      try {
        const text = await SafeMeLinkSafety!.getCheckpointDiagnosticEvents(owner);
        if (!disposed && ownerRef.current === owner && requestRevision.current === revision) setJournal({ owner, text });
      } catch {
        if (!disposed && ownerRef.current === owner && requestRevision.current === revision) setJournalMessage('Registro non disponibile; nessuna conclusione sull’esito T1.');
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', () => { void refresh(); });
    return () => { disposed = true; subscription.remove(); };
  }, [owner]);
  if (!checkpointDiagnosticsEnabled()) return null;
  if (!SafeMeLinkSafety?.checkpointDiagnosticsAvailable?.()) return null;

  const refreshJournal = async () => {
    const expected = owner;
    if (!expected) return;
    const revision = ++requestRevision.current;
    try {
      const text = await SafeMeLinkSafety!.getCheckpointDiagnosticEvents(expected);
      if (alive.current && ownerRef.current === expected && requestRevision.current === revision) setJournal({ owner: expected, text });
    } catch {
      if (alive.current && ownerRef.current === expected && requestRevision.current === revision) setJournalMessage('Lettura registro non riuscita.');
    }
  };

  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(false); setResult(null); setSeen(false);
    const expectedOwner = owner;
    try {
      const next = await runCheckpointNotificationDiagnostic();
      if (alive.current && ownerRef.current === expectedOwner) setResult(next);
    } catch {
      if (alive.current) setError(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return <View style={{ gap: 10, paddingVertical: 12 }}>
    <Text style={{ color: '#18243D', fontWeight: '700' }}>DIAGNOSTICA APK DI COLLAUDO</Text>
    <Text style={{ color: '#5E6D84' }}>Solo notifica locale: non avvia Checkpoint, timer, SOS o GPS. Non disattiva eventuali protezioni già attive.</Text>
    <Text style={{ color: '#5E6D84' }}>Registro locale, massimo 100 eventi. notify() ritornato NON significa notifica visualizzata o letta. Nessun evento non equivale a prova di mancata esecuzione.</Text>
    {owner ? <View style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => { void refreshJournal(); }} style={{ minHeight: 48, padding: 12 }}>
        <Text>AGGIORNA REGISTRO LOCALE</Text>
      </Pressable>
      <Text selectable style={{ color: '#18243D' }}>{journal?.owner === owner ? journal.text : 'Registro non ancora letto.'}</Text>
      <Pressable accessibilityRole="button" onPress={() => {
        if (ownerRef.current !== owner) return;
        // Synchronous explicit copy: no delayed operation surviving an account change.
        try {
          SafeMeLinkSafety!.copyCheckpointDiagnosticReport(owner, process.env.EXPO_PUBLIC_BUILD_SHA || '');
          setJournalMessage('Rapporto copiato negli appunti su tua richiesta.');
        } catch { setJournalMessage('Copia non riuscita.'); }
      }} style={{ minHeight: 48, padding: 12 }}><Text>COPIA RAPPORTO TECNICO</Text></Pressable>
    </View> : <Text>Accedi per consultare il registro del tuo account.</Text>}
    {journalMessage ? <Text accessibilityLiveRegion="polite">{journalMessage}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run()}
      style={{ minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#AEBBD0', borderRadius: 12, opacity: busy ? 0.5 : 1 }}>
      <Text style={{ color: '#344B75', fontWeight: '700', textAlign: 'center' }}>{busy ? 'TEST NATIVO IN CORSO…' : 'Test notifica Checkpoint'}</Text>
    </Pressable>
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: '#9B2C2C' }}>Test non completato: modulo nativo non disponibile o lettura permessi non riuscita. Nessun esito di pubblicazione confermato.</Text> : null}
    {result ? <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
      <Text selectable style={{ color: '#18243D' }}>{[
        `Permesso Expo: ${result.permissionGranted ? 'concesso' : 'negato'} (richiedibile: ${yesNo(result.canAskAgain)})`,
        `Notifiche abilitate Android: ${yesNo(result.native.notificationsEnabled)}`,
        `Canale safety-checks prima: ${yesNo(result.native.channelExistedBefore)}; dopo: ${yesNo(result.native.channelExists)}`,
        `Importanza canale: ${result.native.importance ?? 'non disponibile'} (HIGH = 4)`,
        `Suono: ${result.native.sound}`,
        `notify() tentato: ${yesNo(result.native.notifyAttempted)}`,
        `Esito nativo: ${result.native.notifyOutcome === 'requested' ? 'PUBBLICAZIONE RICHIESTA — notify() ritornato senza eccezione' : result.native.notifyOutcome === 'rejected' ? 'notify() ha sollevato un errore' : 'notify() non chiamato'}`,
        `Errore: ${result.native.errorCategory ?? 'nessuno'} / ${result.native.errorCode ?? 'nessuno'}`,
        `Notifica vista dall’utente: ${seen ? 'confermata manualmente' : 'NON confermata'}`,
      ].join('\n')}</Text>
      <Text style={{ color: '#5E6D84' }}>La risposta di notify() non prova che Android abbia mostrato o fatto suonare l’avviso. Controlla anche il pannello notifiche.</Text>
      {result.native.notifyOutcome === 'requested' && !seen ? <Pressable accessibilityRole="button" onPress={() => setSeen(true)} style={{ minHeight: 48, padding: 12 }}>
        <Text style={{ color: '#344B75', fontWeight: '700' }}>HO VISTO LA NOTIFICA DI TEST</Text>
      </Pressable> : null}
    </View> : null}
  </View>;
}
