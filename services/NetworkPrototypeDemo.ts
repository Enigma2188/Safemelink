/** INTERNAL SYNTHETIC SCENARIO. Never import into real NETWORK services/repositories.
 * Place names are public geographical cues; event positions/text/authors are invented,
 * NOT evidence of issues on those streets. No user/device coordinates are acquired.
 */
import {
  isNetworkHistoryDetailV2, isNetworkOperationalDetailV2,
  type NetworkHistoryDetailV2, type NetworkOperationalDetailV2,
} from './NetworkMapContractV2';
import { NETWORK_CATEGORY_REGISTRY_V2, type NetworkCategoryIdV2 } from './NetworkCategoryRegistryV2';

export const NETWORK_DEMO_CENTER = Object.freeze({ latitude: 44.69457, longitude: 10.52591 });
export const NETWORK_DEMO_TIME = Date.parse('2026-11-04T10:00:00.000Z');
export const NETWORK_DEMO_RADII = [1000, 2500, 5000, 10000] as const;
export type NetworkDemoStatus = 'ACTIVE' | 'RESOLVED' | 'HISTORY';
export type NetworkDemoEvent = Readonly<{
  demo: true;
  title: string;
  areaLabel: string;
  detail: NetworkOperationalDetailV2 | NetworkHistoryDetailV2;
}>;
export type NetworkDemoFilters = Readonly<{
  status: NetworkDemoStatus;
  category: NetworkCategoryIdV2 | null;
  query: string;
  radiusMeters: number;
}>;
export const networkPrototypeEnabled = (development: boolean) => development === true;
const uuid = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nicknames = ['Demo_Luce', 'Demo_Verde', 'Demo_Passopasso', 'Demo_Insieme'];
const territoryId = uuid(100), zoneId = uuid(101);
function event(n: number, categoryId: NetworkCategoryIdV2, title: string, areaLabel: string,
  north: number, east: number, status: 'ACTIVE' | 'RESOLVED' = 'ACTIVE'): NetworkDemoEvent {
  const dates = { createdAt: '2026-11-03T08:30:00.000Z', updatedAt: '2026-11-04T09:15:00.000Z' };
  const lifecycle = status === 'ACTIVE' ? { status, resolvedAt: null } as const :
    { status, resolvedAt: '2026-11-04T08:00:00.000Z' } as const;
  return {
    demo: true, title, areaLabel,
    detail: {
      marker: { schemaVersion: 2, publicId: uuid(n), territoryId, zoneId, kind: 'OPERATIONAL_EVENT', categoryId,
        locationPolicyVersion: 'DEMO-NOT-A-PRIVACY-POLICY', revision: 1, validUntil: '2026-11-05T10:00:00.000Z',
        publicPosition: { latitude: NETWORK_DEMO_CENTER.latitude + north, longitude: NETWORK_DEMO_CENTER.longitude + east,
          generalizationMeters: 250, representation: 'GENERALIZED_EVENT_POINT' }, ...dates, ...lifecycle },
      description: `${title}. Esempio inventato per valutare NETWORK 2.0: non è una segnalazione reale.`,
      authorNickname: nicknames[n % nicknames.length],
      confirmations: { confirmedCount: n + 2, noLongerPresentCount: status === 'RESOLVED' ? 2 : 0, myConfirmation: null },
      updates: n % 2 ? [{ publicId: uuid(n + 200), authorRole: 'AUTHOR', body: 'Aggiornamento demo: aggiunte informazioni utili sul luogo.',
        createdAt: '2026-11-04T09:15:00.000Z' }] : [],
    },
  };
}
function history(n: number, categoryId: NetworkCategoryIdV2, title: string, north: number, east: number): NetworkDemoEvent {
  return { demo: true, title, areaLabel: 'Zona centrale · archivio demo', detail: {
    marker: { schemaVersion: 2, publicId: uuid(n), territoryId, zoneId, kind: 'REVIEWED_HISTORY', status: 'CONCLUDED',
      categoryId, locationPolicyVersion: 'DEMO-NOT-A-PRIVACY-POLICY', revision: 2,
      validUntil: '2026-11-05T10:00:00.000Z', publicPosition: {
        latitude: NETWORK_DEMO_CENTER.latitude + north, longitude: NETWORK_DEMO_CENTER.longitude + east,
        generalizationMeters: 1000, representation: 'ZONE_REPRESENTATIVE_POINT',
      }, period: { startMonth: '2026-09-01', endMonthExclusive: '2026-10-01' } },
    summary: 'Scheda storica sintetica revisionata solo per il prototipo. Nessun evento reale e nessuna identità personale.',
  } };
}

