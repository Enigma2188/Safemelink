import Constants from 'expo-constants';
import { getRandomValues } from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getSupabaseClient } from '@/backend/supabaseClient';
import type { NetworkV2RpcClient } from '@/backend/repositories/NetworkV2Repository';
import { createNetworkV2AppComposition, type NetworkV2AuthClient, type NetworkV2Composition } from '@/services/NetworkV2Composition';
import { createNetworkV2OperationId, networkV2Enabled } from '@/services/NetworkV2AppGate';
import { NetworkScreen } from './NetworkScreen';
import { NetworkV2Entry } from './NetworkV2Entry.native';

// App-owned, not view-owned: navigation must not erase an uncertain write. Auth changes
// clear account data through the existing composition. No request is made on import.
let appComposition: NetworkV2Composition | null = null;
function getComposition() {
  if (!networkV2Enabled(process.env.EXPO_PUBLIC_NETWORK_V2_ENABLED)) return null;
  if (appComposition) return appComposition;
  try {
  const client = getSupabaseClient(); if (!client) return null;
  // SDK Database generated types predate the unapplied V2 migration. The only cast is
  // this composition boundary; every RPC request is typed and response validated.
  appComposition = createNetworkV2AppComposition({ enabled: true,
    storage: AsyncStorage,
    client: client as unknown as NetworkV2RpcClient & NetworkV2AuthClient,
    createOperationId: () => createNetworkV2OperationId(bytes => { getRandomValues(bytes); }),
    // World overview, not a fixed municipality or a device/user location.
    initialRegion: { latitude: 0, longitude: 0, latitudeDelta: 120, longitudeDelta: 160 } });
  return appComposition;
  } catch { return null; } // No credentials, SDK error or payload logging.
}
export function NetworkAppScreen() {
  const router = useRouter(); const [legacy, setLegacy] = useState(false);
  const [composition] = useState(getComposition);
  if (!networkV2Enabled(process.env.EXPO_PUBLIC_NETWORK_V2_ENABLED)) return <NetworkScreen />;
  const mapsReady = Platform.OS === 'ios' || Constants.expoConfig?.extra?.androidMapsConfigured === true;
  return <View style={styles.root}>
    <View style={styles.toolbar}><Pressable accessibilityRole="button" onPress={() => setLegacy(v => !v)} style={styles.button}>
      <Text style={styles.text}>{legacy ? 'Apri mappa NETWORK 2.0' : 'NETWORK precedente · accesso e consensi'}</Text>
    </Pressable></View>
    {legacy ? <NetworkScreen /> : composition ? <NetworkV2Entry composition={composition} configuration={mapsReady ? 'READY' : 'MISSING'}
      mapProvider={Platform.OS === 'android' ? 'GOOGLE_ANDROID' : 'PLATFORM_DEFAULT'} onClose={() => router.back()} /> :
      <Text accessibilityRole="alert" style={styles.error}>NETWORK 2.0 non configurato. Usa il NETWORK precedente; nessun dato dimostrativo viene caricato.</Text>}
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#061B36' }, toolbar: { padding: 8 },
  button: { minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 10, borderColor: '#79B8FF', borderWidth: 1 },
  text: { color: '#DDEFFF', fontSize: 14 }, error: { color: '#FFE2A3', padding: 20, fontSize: 16 } });
