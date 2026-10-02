import * as Contacts from 'expo-contacts';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeForm';

type Choice = { id: string; name: string; numbers: string[] };
export function ContactPickerButton({ disabled, onPick }: {
  disabled: boolean; onPick: (name: string, phone: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [rows, setRows] = useState<Choice[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Choice | null>(null);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const active = useRef(true);
  const inFlight = useRef(false);
  const close = () => {
    generation.current++; inFlight.current = false;
    setVisible(false); setBusy(false); setRows([]); setQuery(''); setSelected(null);
  };
  useEffect(() => {
    active.current = true;
    const requestGeneration = generation;
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void Contacts.getPermissionsAsync().then(permission => {
        if (active.current) setMessage(permission.granted ? 'Rubrica autorizzata. Premi SCEGLI DALLA RUBRICA.' : 'Rubrica non autorizzata. Inserimento manuale disponibile.');
      }).catch(() => {});
    });
    return () => { active.current = false; requestGeneration.current++; listener.remove(); };
  }, []);
  const choose = async () => {
    if (disabled || inFlight.current) return;
    const run = ++generation.current;
    const current = () => active.current && generation.current === run;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      let permission = await Contacts.getPermissionsAsync();
      if (!current()) return;
      if (!permission.granted && permission.canAskAgain) permission = await Contacts.requestPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) {
        setMessage('Rubrica non autorizzata. Inserimento manuale disponibile.');
        Alert.alert('Accesso alla rubrica', 'Consenti l’accesso per scegliere un contatto oppure continua manualmente.',
          [{ text: 'Chiudi' }, { text: 'Impostazioni', onPress: () => { void Linking.openSettings().catch(() => {}); } }]);
        return;
      }
      // Explicit Android selector, independent of the manufacturer's ACTION_PICK app.
      setRows([]); setSelected(null); setQuery(''); setVisible(true);
      const loaded: Choice[] = [];
      let offset = 0;
      let more = true;
      while (more && current()) {
        const page = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers], pageSize: 200, pageOffset: offset });
        if (!current()) return;
        for (const contact of page.data) loaded.push({ id: contact.id ?? String(offset + loaded.length), name: contact.name || 'Contatto senza nome',
          numbers: [...new Set((contact.phoneNumbers ?? []).map(p => p.number?.trim()).filter((p): p is string => Boolean(p)))] });
        offset += page.data.length;
        more = page.hasNextPage && page.data.length > 0;
        setRows([...loaded]);
      }
    } catch {
      if (current()) setMessage('Rubrica non disponibile. Verifica il permesso e la nuova APK; puoi continuare manualmente.');
    } finally {
      if (current()) { inFlight.current = false; setBusy(false); }
    }
  };
  const confirm = (contact: Choice, phone: string) => {
    const run = generation.current;
    Alert.alert('Usare questo contatto?', 'Nome e numero compileranno il modulo. Controlla il prefisso e premi Salva per aggiungerlo.', [
      { text: 'Annulla', style: 'cancel' }, { text: 'USA CONTATTO', onPress: () => {
        if (active.current && generation.current === run) { onPick(contact.name, phone); close(); }
      } },
    ]);
  };
  const button = { padding: 16, minHeight: 48, backgroundColor: '#164977', borderRadius: 12 };
  const text = { color: '#FFFFFF', fontSize: 16 };
  return <View>
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={() => void choose()} style={button}>
      <Text style={text}>{busy ? 'Apertura rubrica…' : 'SCEGLI DALLA RUBRICA'}</Text>
    </Pressable>
    {message ? <Text style={{ color: '#BAE6FD' }}>{message}</Text> : null}
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#080D20' }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={{ ...text, fontSize: 24 }}>Scegli dalla rubrica</Text>
            <Pressable accessibilityRole="button" onPress={close} style={button}><Text style={text}>ANNULLA</Text></Pressable>
            <KeyboardSafeTextInput accessibilityLabel="Cerca nella rubrica" value={query} onChangeText={setQuery}
              placeholder="Cerca nome o numero" placeholderTextColor="#BAE6FD" style={{ ...text, minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#38CFFF' }} />
            {message ? <Text style={text}>{message}</Text> : null}
            {busy ? <Text style={text}>Caricamento contatti…</Text> : null}
          </View>
          {selected ? <FlatList data={selected.numbers} keyExtractor={phone => phone} keyboardShouldPersistTaps="handled"
            ListHeaderComponent={<Pressable style={button} onPress={() => setSelected(null)}><Text style={text}>Indietro · {selected.name}</Text></Pressable>}
            renderItem={({ item }) => <Pressable style={button} onPress={() => confirm(selected, item)}><Text style={text}>{item}</Text></Pressable>} /> :
            <FlatList data={rows.filter(row => `${row.name} ${row.numbers.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))}
              keyExtractor={row => row.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 8 }}
              ListEmptyComponent={!busy ? <Text style={text}>Nessun contatto trovato.</Text> : null}
              renderItem={({ item }) => <Pressable accessibilityRole="button" style={button} onPress={() => {
                if (!item.numbers.length) Alert.alert('Nessun telefono', 'Questo contatto non ha numeri. Puoi inserirlo manualmente.');
                else if (item.numbers.length === 1) confirm(item, item.numbers[0]);
                else setSelected(item);
              }}><Text style={text}>{item.name}</Text></Pressable>} />}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </View>;
}
