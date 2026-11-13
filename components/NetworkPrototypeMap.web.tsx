/** Web-only, local illustration. No native maps, tiles, GPS, geocoding or provider. */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { NETWORK_CATEGORY_REGISTRY_V2 } from '@/services/NetworkCategoryRegistryV2';
import { NETWORK_DEMO_CENTER, type NetworkDemoCluster } from '@/services/NetworkPrototypeDemo';

type Props = { clusters: readonly NetworkDemoCluster[]; radiusMeters: number; recenterToken: number;
  topInset: number; bottomInset: number;
  rightInset?: number;
  focusTarget?: Readonly<{ coordinate: Readonly<{ latitude: number; longitude: number }>; token: number }>;
  onSelect: (cluster: NetworkDemoCluster) => void; onZoom: (cellMeters: number) => void };
export const NETWORK_PROTOTYPE_ICONS = { CIVIC_SAFETY: 'shield-checkmark-outline', ROADS_TRAFFIC: 'car-outline',
  LIGHTING: 'bulb-outline', ENVIRONMENT_DECORUM: 'leaf-outline', COMMUNITY_INFORMATION: 'information-circle-outline' } as const;
const boundedZoom = (zoom: number) => Math.max(0.65, Math.min(8, zoom));

export function NetworkPrototypeMap({ clusters, radiusMeters, recenterToken, topInset, bottomInset, rightInset = 90, focusTarget, onSelect, onZoom }: Props) {
  const [size, setSize] = useState({ width: 1000, height: 800 });
  const [zoom, setZoom] = useState(2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const bottom = Math.min(bottomInset, Math.max(0, size.height - 96));
  const top = Math.min(topInset, Math.max(0, size.height - bottom - 96));
  const freeHeight = Math.max(96, size.height - top - bottom);
  const controlsVisible = size.height - topInset - bottomInset >= 130;
  const cx = (size.width - Math.min(rightInset, Math.max(0, size.width - 180))) / 2, cy = top + freeHeight / 2;
  const metersPerPixel = radiusMeters * 2 / freeHeight;
  const camera = useRef({ metersPerPixel, zoom });
  camera.current = { metersPerPixel, zoom };
  useEffect(() => { setPan({ x: 0, y: 0 }); setZoom(2); }, [radiusMeters, recenterToken]);
  useEffect(() => { onZoom(Math.max(60, Math.min(350, radiusMeters / (3 * zoom)))); }, [zoom, radiusMeters, onZoom]);
  useEffect(() => {
    if (!focusTarget) return;
    const view = camera.current;
    setPan({ x: -(focusTarget.coordinate.longitude - NETWORK_DEMO_CENTER.longitude) * 79000 / view.metersPerPixel * view.zoom,
      y: (focusTarget.coordinate.latitude - NETWORK_DEMO_CENTER.latitude) * 111000 / view.metersPerPixel * view.zoom });
  }, [focusTarget]);
  return <View style={StyleSheet.absoluteFill} onLayout={event => setSize(event.nativeEvent.layout)}>
    <div role="region" aria-label="Schema territoriale dimostrativo. Trascina per spostare, usa frecce e pulsanti per navigare."
      tabIndex={0} style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', backgroundColor: '#153247' }}
      onKeyDown={event => {
        const offsets: Record<string, { x: number; y: number }> = { ArrowLeft: { x: 60, y: 0 }, ArrowRight: { x: -60, y: 0 }, ArrowUp: { x: 0, y: 60 }, ArrowDown: { x: 0, y: -60 } };
        const offset = offsets[event.key];
        if (offset) { event.preventDefault(); setPan(old => ({ x: old.x + offset.x, y: old.y + offset.y })); }
      }}
      onPointerDown={event => {
        if ((event.target as HTMLElement).closest?.('[role="button"]')) return;
        drag.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (drag.current) setPan({ x: drag.current.startX + event.clientX - drag.current.x, y: drag.current.startY + event.clientY - drag.current.y });
      }}
      onPointerUp={event => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { drag.current = null; }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden={true} focusable={false}>
        <Rect width={size.width} height={size.height} fill="#153247" />
        <G transform={`translate(${cx + pan.x} ${cy + pan.y}) scale(${zoom}) translate(${-cx} ${-cy})`}>
          <Path d={`M${cx - 150} ${cy - 180} l-180 30 l-10 220 l130 30 Z M${cx + 100} ${cy + 30} l230 -80 l90 270 l-250 30 Z`} fill="#20564F" />
          <Path d={`M${cx - 1000} ${cy + 350} L${cx + 1000} ${cy - 350} M${cx - 150} ${cy - 1200} L${cx + 30} ${cy - 60} L${cx - 50} ${cy + 400} L${cx + 150} ${cy + 1200} M${cx - 1200} ${cy + 150} L${cx + 1200} ${cy + 100}`}
            stroke="#34566D" strokeWidth="24" fill="none" />
          <Path d={`M${cx - 1000} ${cy + 350} L${cx + 1000} ${cy - 350} M${cx - 150} ${cy - 1200} L${cx + 30} ${cy - 60} L${cx - 50} ${cy + 400} L${cx + 150} ${cy + 1200} M${cx - 1200} ${cy + 150} L${cx + 1200} ${cy + 100}`}
            stroke="#7891A3" strokeWidth="3" fill="none" />
          {[-280, -140, 0, 140, 280].map(offset => <Path key={offset}
            d={`M${cx - 900} ${cy + offset} L${cx + 900} ${cy + offset + 45} M${cx + offset} ${cy - 900} L${cx + offset + 150} ${cy + 900}`}
            stroke="#34566D" strokeWidth="7" fill="none" />)}
        </G>
      </Svg>
      {clusters.map(cluster => {
        const x = cx + pan.x + (cluster.coordinate.longitude - NETWORK_DEMO_CENTER.longitude) * 79000 / metersPerPixel * zoom;
        const y = cy + pan.y - (cluster.coordinate.latitude - NETWORK_DEMO_CENTER.latitude) * 111000 / metersPerPixel * zoom;
        if (x < -30 || x > size.width + 30 || y < -30 || y > size.height + 30) return null;
        const multiple = cluster.entries.length > 1;
        const category = cluster.entries[0].detail.marker.categoryId;
        return <Pressable key={cluster.id} accessibilityRole="button"
          accessibilityLabel={multiple ? `Apri gruppo di ${cluster.entries.length} eventi demo` : `Apri ${cluster.entries[0].title}, demo`}
          onPress={() => onSelect(cluster)} style={[styles.marker, { left: x - 24, top: y - 24,
            backgroundColor: multiple ? '#F0F6FC' : NETWORK_CATEGORY_REGISTRY_V2[category].color }]}>
          {multiple ? <Text style={styles.count}>{cluster.entries.length}</Text> :
            <Ionicons accessible={false} name={NETWORK_PROTOTYPE_ICONS[category]} size={25} color="#061B36" />}
        </Pressable>;
      })}
    </div>
    {controlsVisible ? <View style={[styles.zoom, { top: Math.max(top + 8, cy - 45) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ingrandisci schema demo" disabled={zoom >= 8}
        onPress={() => setZoom(old => boundedZoom(old * 1.35))} style={styles.button}><Text style={styles.control}>＋</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Riduci schema demo" disabled={zoom <= 0.65}
        onPress={() => setZoom(old => boundedZoom(old / 1.35))} style={styles.button}><Text style={styles.control}>−</Text></Pressable>
    </View> : null}
    {controlsVisible ? <View pointerEvents="none" style={[styles.notice, { top: Math.max(top + 8, size.height - bottom - 52) }]}>
      <Text style={styles.noticeText}>SCHEMA DEMO · non è una mappa reale di Cavriago</Text>
      <Text style={styles.hint}>Trascina o usa le frecce · zoom ×{zoom.toFixed(1)} · nessun GPS</Text>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  marker: { position: 'absolute', width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: '#061B36', alignItems: 'center', justifyContent: 'center' },
  count: { color: '#061B36', fontSize: 23, fontWeight: '800' },
  zoom: { position: 'absolute', left: 14, gap: 6 }, button: { minWidth: 50, minHeight: 48, borderRadius: 12, backgroundColor: '#08233F', borderWidth: 1, borderColor: '#7891A3', alignItems: 'center', justifyContent: 'center' },
  control: { color: '#F4F8FD', fontSize: 26 }, notice: { position: 'absolute', left: 12, right: 95, maxWidth: 360, borderRadius: 10, padding: 8, backgroundColor: '#061B36ED' },
  noticeText: { color: '#F4F8FD', fontSize: 12, fontWeight: '800' }, hint: { color: '#C8DDF0', fontSize: 12, lineHeight: 18 },
});
