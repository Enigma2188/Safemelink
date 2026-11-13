import { isNetworkMarkerV2, isNetworkOperationalDetailV2, type NetworkOperationalDetailV2, type NetworkOperationalMarkerV2 } from '@/services/NetworkMapContractV2';
import { isNetworkCategoryIdV2, type NetworkCategoryIdV2 } from '@/services/NetworkCategoryRegistryV2';
import { NetworkMapSourceError, type NetworkMapMarkerSource, type NetworkMapQuery } from '@/services/NetworkMapController';
import type { NetworkSocialV2RpcArgs } from '@/services/NetworkSocialContractV2';

export type NetworkV2RpcArgs = NetworkSocialV2RpcArgs & {
  list_network_event_markers_v2: { target_territory: string; center_latitude: number; center_longitude: number; radius_meters: number; target_status: 'ACTIVE' | 'RESOLVED'; target_category: NetworkCategoryIdV2 | null };
  get_network_event_detail_v2: { target_public_id: string };
  create_network_event_v2: { target_operation: string; target_territory: string; event_latitude: number; event_longitude: number; location_selection: 'EXPLICIT_EVENT_POINT'; target_category: NetworkCategoryIdV2; target_description: string };
  finish_my_network_event_v2: { target_public_id: string; finish_kind: 'RESOLVED' | 'WITHDRAWN' };
  list_network_event_territories_v2: { center_latitude: number; center_longitude: number; radius_meters: number; page_size: number; after_code: string | null; after_id: string | null };
  list_network_map_cells_v2: { target_territory: string; radius_meters: number; viewer_latitude: number; viewer_longitude: number; target_level: string };
  list_network_zone_history_v2: { target_territory: string; target_zone: string; page_size: number; cursor_month: string | null; cursor_entry: string | null };
  get_network_author_updates_v2: { target_event: string };
  publish_network_author_update_v2: { target_event: string; target_operation: string; update_body: string };
  resolve_my_network_operation_v2: { target_kind: 'EVENT' | 'SOCIAL'; target_operation: string; prevent_late: boolean };
  list_my_network_events_v2: { page_size: number; before_created: string | null; before_id: string | null };
};
export type NetworkV2RpcReply = Readonly<{ data: unknown; error: unknown; status?: number }>;
/** Structural subset of Supabase rpc(...).abortSignal(...); no client is constructed. */
export interface NetworkV2RpcClient {
  rpc<Name extends keyof NetworkV2RpcArgs>(name: Name, args: NetworkV2RpcArgs[Name]): {
    abortSignal(signal: AbortSignal): PromiseLike<NetworkV2RpcReply>;
    setHeader?(name: string, value: string): { abortSignal(signal: AbortSignal): PromiseLike<NetworkV2RpcReply> };
  };
}
export type NetworkV2Transport = <Name extends keyof NetworkV2RpcArgs>(name: Name, args: NetworkV2RpcArgs[Name], signal: AbortSignal) => Promise<NetworkV2RpcReply>;
export function createNetworkV2SupabaseTransport(client: NetworkV2RpcClient): NetworkV2Transport {
  return async (name, args, signal) => await client.rpc(name, args).abortSignal(signal);
}
export type NetworkV2ErrorReason = 'ACCESS_DENIED' | 'INVALID_REQUEST' | 'INVALID_DATA' | 'NETWORK' | 'SERVER' | 'TIMEOUT' | 'ABORTED' | 'STALE_RESPONSE' | 'STALE_CONTEXT' | 'UNSUPPORTED_HISTORY' | 'RATE_LIMIT' | 'CONFLICT' | 'BACKEND_UNAVAILABLE';
export class NetworkV2Error extends NetworkMapSourceError {
  constructor(readonly reason: NetworkV2ErrorReason, readonly outcome: 'NOT_CONFIRMED' | 'UNKNOWN' = 'NOT_CONFIRMED') {
    super(reason === 'ACCESS_DENIED' || reason === 'STALE_CONTEXT' ? 'ACCESS_DENIED' : reason === 'NETWORK' ? 'NETWORK' :
      reason === 'TIMEOUT' ? 'TIMEOUT' : reason === 'INVALID_DATA' || reason === 'INVALID_REQUEST' ? 'INVALID_DATA' : 'SERVER');
  }
}
export type NetworkV2Submission = Readonly<{ publicId: string; status: 'ACTIVE' | 'RESOLVED'; publicationState: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'; replayed: boolean }>;
export type NetworkV2PublishRequest = Readonly<{ operationId: string; territoryId: string; eventPoint: Readonly<{ latitude: number; longitude: number }>;
  selection: 'EXPLICIT_EVENT_POINT'; categoryId: NetworkCategoryIdV2; description: string }>;
export type NetworkV2Territory = Readonly<{ territoryId: string; code: string; label: string; publicCenter: Readonly<{ latitude: number; longitude: number }>;
  locationPolicyVersion: string; geometrySource: string; geometryLicense: string; geometryVersion: string }>;
export type NetworkV2TerritoryQuery = Readonly<{ center: Readonly<{ latitude: number; longitude: number }>; radiusMeters: 1000 | 2500 | 5000 | 10000;
  pageSize: number; after?: Readonly<{ code: string; id: string }> }>;
/** Separate territorial history DTO: no invented operational category/marker or author. */
export type NetworkV2HistoryZone = Readonly<{ zoneId: string; label: string; availability: 'PUBLISHED' | 'INSUFFICIENT_DATA'; validUntil: string | null }>;
export type NetworkV2HistoryEntry = Readonly<{ entryId: string; zoneId: string; month: string; category: string; summary: string; state: 'CONCLUDED'; revision: number; validUntil: string }>;
export type NetworkV2HistoryPage = Readonly<{ entries: readonly NetworkV2HistoryEntry[]; availability: 'INSUFFICIENT_DATA' | 'REVIEWED_HISTORY'; nextCursor: Readonly<{ month: string; entryId: string }> | null }>;
export type NetworkOwnPublication = Readonly<{ publicId: string; categoryId: NetworkCategoryIdV2; status: 'ACTIVE' | 'RESOLVED'; publicationState: NetworkV2Submission['publicationState']; createdAt: string }>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const point = (value: { latitude: number; longitude: number } | undefined, limit = 85) => !!value &&
  Number.isFinite(value.latitude) && Math.abs(value.latitude) <= limit && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
const radii = [1000, 2500, 5000, 10000];
const invalid = () => new NetworkV2Error('INVALID_DATA');
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const month = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-01$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
function copyMarker(m: NetworkOperationalMarkerV2): NetworkOperationalMarkerV2 {
  return Object.freeze({ schemaVersion: m.schemaVersion, publicId: m.publicId, territoryId: m.territoryId, zoneId: m.zoneId,
    categoryId: m.categoryId, kind: m.kind, locationPolicyVersion: m.locationPolicyVersion, revision: m.revision, validUntil: m.validUntil,
    createdAt: m.createdAt, updatedAt: m.updatedAt,
    publicPosition: Object.freeze({ latitude: m.publicPosition.latitude, longitude: m.publicPosition.longitude,
      generalizationMeters: m.publicPosition.generalizationMeters, representation: m.publicPosition.representation }),
    ...(m.status === 'ACTIVE' ? { status: m.status, resolvedAt: null } : { status: m.status, resolvedAt: m.resolvedAt }) });
}
/** One owner/session epoch, no cache. Composition root owns auth changes and disposal. */
export class NetworkV2Repository implements NetworkMapMarkerSource {
  private epoch = 0;
  private disposed = false;
  private lanes = new Map<string, number>();
  private pending = new Set<AbortController>();
  constructor(private readonly transport: NetworkV2Transport, private readonly getAccessKey: () => string | null, private readonly timeoutMs = 12000) {
    if (typeof transport !== 'function' || typeof getAccessKey !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid adapter configuration');
  }
  private accessKey(): string | null {
    try { const value = this.getAccessKey(); return typeof value === 'string' && value.trim() ? value : null; }
    catch { return null; }
  }
  invalidate() { ++this.epoch; this.lanes.clear(); for (const request of this.pending) request.abort(); this.pending.clear(); }
  dispose() { this.disposed = true; this.invalidate(); }
  protected async request<Name extends keyof NetworkV2RpcArgs, T>(name: Name, args: NetworkV2RpcArgs[Name], signal: AbortSignal,
    decode: (data: unknown) => T, lane?: string, write = false): Promise<T> {
    const access = this.accessKey();
    if (this.disposed || !access) throw new NetworkV2Error('ACCESS_DENIED');
    if (signal.aborted) throw new NetworkV2Error('ABORTED');
    const epoch = this.epoch; const generation = lane ? (this.lanes.get(lane) ?? 0) + 1 : 0;
    if (lane) this.lanes.set(lane, generation);
    const controller = new AbortController(); this.pending.add(controller);
    let started = false; let timedOut = false; let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectStop: (error: unknown) => void = () => {};
    const unknown = () => write && started ? 'UNKNOWN' as const : 'NOT_CONFIRMED' as const;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    const abort = () => { rejectStop(new NetworkV2Error(timedOut ? 'TIMEOUT' : 'ABORTED', unknown())); controller.abort(); };
    const internalAbort = () => rejectStop(new NetworkV2Error(timedOut ? 'TIMEOUT' : 'ABORTED', unknown()));
    signal.addEventListener('abort', abort, { once: true }); controller.signal.addEventListener('abort', internalAbort, { once: true });
    timer = setTimeout(() => { timedOut = true; abort(); }, this.timeoutMs);
    const current = () => !this.disposed && this.epoch === epoch && this.accessKey() === access;
    try {
      const response = await Promise.race([Promise.resolve().then(() => {
        if (!current() || controller.signal.aborted || signal.aborted) throw new NetworkV2Error('STALE_CONTEXT', unknown());
        started = true; return this.transport(name, args, controller.signal);
      }), stopped]);
      if (!current()) throw new NetworkV2Error('STALE_CONTEXT', unknown());
      if (timedOut || controller.signal.aborted || signal.aborted) throw new NetworkV2Error(timedOut ? 'TIMEOUT' : 'ABORTED', unknown());
      if (lane && this.lanes.get(lane) !== generation) throw new NetworkV2Error('STALE_RESPONSE');
      if (!record(response) || !('data' in response) || !('error' in response)) throw invalid();
      if (response.error !== null && !record(response.error)) throw invalid();
      if (response.error === null && typeof response.status === 'number' && (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300)) {
        throw new NetworkV2Error('SERVER', unknown());
      }
      if (response.error !== null) {
        const code = record(response.error) && typeof response.error.code === 'string' ? response.error.code : '';
        const status = typeof response.status === 'number' ? response.status : 0;
        const reason: NetworkV2ErrorReason = code === '42501' || status === 401 || status === 403 ? 'ACCESS_DENIED' :
          code === '22023' ? 'INVALID_REQUEST' : code === '23505' || code === '40001' ? 'CONFLICT' :
            code === '54000' || status === 429 ? 'RATE_LIMIT' : code === 'PGRST202' || code === '42883' || code === '42P01' ? 'BACKEND_UNAVAILABLE' :
              status === 0 ? 'NETWORK' : 'SERVER';
        const rejected = ['42501','22023','23505','40001','54000','42883','42P01','PGRST202'].includes(code);
        throw new NetworkV2Error(reason, write && !rejected ? unknown() : 'NOT_CONFIRMED');
      }
      return decode(response.data);
    } catch (error) {
      if (!current()) throw new NetworkV2Error('STALE_CONTEXT', unknown());
      if (lane && this.lanes.get(lane) !== generation) throw new NetworkV2Error('STALE_RESPONSE');
      if (timedOut) throw new NetworkV2Error('TIMEOUT', unknown());
      if (error instanceof NetworkV2Error) {
        if (write && started && error.reason === 'INVALID_DATA') throw new NetworkV2Error('INVALID_DATA', 'UNKNOWN');
        throw error;
      }
      throw new NetworkV2Error('NETWORK', unknown());
    } finally {
      if (timer !== undefined) clearTimeout(timer); signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', internalAbort); this.pending.delete(controller);
    }
  }
  async loadMarkers(query: NetworkMapQuery, signal: AbortSignal): Promise<readonly NetworkOperationalMarkerV2[]> {
    if (query.status === 'HISTORY') throw new NetworkV2Error('UNSUPPORTED_HISTORY');
    if (!uuid(query.territoryId) || !point(query.center) || !radii.includes(query.radiusMeters) ||
      !['ACTIVE','RESOLVED'].includes(query.status) || (query.categoryId !== null && !isNetworkCategoryIdV2(query.categoryId))) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('list_network_event_markers_v2', { target_territory: query.territoryId, center_latitude: query.center.latitude,
      center_longitude: query.center.longitude, radius_meters: query.radiusMeters, target_status: query.status, target_category: query.categoryId }, signal, data => {
      if (!Array.isArray(data) || data.length > 2000) throw invalid(); const ids = new Set<string>(); const result: NetworkOperationalMarkerV2[] = [];
      for (const candidate of data) {
        if (!isNetworkMarkerV2(candidate) || candidate.kind !== 'OPERATIONAL_EVENT' || !uuid(candidate.publicId) ||
          ids.has(candidate.publicId) || candidate.territoryId !== query.territoryId || candidate.status !== query.status ||
          (query.categoryId !== null && candidate.categoryId !== query.categoryId)) throw invalid();
        ids.add(candidate.publicId); if (Date.parse(candidate.validUntil) > Date.now()) result.push(copyMarker(candidate));
      }
      return Object.freeze(result);
    }, 'markers');
  }
  async loadDetail(publicId: string, signal: AbortSignal): Promise<NetworkOperationalDetailV2> {
    if (!uuid(publicId)) throw new NetworkV2Error('INVALID_REQUEST');
    const detail = await this.request('get_network_event_detail_v2', { target_public_id: publicId }, signal, data => {
      if (!isNetworkOperationalDetailV2(data) || data.marker.publicId !== publicId || Date.parse(data.marker.validUntil) <= Date.now()) throw invalid();
      return Object.freeze({ marker: copyMarker(data.marker), description: data.description, authorNickname: data.authorNickname,
        confirmations: Object.freeze({ confirmedCount: data.confirmations.confirmedCount, noLongerPresentCount: data.confirmations.noLongerPresentCount, myConfirmation: data.confirmations.myConfirmation }),
        updates: Object.freeze(data.updates.map(update => Object.freeze({ publicId: update.publicId, authorRole: update.authorRole, body: update.body, createdAt: update.createdAt }))) });
    }, 'detail');
    return this.request('get_network_author_updates_v2', { target_event: publicId }, signal, data => {
      if (!exact(data, ['eventId','revision','validUntil','updates']) || data.eventId !== publicId || data.revision !== detail.marker.revision ||
        !timestamp(data.validUntil) || Date.parse(data.validUntil) <= Date.now() || Date.parse(data.validUntil) > Date.parse(detail.marker.validUntil)) throw invalid();
      const merged = { ...detail, marker: { ...detail.marker, validUntil: new Date(data.validUntil).toISOString() }, updates: data.updates };
      if (!isNetworkOperationalDetailV2(merged) || merged.updates.length > 50) throw invalid();
      return Object.freeze({ ...detail, marker: copyMarker(merged.marker), updates: Object.freeze(merged.updates.map(u => Object.freeze({
        publicId: u.publicId, body: u.body, createdAt: u.createdAt, authorRole: u.authorRole }))) });
    }, 'author-updates');
  }
  async publish(request: NetworkV2PublishRequest, signal: AbortSignal): Promise<NetworkV2Submission> {
    if (!uuid(request.operationId) || !uuid(request.territoryId) || !point(request.eventPoint) || request.selection !== 'EXPLICIT_EVENT_POINT' ||
      !isNetworkCategoryIdV2(request.categoryId) || typeof request.description !== 'string' || request.description.trim().length < 10 || request.description.trim().length > 500) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('create_network_event_v2', { target_operation: request.operationId, target_territory: request.territoryId,
      event_latitude: request.eventPoint.latitude, event_longitude: request.eventPoint.longitude, location_selection: request.selection,
      target_category: request.categoryId, target_description: request.description.trim() }, signal, data => {
      if (!exact(data, ['publicId','status','publicationState','replayed']) || !uuid(data.publicId) ||
        !['ACTIVE','RESOLVED'].includes(data.status as string) || !['PENDING','APPROVED','REJECTED','WITHDRAWN'].includes(data.publicationState as string) || typeof data.replayed !== 'boolean') throw invalid();
      return Object.freeze({ publicId: data.publicId, status: data.status as NetworkV2Submission['status'], publicationState: data.publicationState as NetworkV2Submission['publicationState'], replayed: data.replayed });
    }, undefined, true);
  }
  async finish(publicId: string, kind: 'RESOLVED' | 'WITHDRAWN', signal: AbortSignal): Promise<void> {
    if (!uuid(publicId) || !['RESOLVED','WITHDRAWN'].includes(kind)) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('finish_my_network_event_v2', { target_public_id: publicId, finish_kind: kind }, signal, data => { if (data !== null) throw invalid(); }, undefined, true);
  }
  async loadTerritories(query: NetworkV2TerritoryQuery, signal: AbortSignal): Promise<readonly NetworkV2Territory[]> {
    if (!point(query.center) || !radii.includes(query.radiusMeters) || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 ||
      (query.after && (!uuid(query.after.id) || !text(query.after.code)))) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('list_network_event_territories_v2', { center_latitude: query.center.latitude, center_longitude: query.center.longitude,
      radius_meters: query.radiusMeters, page_size: query.pageSize, after_code: query.after?.code ?? null, after_id: query.after?.id ?? null }, signal, data => {
      if (!Array.isArray(data) || data.length > query.pageSize) throw invalid(); const ids = new Set<string>();
      return Object.freeze(data.map(candidate => {
        if (!exact(candidate, ['territoryId','code','label','publicCenter','locationPolicyVersion','geometrySource','geometryLicense','geometryVersion']) ||
          !uuid(candidate.territoryId) || ids.has(candidate.territoryId) || !exact(candidate.publicCenter, ['latitude','longitude']) ||
          typeof candidate.publicCenter.latitude !== 'number' || typeof candidate.publicCenter.longitude !== 'number' ||
          !point({ latitude: candidate.publicCenter.latitude, longitude: candidate.publicCenter.longitude }, 90) ||
          !text(candidate.code) || !text(candidate.label) || !text(candidate.locationPolicyVersion) || !text(candidate.geometrySource) || !text(candidate.geometryLicense) || !text(candidate.geometryVersion)) throw invalid();
        ids.add(candidate.territoryId);
        return Object.freeze({ territoryId: candidate.territoryId, code: candidate.code, label: candidate.label,
          publicCenter: Object.freeze({ latitude: candidate.publicCenter.latitude, longitude: candidate.publicCenter.longitude }),
          locationPolicyVersion: candidate.locationPolicyVersion, geometrySource: candidate.geometrySource, geometryLicense: candidate.geometryLicense, geometryVersion: candidate.geometryVersion });
      }));
    }, 'territories');
  }
  async loadHistoryZones(query: NetworkV2TerritoryQuery & { territoryId: string }, signal: AbortSignal): Promise<readonly NetworkV2HistoryZone[]> {
    if (!uuid(query.territoryId) || !point(query.center) || !radii.includes(query.radiusMeters)) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('list_network_map_cells_v2', { target_territory: query.territoryId, radius_meters: query.radiusMeters,
      viewer_latitude: query.center.latitude, viewer_longitude: query.center.longitude, target_level: 'BASE' }, signal, data => {
      if (!exact(data, ['zones']) || !Array.isArray(data.zones) || data.zones.length > 2000) throw invalid();
      const ids = new Set<string>();
      return Object.freeze(data.zones.map(z => {
        if (!exact(z, ['zoneId','level','label','geometry','availability','activityBand','periodStart','periodEnd','validUntil','policyVersion']) ||
          !uuid(z.zoneId) || ids.has(z.zoneId) || z.level !== 'BASE' || !text(z.label) || z.label.length > 200 ||
          !['PUBLISHED','INSUFFICIENT_DATA'].includes(z.availability as string) ||
          (z.availability === 'PUBLISHED' && (!timestamp(z.validUntil) || Date.parse(z.validUntil) <= Date.now())) ||
          (z.availability === 'INSUFFICIENT_DATA' && z.validUntil !== null)) throw invalid();
        ids.add(z.zoneId);
        // Geometry, aggregate bands and periods are deliberately not copied to an event marker.
        return Object.freeze({ zoneId: z.zoneId, label: z.label, availability: z.availability as NetworkV2HistoryZone['availability'], validUntil: z.validUntil as string | null });
      }));
    }, 'history-zones');
  }
  async loadHistory(territoryId: string, zoneId: string, signal: AbortSignal, cursor?: NetworkV2HistoryPage['nextCursor']): Promise<NetworkV2HistoryPage> {
    if (!uuid(territoryId) || !uuid(zoneId) || (cursor && (!month(cursor.month) || !uuid(cursor.entryId)))) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('list_network_zone_history_v2', { target_territory: territoryId, target_zone: zoneId, page_size: 20,
      cursor_month: cursor?.month ?? null, cursor_entry: cursor?.entryId ?? null }, signal, data => {
      if (!exact(data, ['entries','availability','nextCursor']) || !Array.isArray(data.entries) || data.entries.length > 20 ||
        !['INSUFFICIENT_DATA','REVIEWED_HISTORY'].includes(data.availability as string) ||
        (data.nextCursor !== null && (!exact(data.nextCursor, ['month','entryId']) || !month(data.nextCursor.month) || !uuid(data.nextCursor.entryId)))) throw invalid();
      const ids = new Set<string>();
      const entries = data.entries.map(e => {
        if (!exact(e, ['entryId','zoneId','month','category','summary','state','revision','validUntil']) || !uuid(e.entryId) || ids.has(e.entryId) ||
          e.zoneId !== zoneId || !month(e.month) || !text(e.category) || e.category.length > 80 || !text(e.summary) || e.summary.length < 10 || e.summary.length > 500 ||
          e.state !== 'CONCLUDED' || !Number.isSafeInteger(e.revision) || (e.revision as number) < 1 || !timestamp(e.validUntil) || Date.parse(e.validUntil) <= Date.now()) throw invalid();
        ids.add(e.entryId);
        return Object.freeze({ entryId: e.entryId, zoneId, month: e.month, category: e.category, summary: e.summary,
          state: 'CONCLUDED' as const, revision: e.revision as number, validUntil: e.validUntil });
      });
      if ((entries.length === 0) !== (data.availability === 'INSUFFICIENT_DATA') || (!entries.length && data.nextCursor !== null)) throw invalid();
      return Object.freeze({ entries: Object.freeze(entries), availability: data.availability as NetworkV2HistoryPage['availability'],
        nextCursor: data.nextCursor === null ? null : Object.freeze({ month: data.nextCursor.month as string, entryId: data.nextCursor.entryId as string }) });
    }, 'history-page');
  }
  async loadOwn(signal: AbortSignal, before?: NetworkOwnPublication): Promise<readonly NetworkOwnPublication[]> {
    if (before && (!uuid(before.publicId) || !timestamp(before.createdAt))) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('list_my_network_events_v2',{ page_size: 20, before_created: before?.createdAt ?? null, before_id: before?.publicId ?? null },signal,data => {
      if (!Array.isArray(data) || data.length > 20) throw invalid();const ids=new Set<string>();
      return Object.freeze(data.map(r => {
        if (!exact(r,['publicId','categoryId','status','publicationState','createdAt']) || !uuid(r.publicId) || ids.has(r.publicId) || !isNetworkCategoryIdV2(r.categoryId) ||
          !['ACTIVE','RESOLVED'].includes(String(r.status)) || !['PENDING','APPROVED','REJECTED','WITHDRAWN'].includes(String(r.publicationState)) ||
          !timestamp(r.createdAt) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(r.createdAt)) throw invalid();
        ids.add(r.publicId);return Object.freeze({ publicId:r.publicId,categoryId:r.categoryId,status:r.status as 'ACTIVE'|'RESOLVED',publicationState:r.publicationState as NetworkV2Submission['publicationState'],createdAt:r.createdAt });
      }));
    },'owner-page');
  }
}
