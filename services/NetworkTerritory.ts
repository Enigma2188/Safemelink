import { getNetworkCategoryLabel, type NetworkFeedReport } from '@/services/NetworkModels';
import { NETWORK_PILOT } from '@/services/NetworkPilotConfig';

export const NETWORK_DISTANCE_BANDS = [
  { id: 'near', label: 'Entro 1 km', minimum: 0, maximum: 1_000 },
  { id: 'local', label: '1–2,5 km', minimum: 1_000, maximum: 2_500 },
  { id: 'town', label: '2,5–5 km', minimum: 2_500, maximum: 5_000 },
  { id: 'wide', label: '5–10 km', minimum: 5_000, maximum: 10_001 },
] as const;
export type NetworkFilters = {
  query: string; category: string; days: number; status: 'all' | 'ACTIVE' | 'RESOLVED'; band: string | null;
};
export const DEFAULT_NETWORK_FILTERS: NetworkFilters = { query: '', category: 'all', days: 7, status: 'all', band: null };

export function filterNetworkReports(reports: NetworkFeedReport[], filters: NetworkFilters, now: number) {
  const query = filters.query.trim().toLocaleLowerCase('it');
  const band = NETWORK_DISTANCE_BANDS.find(b => b.id === filters.band);
  return [...new Map(reports.map(report => [report.id, report])).values()].filter(report => {
    const created = Date.parse(report.createdAt), expires = Date.parse(report.expiresAt);
    if (!Number.isFinite(created) || created > now || !['ACTIVE', 'RESOLVED'].includes(report.status)) return false;
    if (report.status === 'ACTIVE' && (!Number.isFinite(expires) || expires <= now)) return false;
    if (filters.days && created < now - filters.days * 86_400_000) return false;
    if (filters.category !== 'all' && report.category !== filters.category) return false;
    if (filters.status !== 'all' && report.status !== filters.status) return false;
    if (band && (!Number.isFinite(report.distanceBucketMeters) || report.distanceBucketMeters < band.minimum || report.distanceBucketMeters >= band.maximum)) return false;
    return !query || [report.description, report.publicArea, getNetworkCategoryLabel(report.category)].some(text => text.toLocaleLowerCase('it').includes(query));
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export function networkActivity(count: number, policy = NETWORK_PILOT) {
  if (!Number.isInteger(count) || count < policy.minimumAggregateCount) return { label: 'Dati insufficienti', color: '#BACCE4', symbol: '—' };
  if (count <= policy.lowActivityMaximum) return { label: 'Poche segnalazioni', color: '#6FF0AD', symbol: '●' };
  if (count <= policy.mediumActivityMaximum) return { label: 'Attività intermedia', color: '#FFD779', symbol: '▲' };
  return { label: 'Attività più elevata', color: '#FF9CAB', symbol: '◆' };
}

export function networkDistanceActivity(reports: NetworkFeedReport[]) {
  // Distance rings, NOT neighborhoods. No reconstruction of directions or GPS.
  return NETWORK_DISTANCE_BANDS.map(band => {
    const count = new Set(reports.filter(r => Number.isFinite(r.distanceBucketMeters) && r.distanceBucketMeters >= band.minimum && r.distanceBucketMeters < band.maximum).map(r => r.id)).size;
    return { ...band, count: count >= NETWORK_PILOT.minimumAggregateCount ? count : null, activity: networkActivity(count) };
  });
}
