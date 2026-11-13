import { Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { NetworkPrototypeScreen } from '@/screens/NetworkPrototypeScreen';
import { networkPrototypeEnabled } from '@/services/NetworkPrototypeDemo';

/** Dedicated internal route. No link added to production NETWORK/navigation. */
export default function NetworkPrototypeRoute() {
  const router = useRouter();
  const enabled = networkPrototypeEnabled(__DEV__);
  if (!enabled) return <View style={styles.unavailable}><Stack.Screen options={{ title: 'NETWORK', headerShown: true }} />
    <Text style={styles.text}>Prototipo interno non disponibile in questa build.</Text></View>;
  return <><Stack.Screen options={{ headerShown: false }} /><NetworkPrototypeScreen onClose={() => {
    if (router.canGoBack()) router.back(); else router.replace('/network');
  }} /></>;
}
const styles = StyleSheet.create({
  unavailable: { flex: 1, padding: 24, backgroundColor: '#061B36', justifyContent: 'center' },
  text: { color: '#F4F8FD', fontSize: 18, lineHeight: 27 },
});