export const NETWORK_DEMO_EVENTS: readonly NetworkDemoEvent[] = Object.freeze([
  event(1, 'LIGHTING', 'Un punto luce da verificare', 'Piazza Zanti · esempio', 0.0002, 0.0002),
  event(2, 'ROADS_TRAFFIC', 'Percorso pedonale da controllare', 'Via Roma · esempio', 0.0004, 0.0003),
  event(3, 'COMMUNITY_INFORMATION', 'Una passeggiata di quartiere', 'Area centrale · esempio', 0.0003, 0.0005),
  event(4, 'ENVIRONMENT_DECORUM', 'Uno spazio verde da curare', 'Zona ovest · esempio', -0.003, -0.005),
  event(5, 'CIVIC_SAFETY', 'Visibilità del passaggio pedonale', 'Via Mentana · esempio', 0.004, 0.006),
  event(6, 'LIGHTING', 'Illuminazione del percorso', 'Via Verdi · esempio', -0.005, 0.007),
  event(7, 'ENVIRONMENT_DECORUM', 'Pulizia dello spazio pubblico', 'Settore nord · esempio', 0.016, -0.007),
  event(8, 'COMMUNITY_INFORMATION', 'Un incontro di vicinato', 'Territorio esteso · esempio', 0.039, 0.008),
  event(9, 'ROADS_TRAFFIC', 'Percorso tornato disponibile', 'Via Roma · esempio', 0.003, -0.003, 'RESOLVED'),
  event(10, 'LIGHTING', 'Verifica del punto luce conclusa', 'Piazza Zanti · esempio', -0.002, 0.004, 'RESOLVED'),
  history(11, 'ENVIRONMENT_DECORUM', 'Cura degli spazi condivisi', 0.003, 0.003),
  history(12, 'ROADS_TRAFFIC', 'Percorsi del quartiere', -0.003, -0.003),
]);

export const isValidNetworkDemoEvent = (entry: NetworkDemoEvent) => entry.demo === true &&
  (isNetworkOperationalDetailV2(entry.detail) || isNetworkHistoryDetailV2(entry.detail)) &&
  Date.parse(entry.detail.marker.validUntil) > NETWORK_DEMO_TIME;

export function networkDemoDistance(point: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const a = Math.sin((point.latitude - NETWORK_DEMO_CENTER.latitude) * rad / 2) ** 2 +
    Math.cos(point.latitude * rad) * Math.cos(NETWORK_DEMO_CENTER.latitude * rad) *
    Math.sin((point.longitude - NETWORK_DEMO_CENTER.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function filterNetworkDemoEvents(entries: readonly NetworkDemoEvent[], filters: NetworkDemoFilters) {
  const query = filters.query.trim().toLocaleLowerCase('it');
  if (!NETWORK_DEMO_RADII.some(radius => radius === filters.radiusMeters)) return [];
  return entries.filter(entry => {
    if (!isValidNetworkDemoEvent(entry)) return false;
    const marker = entry.detail.marker;
    const status = marker.kind === 'REVIEWED_HISTORY' ? 'HISTORY' : marker.status;
    return status === filters.status && (!filters.category || marker.categoryId === filters.category) &&
      networkDemoDistance(marker.publicPosition) <= filters.radiusMeters &&
      (!query || `${entry.title} ${entry.areaLabel} ${NETWORK_CATEGORY_REGISTRY_V2[marker.categoryId].label}`.toLocaleLowerCase('it').includes(query));
  });
}
export type NetworkDemoCluster = Readonly<{
  id: string;
  entries: readonly NetworkDemoEvent[];
  coordinate: Readonly<{ latitude: number; longitude: number }>;
}>;
/** Local visual grouping of already filtered demo markers, not population/risk statistics. */
export function clusterNetworkDemoEvents(entries: readonly NetworkDemoEvent[], cellMeters = 250): NetworkDemoCluster[] {
  if (!Number.isFinite(cellMeters) || cellMeters <= 0) return [];
  const groups = new Map<string, NetworkDemoEvent[]>();
  for (const entry of entries) {
    if (!isValidNetworkDemoEvent(entry)) continue;
    const point = entry.detail.marker.publicPosition;
    const key = `${Math.floor((point.longitude - NETWORK_DEMO_CENTER.longitude) * 79000 / cellMeters)}:${Math.floor((point.latitude - NETWORK_DEMO_CENTER.latitude) * 111000 / cellMeters)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([id, members]) => ({ id, entries: members,
    coordinate: { latitude: members.reduce((sum, entry) => sum + entry.detail.marker.publicPosition.latitude, 0) / members.length,
      longitude: members.reduce((sum, entry) => sum + entry.detail.marker.publicPosition.longitude, 0) / members.length } }));
}
