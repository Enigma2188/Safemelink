import { isNetworkMarkerV2, type NetworkMarkerV2 } from './NetworkMapContractV2';
import { isNetworkCategoryIdV2, type NetworkCategoryIdV2 } from './NetworkCategoryRegistryV2';
import type { NetworkMapSnapshot } from '@/components/network/NetworkMap.types';

export type NetworkMapQuery = Readonly<{
  territoryId: string; center: Readonly<{ latitude: number; longitude: number }>;
  radiusMeters: 1000 | 2500 | 5000 | 10000;
  status: 'ACTIVE' | 'RESOLVED' | 'HISTORY'; categoryId: NetworkCategoryIdV2 | null;
}>;
/** Implement with an authenticated service, not legacy rows or zone aggregates.
 * Return a COMPLETE authorized snapshot, honour AbortSignal, no synthetic fallback.
 */
export interface NetworkMapMarkerSource {
  loadMarkers(query: NetworkMapQuery, signal: AbortSignal): Promise<readonly NetworkMarkerV2[]>;
}
export type NetworkMapErrorCode = 'NETWORK' | 'SERVER' | 'ACCESS_DENIED' | 'INVALID_DATA' | 'TIMEOUT';
export class NetworkMapSourceError extends Error {
  constructor(readonly code: NetworkMapErrorCode) { super(code); }
}
export type NetworkMapControllerState = Readonly<{
  status: 'IDLE' | 'LOADING' | 'READY' | 'EMPTY' | 'ERROR';
  errorCode: NetworkMapErrorCode | null; snapshot: NetworkMapSnapshot;
}>;
export type NetworkMapContext = Readonly<{
  /** Opaque identity/access revision. Never a nickname; change on auth/access change. */
  authorizationKey: string; query: NetworkMapQuery;
}>;
const uuid = (value: string) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validQuery(q: NetworkMapQuery): boolean {
  return !!q && uuid(q.territoryId) && !!q.center && Number.isFinite(q.center.latitude) && Math.abs(q.center.latitude) <= 90 &&
    Number.isFinite(q.center.longitude) && Math.abs(q.center.longitude) <= 180 && [1000, 2500, 5000, 10000].includes(q.radiusMeters) &&
    ['ACTIVE', 'RESOLVED', 'HISTORY'].includes(q.status) && (q.categoryId === null || isNetworkCategoryIdV2(q.categoryId));
}
/** Explicit public allowlist, copied/frozen so source mutation cannot alter visible state. */
function copyMarker(marker: NetworkMarkerV2): NetworkMarkerV2 {
  const base = { schemaVersion: marker.schemaVersion, publicId: marker.publicId, territoryId: marker.territoryId,
    zoneId: marker.zoneId, categoryId: marker.categoryId, locationPolicyVersion: marker.locationPolicyVersion,
    revision: marker.revision, validUntil: marker.validUntil };
  if (marker.kind === 'REVIEWED_HISTORY') return Object.freeze({ ...base, kind: marker.kind, status: marker.status,
    publicPosition: Object.freeze({ latitude: marker.publicPosition.latitude, longitude: marker.publicPosition.longitude,
      generalizationMeters: marker.publicPosition.generalizationMeters, representation: marker.publicPosition.representation }),
    period: Object.freeze({ startMonth: marker.period.startMonth, endMonthExclusive: marker.period.endMonthExclusive }) });
  return Object.freeze({ ...base, kind: marker.kind, createdAt: marker.createdAt, updatedAt: marker.updatedAt,
    publicPosition: Object.freeze({ latitude: marker.publicPosition.latitude, longitude: marker.publicPosition.longitude,
      generalizationMeters: marker.publicPosition.generalizationMeters, representation: marker.publicPosition.representation }),
    ...(marker.status === 'ACTIVE' ? { status: marker.status, resolvedAt: null } : { status: marker.status, resolvedAt: marker.resolvedAt }) });
}
let instanceNumber = 0;
export class NetworkMapController {
  private readonly instance = ++instanceNumber;
  private epoch = 0;
  private generation = 0;
  private sequence = 0;
  private disposed = false;
  private context: NetworkMapContext | null = null;
  private contextFingerprint = '';
  private abort: AbortController | null = null;
  private cancelRace: (() => void) | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private state: NetworkMapControllerState;
  constructor(private readonly source: NetworkMapMarkerSource, private readonly timeoutMs = 15000) {
    if (!source || typeof source.loadMarkers !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid controller configuration');
    this.state = this.makeState('IDLE', [], null);
  }
  private makeState(status: NetworkMapControllerState['status'], markers: readonly NetworkMarkerV2[], errorCode: NetworkMapErrorCode | null): NetworkMapControllerState {
    return Object.freeze({ status, errorCode, snapshot: Object.freeze({ scopeKey: `network:${this.instance}:${this.epoch}`,
      sequence: ++this.sequence, state: status === 'ERROR' ? 'ERROR' : status === 'IDLE' || status === 'LOADING' ? 'LOADING' : 'READY',
      markers: Object.freeze([...markers]) }) });
  }
  readonly getState = (): NetworkMapControllerState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(status: NetworkMapControllerState['status'], markers: readonly NetworkMarkerV2[] = [], code: NetworkMapErrorCode | null = null) {
    if (this.disposed) return;
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null; this.state = this.makeState(status, markers, code);
    if (markers.length) {
      const delay = Math.max(1, Math.min(60000, Math.min(...markers.map(marker => Date.parse(marker.validUntil))) - Date.now() + 1));
      this.expiry = setTimeout(() => {
        this.expiry = null;
        const remaining = this.state.snapshot.markers.filter(marker => Date.parse(marker.validUntil) > Date.now());
        this.publish(remaining.length ? 'READY' : 'EMPTY', remaining);
      }, delay);
    }
    // A broken subscriber must not prevent invalidation for other consumers.
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* No sensitive logging. */ } }
  }
  private cancel() {
    ++this.generation; this.abort?.abort(); this.abort = null; this.cancelRace?.(); this.cancelRace = null;
    if (this.expiry !== null) clearTimeout(this.expiry); this.expiry = null;
  }
  /** Call synchronously on auth/logout/access changes, before rendering another account. */
  setContext(context: NetworkMapContext | null): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (context === null) {
      this.cancel(); this.context = null; this.contextFingerprint = ''; ++this.epoch; this.publish('IDLE'); return Promise.resolve();
    }
    if (typeof context.authorizationKey !== 'string' || !context.authorizationKey.trim() || !validQuery(context.query)) {
      this.cancel(); this.context = null; this.contextFingerprint = ''; ++this.epoch; this.publish('ERROR', [], 'INVALID_DATA'); return Promise.resolve();
    }
    const q = context.query;
    const fingerprint = JSON.stringify([context.authorizationKey, q.territoryId, q.center.latitude, q.center.longitude, q.radiusMeters, q.status, q.categoryId]);
    if (fingerprint === this.contextFingerprint) return Promise.resolve();
    this.cancel(); ++this.epoch; this.contextFingerprint = fingerprint;
    this.context = Object.freeze({ authorizationKey: context.authorizationKey, query: Object.freeze({ territoryId: q.territoryId,
      center: Object.freeze({ latitude: q.center.latitude, longitude: q.center.longitude }), radiusMeters: q.radiusMeters, status: q.status, categoryId: q.categoryId }) });
    return this.refresh();
  }
  /** Explicit refresh/retry: no endless retries, polling or stale-data fallback. */
  async refresh(): Promise<void> {
    if (this.disposed || !this.context) return;
    this.cancel(); const generation = this.generation; const context = this.context;
    const controller = new AbortController(); this.abort = controller;
    this.publish('LOADING');
    if (this.disposed || generation !== this.generation) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const stop = new Promise<never>((_resolve, reject) => {
      this.cancelRace = () => reject(new Error('Cancelled'));
      timeout = setTimeout(() => { timedOut = true; reject(new NetworkMapSourceError('TIMEOUT')); controller.abort(); }, this.timeoutMs);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Cancelled');
        return this.source.loadMarkers(context.query, controller.signal);
      }), stop]);
      if (this.disposed || generation !== this.generation) return;
      if (controller.signal.aborted) throw new NetworkMapSourceError(timedOut ? 'TIMEOUT' : 'SERVER');
      if (!Array.isArray(result) || result.length > 2000) throw new NetworkMapSourceError('INVALID_DATA');
      const ids = new Set<string>(); const markers: NetworkMarkerV2[] = [];
      for (const marker of result) {
        if (!isNetworkMarkerV2(marker) || ids.has(marker.publicId) || marker.territoryId !== context.query.territoryId ||
          (context.query.categoryId !== null && marker.categoryId !== context.query.categoryId) ||
          (context.query.status === 'HISTORY' ? marker.kind !== 'REVIEWED_HISTORY' : marker.kind !== 'OPERATIONAL_EVENT' || marker.status !== context.query.status)) throw new NetworkMapSourceError('INVALID_DATA');
        ids.add(marker.publicId);
        if (Date.parse(marker.validUntil) > Date.now()) markers.push(copyMarker(marker));
      }
      this.publish(markers.length ? 'READY' : 'EMPTY', markers);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      const code = timedOut ? 'TIMEOUT' : error instanceof NetworkMapSourceError && ['NETWORK', 'SERVER', 'ACCESS_DENIED', 'INVALID_DATA', 'TIMEOUT'].includes(error.code) ? error.code : 'SERVER';
      this.publish('ERROR', [], code);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (generation === this.generation) { this.abort = null; this.cancelRace = null; }
    }
  }
  /** A subscription can request a fresh complete snapshot after publication withdrawal. */
  invalidate(): Promise<void> { return this.refresh(); }
  /** Recheck immediately on foreground; this method never starts a request. */
  revalidateTime() {
    if (this.disposed || !['READY', 'EMPTY'].includes(this.state.status)) return;
    const markers = this.state.snapshot.markers.filter(marker => Date.parse(marker.validUntil) > Date.now());
    this.publish(markers.length ? 'READY' : 'EMPTY', markers);
  }
  dispose() {
    if (this.disposed) return;
    this.cancel(); this.context = null; this.contextFingerprint = ''; ++this.epoch;
    this.state = this.makeState('IDLE', [], null); this.disposed = true;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* No sensitive logging. */ } }
    this.listeners.clear();
  }
}
