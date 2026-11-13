import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type MapView from 'react-native-maps';
import { NETWORK_CATEGORY_REGISTRY_V2 } from '@/services/NetworkCategoryRegistryV2';
import { clusterNetworkMapPoints, networkMapPadding, prepareNetworkMapPoints, validNetworkMapRegion } from './NetworkMapModel';
import type { NetworkMapProps, NetworkMapRegion } from './NetworkMap.types';

type SDK = typeof import('react-native-maps');
const paths = {
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z',
  road: 'M8 2 4 22M16 2l4 20M12 3v4m0 3v4m0 3v4',
  lightbulb: 'M9 18h6m-6 3h6M8 14a7 7 0 1 1 8 0l-1 2H9Z',
  leaf: 'M20 3C3 1 1 14 7 18S23 17 20 3ZM5 21 17 7',
  information: 'M12 10v8m0-13v1M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
} as const;
const statusLabels = { ACTIVE: 'Attiva', RESOLVED: 'Conclusa', CONCLUDED: 'Storico revisionato' };
class MapBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}
function Notice({ message, retry }: { message: string; retry?: () => void }) {
  return <View style={styles.unavailable}><Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>
    {retry ? <Pressable accessibilityRole="button" accessibilityLabel="Riprova caricamento mappa" onPress={retry} style={styles.button}><Text style={styles.buttonText}>Riprova mappa</Text></Pressable> : null}
  </View>;
}
/** Presentation only. Never mount this with raw/private/unapproved records. */
export function NetworkMap(props: NetworkMapProps) {
  const [attempt, setAttempt] = useState(0);
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return <Notice message="Cartografia nativa disponibile solo su Android e iOS." />;
  if (props.configuration !== 'READY') return <Notice message="Cartografia non configurata in questa versione." />;
  if (!props.camera || typeof props.camera.requestId !== 'string' || !props.camera.requestId || !validNetworkMapRegion(props.camera.region) ||
    !props.snapshot || typeof props.snapshot.scopeKey !== 'string' || !props.snapshot.scopeKey.trim()) return <Notice message="Parametri cartografici non validi." />;
  return <NativeSession key={`${props.snapshot.scopeKey}:${attempt}`} {...props} onRetry={() => setAttempt(value => value + 1)} />;
}
function NativeSession({ onRetry, ...props }: NetworkMapProps & { onRetry: () => void }) {
  const [sdk, setSDK] = useState<SDK | null>(null);
  const [surface, setSurface] = useState<'LOADING' | 'READY' | 'FAILED'>('LOADING');
  const [viewport, setViewport] = useState<NetworkMapRegion>(props.camera.region);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [clock, setClock] = useState(Date.now());
  const map = useRef<MapView | null>(null);
  const alive = useRef(false);
  const nativeState = useRef<'LOADING' | 'READY' | 'FAILED'>('LOADING');
  const highestSequence = useRef(-1);
  const appliedCamera = useRef<string | null>(null);
  const current = useRef({ sequence: -1, valid: false, snapshot: props.snapshot, eventDraft: props.eventDraft });
  const fresh = prepareNetworkMapPoints(props.snapshot, Math.max(clock, Date.now()));
  const stale = props.snapshot.sequence < highestSequence.current;
  // Monotonic fail-closed display guard, not a substitute for service/server concurrency.
  if (Number.isSafeInteger(props.snapshot.sequence)) highestSequence.current = Math.max(highestSequence.current, props.snapshot.sequence);
  current.current = { sequence: props.snapshot.sequence, valid: !stale && fresh.state === 'READY', snapshot: props.snapshot, eventDraft: props.eventDraft };
  const points = current.current.valid ? fresh.points : [];
  const nextExpiry = points.reduce((value, point) => Math.min(value, point.expiresAt), Infinity);
  const clusters = clusterNetworkMapPoints(points, viewport, size);
  const fail = () => { if (alive.current) { nativeState.current = 'FAILED'; setSurface('FAILED'); } };
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; current.current.valid = false; map.current = null; };
  }, []);
  useEffect(() => {
    try {
      if (!UIManager.getViewManagerConfig('AIRMap')) { nativeState.current = 'FAILED'; setSurface('FAILED'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Avoid native registration before platform/configuration checks.
      setSDK(require('react-native-maps') as SDK);
    } catch { nativeState.current = 'FAILED'; setSurface('FAILED'); }
  }, []);
  useEffect(() => {
    if (surface !== 'LOADING') return;
    const timer = setTimeout(() => { if (alive.current) { nativeState.current = 'FAILED'; setSurface('FAILED'); } }, 10000);
    return () => clearTimeout(timer);
  }, [surface]);
  useEffect(() => {
    const now = Date.now();
    const timer = setTimeout(() => { if (alive.current) setClock(Date.now()); }, Math.max(1, Math.min(60000, nextExpiry - now + 1)));
    return () => clearTimeout(timer);
  }, [nextExpiry, clock]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (alive.current && state === 'active') setClock(Date.now()); });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (surface !== 'READY' || appliedCamera.current === props.camera.requestId) return;
    appliedCamera.current = props.camera.requestId;
    try { setViewport(props.camera.region); map.current?.animateToRegion({ ...props.camera.region }, 250); }
    catch { if (alive.current) { nativeState.current = 'FAILED'; setSurface('FAILED'); } }
  }, [surface, props.camera]);
  if (surface === 'FAILED') return <Notice message="Mappa non disponibile. Verifica connessione e configurazione cartografica." retry={onRetry} />;
  const NativeMap = sdk?.default, Marker = sdk?.Marker;
  const draftPoint = props.eventDraft?.point;
  const padding = networkMapPadding(props.contentInsets, size);
  const dataMessage = stale ? 'Dati fuori ordine: nessun marker mostrato.' : fresh.state === 'LOADING' ? 'Caricamento segnalazioni…' :
    fresh.state === 'ERROR' ? 'Segnalazioni non disponibili. Nessun dato precedente mostrato.' :
    fresh.state === 'LIMIT' ? 'Troppi marker: restringi la zona o i filtri.' :
    fresh.state === 'INVALID' ? 'Dati cartografici non validi.' : points.length === 0 ? 'Nessuna segnalazione pubblicabile disponibile.' : null;
  return <View style={styles.root} onLayout={event => setSize(event.nativeEvent.layout)}>
    {NativeMap && Marker ? <MapBoundary onFailure={fail}><NativeMap ref={map} style={StyleSheet.absoluteFill}
      provider={Platform.OS === 'android' && props.provider !== 'PLATFORM_DEFAULT' ? sdk?.PROVIDER_GOOGLE : undefined} initialRegion={{ ...props.camera.region }}
      userInterfaceStyle="dark" mapPadding={padding} showsUserLocation={false} showsMyLocationButton={false}
      followsUserLocation={false} toolbarEnabled={false} showsTraffic={false} showsIndoors={false} showsPointsOfInterest={false}
      rotateEnabled={false} pitchEnabled={false} moveOnMarkerPress={false}
      onPress={event => {
        if (!alive.current || nativeState.current !== 'READY' || !props.eventDraft || current.current.eventDraft !== props.eventDraft || event.nativeEvent.action === 'marker-press') return;
        const point = event.nativeEvent.coordinate;
        if (Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 85 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180)
          props.eventDraft.onChoose({ latitude: point.latitude, longitude: point.longitude });
      }}
      customMapStyle={[
        { elementType: 'geometry', stylers: [{ color: '#153247' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#C8D8E5' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#153247' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#31536B' }] },
        { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1E554F' }] },
      ]}
      onMapReady={() => { if (alive.current && nativeState.current === 'LOADING') { nativeState.current = 'READY'; setSurface('READY'); } }}
      onRegionChangeComplete={region => { if (alive.current && nativeState.current === 'READY' && validNetworkMapRegion(region)) {
        const next = { latitude: region.latitude, longitude: region.longitude, latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta };
        setViewport(next); props.onViewportChange?.(next);
      } }}>
      {clusters.map(cluster => {
        const first = cluster.points[0]; const multiple = cluster.points.length > 1;
        const category = NETWORK_CATEGORY_REGISTRY_V2[first.categoryId];
        const label = multiple ? `${cluster.points.length} segnalazioni · ${statusLabels[first.status]}` : `${category.label} · ${statusLabels[first.status]}`;
        const selected = cluster.points.some(point => point.publicId === props.selectedPublicId);
        const expectedSequence = props.snapshot.sequence;
        return <Marker key={cluster.id} identifier={cluster.id} coordinate={{ ...cluster.coordinate }} title={label} stopPropagation
          accessibilityLabel={label} onPress={() => {
            if (!alive.current || nativeState.current !== 'READY' || !current.current.valid || current.current.snapshot !== props.snapshot || current.current.sequence !== expectedSequence || cluster.points.some(point => point.expiresAt <= Date.now())) return;
            props.onSelect({ kind: multiple ? 'CLUSTER' : 'EVENT', publicIds: cluster.points.map(point => point.publicId) });
          }}>
          <View style={[styles.pin, { backgroundColor: multiple ? '#E7F2FA' : category.color }, selected && styles.selected]}>
            {multiple ? <Text style={styles.count}>{cluster.points.length}</Text> : <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
              <Path d={paths[category.iconId]} stroke="#061B36" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>}
          </View>
        </Marker>;
      })}
      {draftPoint && Number.isFinite(draftPoint.latitude) && Math.abs(draftPoint.latitude) <= 85 && Number.isFinite(draftPoint.longitude) && Math.abs(draftPoint.longitude) <= 180 ? <Marker key="event-draft-selection" identifier="event-draft-selection"
        coordinate={{ ...draftPoint }} pinColor="#79B8FF" stopPropagation
        title="Luogo evento scelto · non pubblicato" /> : null}
    </NativeMap></MapBoundary> : null}
    {surface === 'LOADING' || dataMessage ? <View pointerEvents="none" style={[styles.notice, { top: padding.top + 8 }]}>
      <Text accessibilityLiveRegion="polite" style={styles.text}>{surface === 'LOADING' ? 'Caricamento cartografia…' : dataMessage}</Text>
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Ricentra mappa sul territorio selezionato"
      disabled={surface !== 'READY'} style={[styles.recenter, { right: padding.right + 8, bottom: padding.bottom + 8 }]}
      onPress={() => { if (!alive.current || surface !== 'READY') return;
        try { setViewport(props.camera.region); map.current?.animateToRegion({ ...props.camera.region }, 250); } catch { fail(); }
      }}><Text style={styles.buttonText}>Ricentra</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 120, backgroundColor: '#061B36' },
  unavailable: { flex: 1, backgroundColor: '#061B36', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 },
  text: { color: '#D5E6F5', fontSize: 14, lineHeight: 21 },
  button: { minHeight: 48, padding: 14, borderRadius: 14, backgroundColor: '#BDE9FF' },
  buttonText: { color: '#061B36', fontSize: 15, fontWeight: '700' },
  recenter: { position: 'absolute', minHeight: 48, minWidth: 80, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 14, backgroundColor: '#BDE9FF' },
  notice: { position: 'absolute', left: 12, right: 12, padding: 12, borderRadius: 14, backgroundColor: '#08233FF0' },
  pin: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: '#061B36', alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: '#FFFFFF', borderWidth: 4 }, count: { color: '#061B36', fontSize: 20, fontWeight: '800' },
});
