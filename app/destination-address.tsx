import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/backend/auth/AuthProvider';
import { KeyboardSafeScrollView, KeyboardSafeTextInput } from '@/components/KeyboardSafeForm';
import { findDestinationAddress, type DestinationCandidate } from '@/services/DestinationAddressService';
import { GoHomeStorage } from '@/storage/GoHomeStorage';
import { GoHomeDestination } from '@/services/GoHomeDestination';

export default function DestinationAddressScreen() {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [candidates, setCandidates] = useState<DestinationCandidate[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const pending = useRef(false);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { invalidate(); setAddress(''); setCandidates([]); setMessage(''); setBusy(false);
    return invalidate; }, [owner, invalidate]);
  const search = async () => {
    if (!owner || pending.current) return;
    pending.current = true; setBusy(true); setCandidates([]); setMessage('');
    const run = ++generation.current;
    try {
      const rows = await findDestinationAddress(address);
      if (run !== generation.current || currentOwner.current !== owner) return;
      setCandidates(rows); setMessage(rows.length ? 'Controlla l’indirizzo e conferma la destinazione corretta.' : 'Indirizzo non trovato. Specifica via, numero e città.');
    } catch (error) { if (run === generation.current) setMessage(error instanceof Error ? error.message : 'Ricerca non disponibile.'); }
    finally { pending.current = false; if (run === generation.current) setBusy(false); }
  };
  const save = async (candidate: DestinationCandidate, saveAsHome = false) => {
    if (!owner || pending.current) return;
    pending.current = true; setBusy(true);
    const run = generation.current;
    try {
      if (saveAsHome) await GoHomeStorage.saveHomeLocation(owner, { latitude: candidate.latitude, longitude: candidate.longitude });
      if (run === generation.current && currentOwner.current === owner) {
        GoHomeDestination.set(owner, candidate);
        router.back();
      }
    } catch { if (run === generation.current) setMessage('Salvataggio non riuscito. Riprova.'); }
    finally { pending.current = false; if (run === generation.current) setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#080D20' }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <KeyboardSafeScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: 'white', fontSize: 24 }}>Destinazione Torno a casa</Text>
        <Text style={{ color: 'white' }}>Inserisci la destinazione di questo viaggio. Il GPS attuale resta la partenza. Non devi salvarla come Casa.</Text>
        <KeyboardSafeTextInput accessibilityLabel="Indirizzo destinazione" editable={!busy && !!owner} value={address} maxLength={250}
          onChangeText={(value) => { setAddress(value); setCandidates([]); }} placeholder="Via, numero, città" placeholderTextColor="#aaa"
          style={{ color: 'white', borderWidth: 1, borderColor: '#38cfff', padding: 14, minHeight: 48 }} />
        <Pressable disabled={busy || !owner} onPress={() => void search()} style={{ padding: 16, backgroundColor: '#164977', minHeight: 48 }}><Text style={{ color: 'white' }}>{busy ? 'Attendi…' : 'Cerca indirizzo'}</Text></Pressable>
        <Text accessibilityLiveRegion="polite" style={{ color: 'white' }}>{owner ? message : 'Accedi per salvare una destinazione.'}</Text>
        {candidates.map((candidate, index) => <Pressable disabled={busy} key={index} onPress={() => void save(candidate)} style={{ padding: 16, borderWidth: 1, borderColor: '#38cfff', minHeight: 48 }}>
          <Text style={{ color: 'white' }}>{candidate.label}</Text><Text style={{ color: '#38cfff' }}>USA QUESTA DESTINAZIONE</Text>
        </Pressable>)}
        {candidates.map((candidate, index) => <Pressable disabled={busy} key={`home-${index}`} onPress={() => void save(candidate, true)} style={{ padding: 14, minHeight: 48 }}>
          <Text style={{ color: '#BAE6FD' }}>Salva anche come Casa: {candidate.label}</Text>
        </Pressable>)}
        <Pressable onPress={() => router.back()} style={{ padding: 16, minHeight: 48 }}><Text style={{ color: 'white' }}>Annulla</Text></Pressable>
      </KeyboardSafeScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
