import * as Contacts from 'expo-contacts';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, Text, View } from 'react-native';

export function ContactPickerButton({ disabled, onPick }: {
  disabled: boolean; onPick: (name: string, phone: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const [permissionMessage, setPermissionMessage] = useState('');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void Contacts.getPermissionsAsync().then(permission => {
        if (active.current) setPermissionMessage(permission.granted ? 'Rubrica autorizzata. Premi SCEGLI DALLA RUBRICA.' : 'Rubrica non autorizzata. Puoi continuare manualmente.');
      }).catch(() => {});
    });
    return () => listener.remove();
  }, []);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const choose = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      let permission = await Contacts.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Contacts.requestPermissionsAsync();
      if (!active.current) return;
      if (!permission.granted) {
        Alert.alert('Accesso alla rubrica', 'Puoi inserire il contatto manualmente oppure consentire l’accesso nelle impostazioni.',
          [{ text: 'Chiudi' }, { text: 'Impostazioni', onPress: () => { void Linking.openSettings().catch(() => {}); } }]);
        return;
      }
      // Native picker provides search; no address book is copied into application storage.
      const contact = await Contacts.presentContactPickerAsync();
      if (!active.current || !contact) return;
      const numbers = [...new Set((contact.phoneNumbers ?? []).map((p) => p.number?.trim()).filter((p): p is string => Boolean(p)))];
      if (!numbers.length) { Alert.alert('Nessun telefono', 'Questo contatto non contiene numeri. Puoi inserirlo manualmente.'); return; }
      const confirm = (phone: string) => {
        if (!active.current) return;
        Alert.alert('Usare questo contatto?', 'Nome e telefono sostituiranno i campi del modulo. Controlla il prefisso internazionale prima di salvare.', [
          { text: 'Annulla', style: 'cancel' },
          { text: 'Usa contatto', onPress: () => { if (active.current) onPick(contact.name ?? '', phone); } },
        ]);
      };
      if (numbers.length === 1) confirm(numbers[0]);
      else setChoices({ name: contact.name ?? '', numbers });
    } catch { if (active.current) Alert.alert('Rubrica non disponibile', 'Il selettore Android non si è aperto. Verifica di usare la nuova APK con il modulo Rubrica e che sul telefono sia disponibile un’app Contatti. Puoi sempre inserire il contatto manualmente.'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const [choices, setChoices] = useState<{ name: string; numbers: string[] } | null>(null);
  return <View>
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={() => void choose()} style={{ padding: 14, minHeight: 48, backgroundColor: '#164977', borderRadius: 12 }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{busy ? 'Apertura rubrica…' : 'SCEGLI DALLA RUBRICA'}</Text>
    </Pressable>
    {permissionMessage ? <Text style={{ color: '#BAE6FD' }}>{permissionMessage}</Text> : null}
    {choices && <View><Text style={{ color: '#FFFFFF' }}>Scegli il numero da usare nel modulo:</Text>
      {choices.numbers.map((phone) => <Pressable key={phone} style={{ padding: 14, minHeight: 48 }} onPress={() => {
        Alert.alert('Sostituire i campi?', 'Controlla il prefisso internazionale prima di salvare.', [
          { text: 'Annulla', style: 'cancel' }, { text: 'Usa numero', onPress: () => {
            if (active.current) { onPick(choices.name, phone); setChoices(null); }
          } },
        ]);
      }}><Text style={{ color: '#BAE6FD' }}>{phone}</Text></Pressable>)}
      <Pressable style={{ padding: 14, minHeight: 48 }} onPress={() => setChoices(null)}><Text style={{ color: '#BAE6FD' }}>Annulla scelta</Text></Pressable>
    </View>}
  </View>;
}
