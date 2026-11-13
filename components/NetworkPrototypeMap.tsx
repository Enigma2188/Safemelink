import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type MapView from 'react-native-maps';
import { NETWORK_CATEGORY_REGISTRY_V2 } from '@/services/NetworkCategoryRegistryV2';
import { NETWORK_DEMO_CENTER, type NetworkDemoCluster } from '@/services/NetworkPrototypeDemo';

type SDK = typeof import('react-native-maps');
type Props = { clusters: readonly NetworkDemoCluster[]; radiusMeters: number; recenterToken: number;
  topInset: number; bottomInset: number;
  onSelect: (cluster: NetworkDemoCluster) => void; onZoom: (cellMeters: number) => void };
export const NETWORK_PROTOTYPE_ICONS = { CIVIC_SAFETY: 'shield-checkmark-outline', ROADS_TRAFFIC: 'car-outline',
  LIGHTING: 'bulb-outline', ENVIRONMENT_DECORUM: 'leaf-outline', COMMUNITY_INFORMATION: 'information-circle-outline' } as const;
const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#153247' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#C8D8E5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#153247' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#31536B' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1E554F' }] },
];
class MapBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function NetworkPrototypeMap({ clusters, radiusMeters, recenterToken, topInset, bottomInset, onSelect, onZoom }: Props) {
  const [sdk, setSDK] = useState<SDK | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('Schema offline · cartografia nativa da verificare');
  const [size, setSize] = useState({ width: 390, height: 700 });
  const map = useRef<MapView | null>(null);
  const alive = useRef(true);
  const delta = radiusMeters / 111000 * 2.6;
  const bottomPadding = Math.min(bottomInset, Math.max(0, size.height - 96));
  const topPadding = Math.min(topInset, Math.max(0, size.height - bottomPadding - 96));
  const usableHeight = Math.max(96, size.height - topPadding - bottomPadding);
  useEffect(() => {
    alive.current = true;
    try {
      if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
        setNotice('Schema offline · cartografia nativa non disponibile sul web');
      } else if (!UIManager.getViewManagerConfig('AIRMap') ||
        (Platform.OS === 'android' && Constants.expoConfig?.extra?.androidMapsConfigured !== true)) {
        setNotice('Schema offline · modulo o configurazione cartografica assenti');
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Lazy registration after capability checks, as in the existing map.
        setSDK(require('react-native-maps') as SDK);
        setNotice('Caricamento cartografia · solo segnalazioni demo');
      }
    } catch { setNotice('Schema offline · cartografia non disponibile'); }
    return () => { alive.current = false; map.current = null; };
  }, []);
  useEffect(() => {
    if (!sdk || ready) return;
    const timeout = setTimeout(() => {
      if (alive.current) { setSDK(null); setNotice('Schema offline · cartografia non pronta'); }
    }, 10000);
    return () => clearTimeout(timeout);
  }, [sdk, ready]);
  useEffect(() => {
    if (!ready) return;
    try { map.current?.animateToRegion({ ...NETWORK_DEMO_CENTER, latitudeDelta: delta, longitudeDelta: delta / 0.71 }, 280); }
    catch { setSDK(null); setReady(false); setNotice('Schema offline · errore cartografico'); }
  }, [delta, ready, recenterToken]);
  const NativeMap = sdk?.default, Marker = sdk?.Marker;
  const markerContent = (cluster: NetworkDemoCluster) => {
    const multiple = cluster.entries.length > 1;
    const category = cluster.entries[0].detail.marker.categoryId;
    return <View style={[styles.pin, { backgroundColor: multiple ? '#F0F6FC' : NETWORK_CATEGORY_REGISTRY_V2[category].color }]}>
      {multiple ? <Text style={styles.pinText}>{cluster.entries.length}</Text> :
        <Ionicons accessible={false} name={NETWORK_PROTOTYPE_ICONS[category]} size={24} color="#061B36" />}
    </View>;
  };
  return <View style={StyleSheet.absoluteFill} onLayout={event => setSize(event.nativeEvent.layout)}>
    <View style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 400 850" preserveAspectRatio="none" accessible={false}>
        <Rect width="400" height="850" fill="#153247" />
        <Path d="M0 320 L100 290 L145 390 L80 520 L0 490Z M260 0 L400 0 L400 300 L340 290 L290 150Z M250 680 L400 610 L400 850 L300 850Z" fill="#20564F" />
        <Path d="M-30 600 L430 240 M110 -20 L170 290 L120 570 L210 880 M-20 470 L420 510 M-20 230 L440 650" stroke="#34566D" strokeWidth="30" fill="none" />
        <Path d="M-30 600 L430 240 M110 -20 L170 290 L120 570 L210 880 M-20 470 L420 510 M-20 230 L440 650" stroke="#7891A3" strokeWidth="4" fill="none" />
        <Path d="M0 350 L400 380 M50 0 L300 850 M300 0 L250 850 M0 700 L400 730" stroke="#34566D" strokeWidth="9" fill="none" />
      </Svg>
      {!NativeMap ? clusters.map(cluster => {
        const x = 0.5 + (cluster.coordinate.longitude - NETWORK_DEMO_CENTER.longitude) / (delta / 0.71);
        const y = 0.5 - (cluster.coordinate.latitude - NETWORK_DEMO_CENTER.latitude) / delta;
        if (x < 0.03 || x > 0.97 || y < 0.03 || y > 0.97) return null;
        return <Pressable key={cluster.id} accessibilityRole="button"
          accessibilityLabel={cluster.entries.length > 1 ? `Apri gruppo di ${cluster.entries.length} eventi demo` : `Apri ${cluster.entries[0].title}, demo`}
          onPress={() => onSelect(cluster)} style={[styles.offlinePin, { left: x * (size.width - 80), top: topPadding + y * usableHeight }]}>
          {markerContent(cluster)}
        </Pressable>;
      }) : null}
    </View>
    {NativeMap && Marker ? <MapBoundary onFailure={() => { if (alive.current) { setSDK(null); setReady(false); setNotice('Schema offline · errore del modulo mappa'); } }}>
      <NativeMap ref={map} style={StyleSheet.absoluteFill} provider={Platform.OS === 'android' ? sdk?.PROVIDER_GOOGLE : undefined}
        initialRegion={{ ...NETWORK_DEMO_CENTER, latitudeDelta: delta, longitudeDelta: delta / 0.71 }} customMapStyle={mapStyle}
        mapPadding={{ top: topPadding, bottom: bottomPadding, left: 12, right: 80 }}
        showsUserLocation={false} showsMyLocationButton={false} followsUserLocation={false} toolbarEnabled={false}
        onMapReady={() => { if (alive.current) { setReady(true); setNotice('Cartografia nativa · tutti gli eventi sono inventati'); } }}
        onRegionChangeComplete={region => { if (alive.current) onZoom(Math.max(60, Math.min(600, region.latitudeDelta * 111000 / 8))); }}>
        {clusters.map(cluster => <Marker key={cluster.id} coordinate={cluster.coordinate}
          title={cluster.entries.length > 1 ? `${cluster.entries.length} eventi DEMO` : `${cluster.entries[0].title} · DEMO`}
          onPress={() => onSelect(cluster)}>{markerContent(cluster)}</Marker>)}
      </NativeMap>
    </MapBoundary> : null}
    <View pointerEvents="none" style={[styles.mapNotice, { top: topPadding + usableHeight - 65 }]}>
      <Text style={styles.notice}>{notice}{!ready ? '\nDisegno illustrativo: non è la pianta di Cavriago.' : ''}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  pin: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: '#061B36', alignItems: 'center', justifyContent: 'center' },
  pinText: { color: '#061B36', fontSize: 23, fontWeight: '800' },
  offlinePin: { position: 'absolute', marginLeft: -24, marginTop: -24, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  mapNotice: { position: 'absolute', left: 12, right: 92, top: '40%', padding: 8, borderRadius: 10, backgroundColor: '#061B36E8' },
  notice: { color: '#D5E6F5', fontSize: 12, lineHeight: 17 },
});
