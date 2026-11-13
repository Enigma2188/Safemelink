import type { NetworkMarkerV2 } from '@/services/NetworkMapContractV2';

export type NetworkMapRegion = Readonly<{
  latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number;
}>;
export type NetworkMapSelection = Readonly<{ kind: 'EVENT' | 'CLUSTER'; publicIds: readonly string[] }>;
/** Complete authorized snapshot, never an additive page. Change opaque scopeKey on
 * logout/account/access/territory change. Service sequences strictly increase within scope.
 * This UI contract cannot establish server authorization or resolve concurrent writes.
 */
export type NetworkMapSnapshot = Readonly<{
  scopeKey: string; sequence: number; state: 'LOADING' | 'READY' | 'ERROR'; markers: readonly NetworkMarkerV2[];
}>;
export type NetworkMapProps = Readonly<{
  snapshot: NetworkMapSnapshot;
  /** Supplied by composition root; no API key is accepted/read by this component. */
  configuration: 'READY' | 'MISSING';
  provider?: 'PLATFORM_DEFAULT' | 'GOOGLE_ANDROID';
  /** Keep requestId stable to preserve user pan/zoom; change it for an explicit move. */
  camera: Readonly<{ requestId: string; region: NetworkMapRegion }>;
  selectedPublicId?: string | null;
  /** Explicit event draft only, never user GPS or a published marker. No server call. */
  eventDraft?: Readonly<{
    point: Readonly<{ latitude: number; longitude: number }> | null;
    onChoose: (point: Readonly<{ latitude: number; longitude: number }>) => void;
  }>;
  contentInsets?: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  onSelect: (selection: NetworkMapSelection) => void;
  onViewportChange?: (region: NetworkMapRegion) => void;
}>;
