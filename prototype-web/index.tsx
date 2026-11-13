import { registerRootComponent } from 'expo';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NetworkPrototypeScreen } from '../screens/NetworkPrototypeScreen';

/** No Router/Auth/SOS providers. This preview can never mount the operational app. */
export function NetworkWebPreview() {
  const [closed, setClosed] = useState(false);
  if (!__DEV__) return <View style={s.message}><Text style={s.text}>Prototipo disponibile soltanto in sviluppo.</Text></View>;
  return <SafeAreaProvider style={s.root}>
    {closed ? <View style={s.message}><Text style={s.text}>Anteprima locale chiusa. Nessuna modifica salvata.</Text>
      <Pressable accessibilityRole="button" style={s.button} onPress={() => setClosed(false)}><Text style={s.buttonText}>Riapri NETWORK demo</Text></Pressable>
    </View> : <NetworkPrototypeScreen onClose={() => setClosed(true)} />}
  </SafeAreaProvider>;
}
const s = StyleSheet.create({
  root: { flex: 1 }, message: { flex: 1, padding: 32, backgroundColor: '#061B36', alignItems: 'center', justifyContent: 'center', gap: 20 },
  text: { color: '#F4F8FD', fontSize: 18, lineHeight: 27 }, button: { padding: 16, minHeight: 48, borderRadius: 12, backgroundColor: '#BDE9FF' },
  buttonText: { color: '#061B36', fontSize: 17, fontWeight: '700' },
});
registerRootComponent(NetworkWebPreview);
