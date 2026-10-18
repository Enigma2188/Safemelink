import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/backend/auth/AuthProvider';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';

type Warning = { owner: string; generation: string };

// A normal-flow banner, NOT a modal/overlay: confirmation and cancellation stay
// accessible in the screen below. No timer/runtime mutation belongs here.
export function CheckpointNotificationWarning() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const [warning, setWarning] = useState<Warning | null>(null);
  const [acknowledgementFailed, setAcknowledgementFailed] = useState(false);
  useEffect(() => {
    setWarning(null);
    setAcknowledgementFailed(false);
    if (Platform.OS !== 'android' || !userId || isInitializing || !SafeMeLinkSafety) return;
    let disposed = false;
    const inspect = () => {
      if (disposed || AppState.currentState !== 'active') return;
      try {
        const raw = SafeMeLinkSafety!.getCheckpointNoticeFailure(userId);
        if (!raw) { setWarning(null); return; }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !('generation' in parsed) || typeof parsed.generation !== 'string' || !parsed.generation) {
          throw new Error('Invalid notification warning');
        }
        setWarning({ owner: userId, generation: parsed.generation });
      } catch {
        setWarning({ owner: userId, generation: '' });
        setAcknowledgementFailed(true);
      }
    };
    const nativeSubscription = SafeMeLinkSafety.addListener('onCheckpointNoticeFailed', inspect);
    const appSubscription = AppState.addEventListener('change', inspect);
    inspect();
    return () => { disposed = true; nativeSubscription.remove(); appSubscription.remove(); };
  }, [userId, isInitializing]);

  if (Platform.OS !== 'android' || !warning || warning.owner !== userId || isInitializing) return null;
  return <SafeAreaView edges={['top']} style={{ maxHeight: '35%', backgroundColor: '#29354D' }}>
    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
      <View accessibilityLiveRegion="assertive">
        <Text accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>{warning.generation ? 'AVVISO CHECKPOINT NON MOSTRATO' : 'AVVISO CHECKPOINT NON VERIFICABILE'}</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{warning.generation
          ? 'Un avviso “Stai bene?” non è stato mostrato. Il SOS automatico rimane previsto alla scadenza se non rispondi. Puoi rispondere o disattivare Checkpoint nella Home; se il tempo è già scaduto, verifica lo stato SOS.'
          : 'Non è stato possibile leggere l’avviso Checkpoint. Questo non annulla i timer o il SOS automatico. Verifica lo stato nella Home.'}</Text>
        {acknowledgementFailed && warning.generation ? <Text style={{ color: '#FFB4B4', fontSize: 16 }}>Presa visione non salvata. Puoi comunque usare i controlli Checkpoint nella Home.</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Ho capito: il SOS automatico rimane previsto"
        style={{ minHeight: 48, padding: 12 }} onPress={() => {
          if (warning.owner !== ownerRef.current) return;
          if (!warning.generation) { setWarning(null); return; }
          try {
            if (!SafeMeLinkSafety?.acknowledgeCheckpointNoticeFailure(warning.owner, warning.generation)) {
              setAcknowledgementFailed(true); return;
            }
            setWarning(null); setAcknowledgementFailed(false);
          } catch { setAcknowledgementFailed(true); }
        }}>
        <Text style={{ color: '#8FDFFF', fontSize: 16, fontWeight: '700' }}>HO CAPITO — NON MODIFICA IL TIMER</Text>
      </Pressable>
    </ScrollView>
  </SafeAreaView>;
}
