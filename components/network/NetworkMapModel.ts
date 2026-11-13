import { isNetworkMarkerV2, type NetworkMarkerV2 } from '@/services/NetworkMapContractV2';
import type { NetworkMapRegion, NetworkMapSnapshot } from './NetworkMap.types';

/** Explicit rendering budget: never silently truncate counts; caller must page/aggregate. */
export const NETWORK_MAP_MARKER_LIMIT = 2000;
export const NETWORK_MAP_RADII = [1000, 2500, 5000, 10000] as const;
/** Reserve caller overlays, scaling only when opposing insets leave no usable map. */
export function networkMapPadding(insets: { top: number; right: number; bottom: number; left: number } | undefined,
  size: { width: number; height: number }) {
  const value = insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const pair = (a: number, b: number, dimension: number) => {
    const available = Number.isFinite(dimension) ? Math.max(0, dimension - 96) : 0;
    const first = Number.isFinite(a) ? Math.max(0, Math.min(a, available)) : 0;
    const second = Number.isFinite(b) ? Math.max(0, Math.min(b, available)) : 0;
    const scale = first + second > available ? available / (first + second) : 1;
    return [first * scale, second * scale];
  };
  const [top, bottom] = pair(value.top, value.bottom, size.height);
  const [left, right] = pair(value.left, value.right, size.width);
  return { top, right, bottom, left };
}
export type NetworkMapPoint = Readonly<{
  publicId: string; categoryId: NetworkMarkerV2['categoryId']; kind: NetworkMarkerV2['kind']; status: NetworkMarkerV2['status'];
  coordinate: Readonly<{ latitude: number; longitude: number }>; expiresAt: number;
}>;
export type NetworkMapCluster = Readonly<{
  id: string; coordinate: Readonly<{ latitude: number; longitude: number }>; points: readonly NetworkMapPoint[];
}>;
export const validNetworkMapRegion = (region: NetworkMapRegion): boolean => !!region &&
  Number.isFinite(region.latitude) && Math.abs(region.latitude) <= 90 &&
  Number.isFinite(region.longitude) && Math.abs(region.longitude) <= 180 &&
  Number.isFinite(region.latitudeDelta) && region.latitudeDelta > 0 && region.latitudeDelta <= 180 &&
  Number.isFinite(region.longitudeDelta) && region.longitudeDelta > 0 && region.longitudeDelta <= 360;

/** Exact DTO guard + explicit projection, NOT server authorization or privacy policy. */
export function prepareNetworkMapPoints(snapshot: NetworkMapSnapshot, now: number): {
  state: 'LOADING' | 'READY' | 'ERROR' | 'INVALID' | 'LIMIT'; points: readonly NetworkMapPoint[];
} {
  if (!snapshot || typeof snapshot.scopeKey !== 'string' || !snapshot.scopeKey.trim() ||
    !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 || !Array.isArray(snapshot.markers) || !Number.isFinite(now)) return { state: 'INVALID', points: [] };
  if (snapshot.state === 'LOADING' || snapshot.state === 'ERROR') return { state: snapshot.state, points: [] };
  if (snapshot.state !== 'READY') return { state: 'INVALID', points: [] };
  if (snapshot.markers.length > NETWORK_MAP_MARKER_LIMIT) return { state: 'LIMIT', points: [] };
  const ids = new Set<string>(); const points: NetworkMapPoint[] = [];
  for (const marker of snapshot.markers) {
    if (!isNetworkMarkerV2(marker) || ids.has(marker.publicId)) return { state: 'INVALID', points: [] };
    ids.add(marker.publicId);
    const expiresAt = Date.parse(marker.validUntil);
    if (expiresAt <= now) continue;
    points.push({ publicId: marker.publicId, categoryId: marker.categoryId, kind: marker.kind, status: marker.status,
      coordinate: { latitude: marker.publicPosition.latitude, longitude: marker.publicPosition.longitude }, expiresAt });
  }
  return { state: 'READY', points };
}
const longitudeOffset = (longitude: number, center: number) => ((longitude - center + 540) % 360) - 180;
/** Approximate screen grid, not territorial aggregation/risk or anonymity policy.
 * Active/resolved/history never share clusters. Only supplied public event points are used.
 */
export function clusterNetworkMapPoints(points: readonly NetworkMapPoint[], region: NetworkMapRegion,
  size: Readonly<{ width: number; height: number }>): readonly NetworkMapCluster[] {
  if (!validNetworkMapRegion(region) || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return [];
  const groups = new Map<string, NetworkMapPoint[]>();
  for (const point of points) {
    const x = longitudeOffset(point.coordinate.longitude, region.longitude) / region.longitudeDelta;
    const y = (point.coordinate.latitude - region.latitude) / region.latitudeDelta;
    if (Math.abs(x) > 0.65 || Math.abs(y) > 0.65) continue;
    const cell = `${point.kind}:${point.status}:${Math.floor((x + 0.5) * size.width / 64)}:${Math.floor((y + 0.5) * size.height / 64)}`;
    const group = groups.get(cell) ?? []; group.push(point); groups.set(cell, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([cell, group]) => {
    const sorted = [...group].sort((a, b) => a.publicId.localeCompare(b.publicId));
    // Real public point; arithmetic averaging +/-180 would put it on another continent.
    return { id: `${cell}:${sorted[0].publicId}`, coordinate: { ...sorted[0].coordinate }, points: sorted };
  });
}
/** Pure camera helper for existing radii; not a query/filter or GPS read. */
export function networkMapRegionForRadius(center: { latitude: number; longitude: number },
  radiusMeters: (typeof NETWORK_MAP_RADII)[number], aspectRatio: number): NetworkMapRegion | null {
  if (!center || !NETWORK_MAP_RADII.includes(radiusMeters) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const latitudeDelta = Math.min(180, radiusMeters * 2.6 / 111000);
  const region = { latitude: center.latitude, longitude: center.longitude, latitudeDelta,
    longitudeDelta: Math.min(360, latitudeDelta * aspectRatio / Math.max(0.01, Math.cos(center.latitude * Math.PI / 180))) };
  return validNetworkMapRegion(region) ? region : null;
}
