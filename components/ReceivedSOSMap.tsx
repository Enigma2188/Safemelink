import Constants from 'expo-constants';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import type MapView from 'react-native-maps';
import { describePositionAge, type PositionSelection } from '@/services/ReceivedSOSDetail';

type SDK = typeof import('react-native-maps');
type Props = { authorized: boolean; selection: PositionSelection; verifiedAt: number | null };
const unavailable = 'Mappa interna non disponibile in questa versione. Puoi usare “Apri nel navigatore”.';

class MapBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? <Text style={styles.notice}>{unavailable}</Text> : this.props.children; }
}

// Mounted only after an explicit action in an authorized Android SOS detail.
// No GPS acquisition, transport, polling, persistent cache or provider metadata.
export function ReceivedSOSMap({ authorized, selection, verifiedAt }: Props) {
  const [sdk, setSDK] = useState<SDK | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(true);
  const map = useRef<MapView | null>(null);
  const lastCenter = useRef<{ latitude: number; longitude: number } | null>(null);
  const alive = useRef(true);
  const current = useRef({ authorized, position: selection.position });
  current.current = { authorized, position: authorized ? selection.position : null };
  useEffect(() => {
    alive.current = true;
    try {
      if (Platform.OS !== 'android' || Constants.expoConfig?.extra?.androidMapsConfigured !== true ||
        !UIManager.getViewManagerConfig('AIRMap')) {
        setFailed(true);
      } else {
        // Do not load/register the native map SDK when the key/capability is absent.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Intentional lazy native registration after explicit map consent and capability checks.
        setSDK(require('react-native-maps') as SDK);
      }
    } catch { setFailed(true); }
    return () => { alive.current = false; map.current = null; lastCenter.current = null; current.current = { authorized: false, position: null }; };
  }, []);
  useEffect(() => {
    if (!sdk || ready || failed) return;
    const timer = setTimeout(() => { if (alive.current) setFailed(true); }, 10_000);
    return () => clearTimeout(timer);
  }, [sdk, ready, failed]);
  const latitude = authorized ? selection.position?.latitude : undefined;
  const longitude = authorized ? selection.position?.longitude : undefined;
  useEffect(() => {
    const point = current.current.position;
    if (!alive.current || !current.current.authorized || !point || !ready || !following || failed) return;
    if (lastCenter.current?.latitude === point.latitude && lastCenter.current.longitude === point.longitude) return;
    // Partial camera update preserves the user's zoom. Never force a region every render.
    try {
      map.current?.animateCamera({ center: { latitude: point.latitude, longitude: point.longitude } }, { duration: 300 });
      lastCenter.current = { latitude: point.latitude, longitude: point.longitude };
    }
    catch { setFailed(true); }
  }, [latitude, longitude, ready, following, failed, authorized]);
  const recenter = () => {
    const point = current.current.position;
    if (!alive.current || !current.current.authorized || !point || !ready || failed) return;
    setFollowing(true);
    try {
      map.current?.animateCamera({ center: { latitude: point.latitude, longitude: point.longitude } }, { duration: 300 });
      lastCenter.current = { latitude: point.latitude, longitude: point.longitude };
    }
    catch { setFailed(true); }
  };
  const manualMove = () => { if (alive.current && current.current.authorized) setFollowing(false); };
  const NativeMap = sdk?.default;
  const Marker = sdk?.Marker;
  const point = authorized ? selection.position : null;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Mappa Live SOS</Text>
    {failed ? <Text style={styles.notice}>{unavailable}</Text> : <MapBoundary onFailure={() => { if (alive.current) setFailed(true); }}>
      <View style={styles.frame}>
        <View style={StyleSheet.absoluteFill} pointerEvents={authorized && ready ? 'auto' : 'none'}
          importantForAccessibility={authorized && ready ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!authorized || !ready}>
          {NativeMap && Marker ? <NativeMap ref={map} style={StyleSheet.absoluteFill} provider={sdk.PROVIDER_GOOGLE}
            initialRegion={point ? { latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 } : undefined}
            showsUserLocation={false} showsMyLocationButton={false} followsUserLocation={false} toolbarEnabled={false}
            onMapReady={() => { if (alive.current) setReady(true); }} onPanDrag={manualMove}
            onRegionChangeComplete={(_region, details) => { if (details.isGesture) manualMove(); }}>
            {point ? <Marker coordinate={{ latitude: point.latitude, longitude: point.longitude }} title="Posizione SOS" /> : null}
          </NativeMap> : null}
        </View>
        {!authorized || !ready ? <View style={styles.cover} accessibilityLiveRegion="polite">
          <Text style={styles.notice}>{!authorized ? 'Verifica autorizzazione in corso. Posizione nascosta.' : 'Caricamento cartografia…'}</Text>
        </View> : null}
      </View>
    </MapBoundary>}
    {authorized && point ? <>
      <Text style={styles.notice}>{selection.lastKnown ? 'Ultima posizione conosciuta. ' : ''}{describePositionAge(point.observedAt, verifiedAt ?? Date.now())}</Text>
      <Text style={styles.notice}>Ora GPS: {point.observedAt ? new Date(point.observedAt).toLocaleString() : 'non disponibile'}
        {'\n'}Accuratezza: {point.accuracy === null ? 'non disponibile' : `circa ±${Math.round(point.accuracy)} m`}</Text>
      {!failed ? <><Text style={styles.notice}>{following ? 'Segue la posizione SOS.' : 'Esplorazione manuale: il marker continua ad aggiornarsi.'}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready}
          style={styles.button} onPress={recenter}><Text style={styles.buttonText}>RICENTRA</Text></Pressable></> : null}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#11181c' },
  frame: { height: 280, marginTop: 12, overflow: 'hidden', backgroundColor: '#f7f9fb' },
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#f7f9fb', padding: 20, justifyContent: 'center' },
  notice: { color: '#52616b', fontSize: 15, lineHeight: 22, marginTop: 8 },
  button: { minHeight: 48, padding: 14, marginTop: 12, borderRadius: 6, backgroundColor: '#0a7ea4' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
});
