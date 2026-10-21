import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { checkpointDiagnosticsEnabled, runCheckpointNotificationDiagnostic } from '@/services/CheckpointNotificationDiagnostic';

type Result = Awaited<ReturnType<typeof runCheckpointNotificationDiagnostic>>;
const yesNo = (value: boolean | null) => value === null ? 'non disponibile' : value ? 'sì' : 'no';

export function CheckpointNotificationDiagnostic() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [seen, setSeen] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!checkpointDiagnosticsEnabled()) return null;

  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(false); setResult(null); setSeen(false);
    try {
      const next = await runCheckpointNotificationDiagnostic();
      if (alive.current) setResult(next);
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
