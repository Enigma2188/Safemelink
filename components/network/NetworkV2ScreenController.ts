import { NetworkMapController, type NetworkMapControllerState } from '@/services/NetworkMapController';
import { NetworkV2Error, NetworkV2Repository, type NetworkV2Transport, type NetworkV2Territory,
  type NetworkV2PublishRequest, type NetworkV2Submission, type NetworkV2HistoryZone, type NetworkV2HistoryPage, type NetworkOwnPublication } from '@/backend/repositories/NetworkV2Repository';
import type { NetworkCategoryIdV2 } from '@/services/NetworkCategoryRegistryV2';
import type { NetworkOperationalDetailV2 } from '@/services/NetworkMapContractV2';
import { networkMapRegionForRadius, validNetworkMapRegion } from './NetworkMapModel';
import type { NetworkMapProps, NetworkMapRegion, NetworkMapSelection } from './NetworkMap.types';

export interface NetworkV2AccessContext { getKey(): string | null; getOwner?(): string | null; subscribe(listener: () => void): () => void }
type Point = Readonly<{ latitude: number; longitude: number }>;
export type NetworkV2Draft = Readonly<{ point: Point | null; confirmed: boolean; categoryId: NetworkCategoryIdV2 | null; description: string;
  state: 'EDITING' | 'SUBMITTING' | 'UNKNOWN' | 'ERROR' | 'RECEIVED'; locked: boolean; receipt: NetworkV2Submission | null; error: string | null }>;
export type NetworkV2ScreenState = Readonly<{
  authenticated: boolean; territories: readonly NetworkV2Territory[]; territoryStatus: 'IDLE' | 'LOADING' | 'READY' | 'EMPTY' | 'ERROR';
  hasMoreTerritories: boolean; territory: NetworkV2Territory | null; radius: 1000 | 2500 | 5000 | 10000;
  categoryId: NetworkCategoryIdV2 | null; status: 'ACTIVE' | 'RESOLVED'; feed: NetworkMapControllerState;
  camera: NetworkMapProps['camera']; panel: 'NONE' | 'DETAIL' | 'LIST' | 'DRAFT' | 'HISTORY' | 'OWN'; selectedId: string | null;
  detailStatus: 'IDLE' | 'LOADING' | 'READY' | 'ERROR'; detail: NetworkOperationalDetailV2 | null;
  clusterIds: readonly string[]; draft: NetworkV2Draft | null; notice: string | null;
  history: Readonly<{ phase: 'IDLE' | 'LOADING' | 'READY' | 'ERROR'; zones: readonly NetworkV2HistoryZone[]; zoneId: string | null; page: NetworkV2HistoryPage | null }>;
  finish: Readonly<{ publicId: string; kind: 'RESOLVED' | 'WITHDRAWN'; state: 'SENDING' | 'UNKNOWN' }> | null;
  own: Readonly<{ phase: 'IDLE' | 'LOADING' | 'READY' | 'ERROR'; rows: readonly NetworkOwnPublication[]; hasMore: boolean }>;
}>;
export function networkV2ErrorText(error: unknown): string {
  if (!(error instanceof NetworkV2Error)) return 'Servizio non disponibile. Riprova senza cambiare tentativo.';
  switch (error.reason) {
    case 'BACKEND_UNAVAILABLE': return 'NETWORK V2 non è disponibile su questo ambiente.';
    case 'ACCESS_DENIED': case 'STALE_CONTEXT': return 'Sessione o autorizzazione non disponibile. Verifica l’accesso.';
    case 'NETWORK': return 'Connessione o servizio non raggiungibile. Nessun risultato precedente è considerato valido.';
    case 'TIMEOUT': return 'Il servizio non ha risposto entro il tempo previsto.';
    case 'RATE_LIMIT': return 'Limite richieste raggiunto oppure area troppo densa. Attendi o restringi la ricerca.';
    case 'INVALID_REQUEST': return 'Dati o luogo non accettati dal servizio. Verifica la selezione e la policy del territorio.';
    case 'UNSUPPORTED_HISTORY': return 'Lo storico revisionato non è ancora collegato.';
    case 'CONFLICT': return 'Tentativo in conflitto. Non creare automaticamente una nuova operazione.';
    default: return 'Risposta non utilizzabile. Aggiorna o riprova lo stesso tentativo.';
  }
}
const validPoint = (p: Point) => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 85 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
/** Presentation orchestration, not a second map/data/social backend. No work in constructor. */
export class NetworkV2ScreenController {
  readonly map: NetworkMapController;
  private readonly repository: NetworkV2Repository;
  private state: NetworkV2ScreenState;
  private readonly listeners = new Set<() => void>();
  private active = false; private disposed = false; private key: string | null = null; private epoch = 0;
  private cameraId = 0; private viewport: NetworkMapRegion;
  private unsubscribeAccess: (() => void) | null = null; private unsubscribeMap: (() => void) | null = null;
  private catalogAbort: AbortController | null = null; private detailAbort: AbortController | null = null; private writeAbort: AbortController | null = null;
  private catalogGeneration = 0; private detailGeneration = 0; private detailTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt: NetworkV2PublishRequest | null = null;
  private attemptUncertain = false; private feedKey = '';
  private historyGeneration = 0; private historyAbort: AbortController | null = null;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private finishAbort: AbortController | null = null;
  private ownAbort: AbortController | null = null; private ownGeneration = 0; private ownTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(transport: NetworkV2Transport, private readonly access: NetworkV2AccessContext,
    private readonly createOperationId: () => string, private readonly initialRegion: NetworkMapRegion) {
    if (!validNetworkMapRegion(initialRegion)) throw new Error('Valid dynamic initial region required');
    this.viewport = { ...initialRegion };
    this.repository = new NetworkV2Repository(transport, () => this.readKey());
    this.map = new NetworkMapController({ loadMarkers: async (query, signal) => {
      const epoch = this.epoch; if (!this.current(epoch)) throw new NetworkV2Error('STALE_CONTEXT');
      const markers = await this.repository.loadMarkers(query, signal);
      if (!this.current(epoch)) throw new NetworkV2Error('STALE_CONTEXT'); return markers;
    } });
    this.state = this.initialState();
  }
  private initialState(): NetworkV2ScreenState {
    return Object.freeze({ authenticated: false, territories: [], territoryStatus: 'IDLE', hasMoreTerritories: false,
      territory: null, radius: 2500, categoryId: null, status: 'ACTIVE', feed: this.map.getState(),
      camera: { requestId: `reset-${++this.cameraId}`, region: { ...this.initialRegion } }, panel: 'NONE', selectedId: null,
      detailStatus: 'IDLE', detail: null, clusterIds: [], draft: null, notice: null, finish: null,
      history: { phase: 'IDLE' as const, zones: [], zoneId: null, page: null }, own: { phase: 'IDLE' as const, rows: [], hasMore: false } });
  }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<NetworkV2ScreenState>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* No payload logging. */ } }
  }
  private readKey() { try { const value = this.access.getKey(); return typeof value === 'string' && value.trim() ? value : null; } catch { return null; } }
  private current(epoch: number) { return this.active && !this.disposed && epoch === this.epoch && !!this.key && this.readKey() === this.key; }
  private ready() { if (this.current(this.epoch)) return true; this.authChanged(); return false; }
  private clearDetail() {
    ++this.detailGeneration; this.detailAbort?.abort(); this.detailAbort = null;
    if (this.detailTimer !== null) clearTimeout(this.detailTimer); this.detailTimer = null;
  }
  private clearHistory() {
    this.clearOwn();
    ++this.historyGeneration; this.historyAbort?.abort(); this.historyAbort = null;
    if (this.historyTimer !== null) clearTimeout(this.historyTimer); this.historyTimer = null;
    this.state = Object.freeze({ ...this.state, history: { phase: 'IDLE' as const, zones: [], zoneId: null, page: null } });
  }
  private reset() {
    this.clearOwn();
    ++this.epoch; ++this.catalogGeneration; this.catalogAbort?.abort(); this.catalogAbort = null; this.clearDetail(); this.clearHistory();
    this.finishAbort?.abort(); this.finishAbort = null;
    this.writeAbort?.abort(); this.writeAbort = null; this.attempt = null; this.attemptUncertain = false; this.feedKey = '';
    // Remove private UI state before callbacks from clearing the independently subscribed map.
    this.state = Object.freeze({ ...this.initialState(), feed: Object.freeze({ ...this.map.getState(), status: 'IDLE' as const,
      snapshot: Object.freeze({ ...this.map.getState().snapshot, state: 'LOADING' as const, markers: [] }) }) });
    this.repository.invalidate(); void this.map.setContext(null); this.viewport = { ...this.initialRegion };
    this.state = this.initialState(); this.publish({ authenticated: !!this.key });
  }
  private authChanged() {
    if (!this.active || this.disposed) return;
    const next = this.readKey(); if (next === this.key) return; this.key = next; this.reset();
    if (next) void this.discover();
  }
  start() {
    if (this.active || this.disposed) return; this.active = true;
    this.unsubscribeMap = this.map.subscribe(() => {
      if (!this.active) return;
      if (this.readKey() !== this.key) { this.authChanged(); return; }
      const feed = this.map.getState();
      const selected = feed.snapshot.markers.find(marker => marker.publicId === this.state.selectedId);
      if (this.state.selectedId && (!selected || (this.state.detail && selected.revision !== this.state.detail.marker.revision))) {
        this.clearDetail(); this.publish({ feed, selectedId: null, detail: null, detailStatus: 'IDLE', clusterIds: [] });
      } else this.publish({ feed });
    });
    this.unsubscribeAccess = this.access.subscribe(() => this.authChanged()); this.authChanged();
  }
  stop() {
    this.active = false; this.unsubscribeAccess?.(); this.unsubscribeMap?.(); this.unsubscribeAccess = this.unsubscribeMap = null;
    this.key = null; this.reset();
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.stop(); this.map.dispose(); this.repository.dispose(); this.listeners.clear(); }
  setViewport(region: NetworkMapRegion) { if (validNetworkMapRegion(region)) this.viewport = { ...region }; }
  private lockedContext() {
    if (this.state.finish) { this.publish({ notice: 'Verifica prima la chiusura in corso o incerta.' }); return true; }
    if (this.state.draft?.state === 'SUBMITTING' || this.state.draft?.state === 'UNKNOWN') {
      this.publish({ notice: 'Verifica l’invio in corso o incerto prima di cambiare contesto.' }); return true;
    }
    if (this.state.draft && this.state.draft.state !== 'RECEIVED' && (this.state.draft.point || this.state.draft.description)) {
      this.publish({ notice: 'Annulla o completa la bozza prima di cambiare territorio o filtri.' }); return true;
    }
    return false;
  }
  async discover(nextPage = false): Promise<void> {
    if (!this.ready() || this.lockedContext()) return;
    const last = nextPage ? this.state.territories.at(-1) : undefined;
    const epoch = this.epoch, generation = ++this.catalogGeneration; this.catalogAbort?.abort();
    const abort = new AbortController(); this.catalogAbort = abort; this.clearDetail(); this.clearHistory(); this.attempt = null;
    void this.map.setContext(null);
    this.feedKey = '';
    this.publish({ territoryStatus: 'LOADING', territories: [], hasMoreTerritories: false, territory: null,
      selectedId: null, detail: null, detailStatus: 'IDLE', panel: 'NONE', draft: null, clusterIds: [], notice: null });
    try {
      const territories = await this.repository.loadTerritories({ center: { latitude: this.viewport.latitude, longitude: this.viewport.longitude },
        radiusMeters: this.state.radius, pageSize: 50, after: last ? { code: last.code, id: last.territoryId } : undefined }, abort.signal);
      if (this.current(epoch) && generation === this.catalogGeneration) this.publish({ territories,
        territoryStatus: territories.length ? 'READY' : 'EMPTY', hasMoreTerritories: territories.length === 50 });
    } catch (error) { if (this.current(epoch) && generation === this.catalogGeneration) this.publish({ territoryStatus: 'ERROR', notice: networkV2ErrorText(error) }); }
  }
  async chooseTerritory(id: string): Promise<void> {
    if (!this.ready() || this.lockedContext()) return;
    const territory = this.state.territories.find(row => row.territoryId === id); if (!territory) return;
    this.clearDetail(); this.clearHistory(); this.attempt = null;
    const region = networkMapRegionForRadius(territory.publicCenter, this.state.radius, 1); if (!region) return;
    this.viewport = region;
    this.publish({ territory, selectedId: null, detail: null, detailStatus: 'IDLE', draft: null, panel: 'NONE', clusterIds: [], notice: null,
      camera: { requestId: `territory-${++this.cameraId}`, region } });
    await this.refresh();
  }
  async setFilters(patch: Partial<Pick<NetworkV2ScreenState, 'radius' | 'categoryId' | 'status'>>): Promise<void> {
    if (!this.ready() || this.lockedContext()) return;
    this.clearDetail(); this.clearHistory(); this.attempt = null;
    this.publish({ ...patch, selectedId: null, detail: null, detailStatus: 'IDLE', panel: 'NONE', draft: null, clusterIds: [], notice: null });
    if (patch.radius) {
      const region = networkMapRegionForRadius(this.viewport, patch.radius, 1);
      if (region) { this.viewport = region; this.publish({ camera: { requestId: `radius-${++this.cameraId}`, region } }); }
    }
    if (this.state.territory) await this.refresh();
  }
  async refresh(): Promise<void> {
    if (!this.ready() || !this.state.territory) return;
    this.clearHistory();
    this.clearDetail(); this.publish({ detail: null, detailStatus: 'IDLE', selectedId: null, clusterIds: [],
      camera: { requestId: `refresh-${++this.cameraId}`, region: { ...this.viewport } } });
    const context = { authorizationKey: this.key!, query: { territoryId: this.state.territory.territoryId,
      center: { latitude: this.viewport.latitude, longitude: this.viewport.longitude }, radiusMeters: this.state.radius,
      status: this.state.status, categoryId: this.state.categoryId } };
    const key = JSON.stringify(context);
    if (key === this.feedKey) await this.map.refresh();
    else { this.feedKey = key; await this.map.setContext(context); }
  }
  async retryFeed(): Promise<void> { if (!this.ready()) return; this.clearDetail(); this.publish({ detail: null, detailStatus: 'IDLE', selectedId: null }); await this.map.refresh(); }
  showEvents(selection?: NetworkMapSelection) {
    if (!this.ready()) return;
    this.clearHistory();
    const available = this.map.getState().snapshot.markers.filter(marker => marker.kind === 'OPERATIONAL_EVENT' && Date.parse(marker.validUntil) > Date.now());
    const ids = selection ? selection.publicIds.filter(id => available.some(marker => marker.publicId === id)) : available.map(marker => marker.publicId);
    if (selection?.kind === 'EVENT' && ids.length === 1) { void this.openDetail(ids[0]); return; }
    this.clearDetail(); this.publish({ panel: 'LIST', clusterIds: Object.freeze([...ids]), detail: null, detailStatus: 'IDLE', selectedId: null });
  }
  async openDetail(id: string): Promise<void> {
    if (!this.ready() || !this.map.getState().snapshot.markers.some(marker => marker.kind === 'OPERATIONAL_EVENT' && marker.publicId === id && Date.parse(marker.validUntil) > Date.now())) return;
    this.clearHistory();
    this.clearDetail(); const epoch = this.epoch, generation = this.detailGeneration;
    const abort = new AbortController(); this.detailAbort = abort;
    this.publish({ panel: 'DETAIL', selectedId: id, detail: null, detailStatus: 'LOADING', notice: null });
    try {
      const detail = await this.repository.loadDetail(id, abort.signal);
      if (this.current(epoch) && generation === this.detailGeneration && this.state.selectedId === id) {
        this.publish({ detail, detailStatus: 'READY' }); this.scheduleDetailExpiry();
      }
    } catch (error) { if (this.current(epoch) && generation === this.detailGeneration) this.publish({ detail: null, detailStatus: 'ERROR', notice: networkV2ErrorText(error) }); }
  }
  private scheduleDetailExpiry() {
    if (this.detailTimer !== null) clearTimeout(this.detailTimer);
    if (!this.state.detail) return;
    const epoch = this.epoch;
    this.detailTimer = setTimeout(() => { this.detailTimer = null; if (this.current(epoch)) this.revalidateTime(); },
      Math.max(1, Math.min(60000, Date.parse(this.state.detail.marker.validUntil) - Date.now() + 1)));
  }
  revalidateTime() {
    if (!this.ready()) return; this.map.revalidateTime();
    if (this.state.detail && Date.parse(this.state.detail.marker.validUntil) <= Date.now()) {
      this.clearDetail(); this.publish({ detail: null, detailStatus: 'ERROR', selectedId: null, notice: 'La disponibilità della segnalazione è scaduta. Aggiorna.' });
    } else this.scheduleDetailExpiry();
  }
  /** One read on foreground, not polling: don't keep a previously read detail as proof of access. */
  async onForeground(): Promise<void> {
    if (!this.ready()) return;
    if (this.state.panel === 'OWN') { await this.showOwn(); return; }
    if (this.state.panel === 'HISTORY') { await this.showHistory(); return; }
    this.clearDetail(); this.publish({ detail: null, detailStatus: 'IDLE', selectedId: null, clusterIds: [] });
    if (this.state.territory) await this.refresh();
    else if (!this.lockedContext()) await this.discover();
  }
  closePanel() { this.clearDetail(); this.clearHistory(); this.clearOwn(); this.publish({ panel: 'NONE', detail: null, detailStatus: 'IDLE', selectedId: null }); }
  beginDraft() {
    if (!this.ready() || !this.state.territory || this.state.finish) return;
    if (this.state.draft) { this.publish({ panel: 'DRAFT' }); return; }
    this.clearDetail(); this.clearHistory(); this.attempt = null; this.attemptUncertain = false;
    this.publish({ panel: 'DRAFT', detail: null, detailStatus: 'IDLE', selectedId: null, notice: null,
      draft: { point: null, confirmed: false, categoryId: this.state.categoryId, description: '', state: 'EDITING', locked: false, receipt: null, error: null } });
  }
  chooseEventPoint(point: Point) {
    const draft = this.state.draft;
    if (!this.ready() || this.state.panel !== 'DRAFT' || !draft || draft.locked || !validPoint(point)) return;
    this.publish({ draft: { ...draft, point: Object.freeze({ latitude: point.latitude, longitude: point.longitude }), confirmed: false } });
  }
  confirmEventPoint() { const draft = this.state.draft; if (this.ready() && draft?.point && !draft.locked) this.publish({ draft: { ...draft, confirmed: true } }); }
  editDraft(patch: Partial<Pick<NetworkV2Draft, 'categoryId' | 'description'>>) {
    const draft = this.state.draft; if (this.ready() && draft && !draft.locked) this.publish({ draft: { ...draft, ...patch } });
  }
  cancelDraft() {
    if (this.state.draft?.state === 'UNKNOWN' || this.state.draft?.state === 'SUBMITTING') { this.closePanel(); return; }
    this.attempt = null; this.attemptUncertain = false; this.publish({ draft: null, panel: 'NONE' });
  }
  async publishDraft(): Promise<void> {
    if (!this.ready() || !this.state.territory || !this.state.draft || this.state.draft.state === 'SUBMITTING' || this.state.draft.state === 'RECEIVED') return;
    const draft = this.state.draft;
    if (!this.attempt) {
      if (!draft.point || !draft.confirmed || !draft.categoryId || draft.description.trim().length < 10 || draft.description.trim().length > 500) return;
      let operationId: string;
      try { operationId = this.createOperationId(); } catch { this.publish({ notice: 'Generazione sicura dell’operazione non disponibile.' }); return; }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) { this.publish({ notice: 'Identificativo operazione non valido: invio bloccato.' }); return; }
      this.attempt = Object.freeze({ operationId, territoryId: this.state.territory.territoryId, eventPoint: draft.point,
        selection: 'EXPLICIT_EVENT_POINT', categoryId: draft.categoryId, description: draft.description.trim() });
    }
    const epoch = this.epoch, request = this.attempt, abort = new AbortController(); this.writeAbort = abort;
    this.publish({ draft: { ...draft, state: 'SUBMITTING', locked: true, error: null } });
    try {
      const receipt = await this.repository.publish(request, abort.signal);
      if (this.current(epoch) && this.attempt === request && this.state.draft) {
        this.attemptUncertain = false; this.publish({ draft: { ...this.state.draft, state: 'RECEIVED', receipt, error: null } });
      }
    } catch (error) {
      if (this.current(epoch) && this.attempt === request && this.state.draft) {
        this.attemptUncertain ||= error instanceof NetworkV2Error && error.outcome === 'UNKNOWN';
        this.publish({ draft: { ...this.state.draft, state: this.attemptUncertain ? 'UNKNOWN' : 'ERROR', error: networkV2ErrorText(error) } });
      }
    } finally { if (this.writeAbort === abort) this.writeAbort = null; }
  }
  async showHistory(): Promise<void> {
    if (!this.ready() || !this.state.territory || this.lockedContext()) return;
    this.clearDetail(); this.clearHistory(); const generation = this.historyGeneration, epoch = this.epoch;
    const abort = new AbortController(); this.historyAbort = abort;
    this.publish({ panel: 'HISTORY', detail: null, selectedId: null, detailStatus: 'IDLE', notice: null,
      history: { phase: 'LOADING', zones: [], zoneId: null, page: null } });
    try {
      const zones = await this.repository.loadHistoryZones({ territoryId: this.state.territory.territoryId,
        center: this.viewport, radiusMeters: this.state.radius, pageSize: 20 }, abort.signal);
      if (!this.current(epoch) || generation !== this.historyGeneration) return;
      this.publish({ history: { phase: 'READY', zones, zoneId: null, page: null } }); this.scheduleHistoryExpiry();
    } catch (error) { if (this.current(epoch) && generation === this.historyGeneration) this.publish({
      history: { phase: 'ERROR', zones: [], zoneId: null, page: null }, notice: networkV2ErrorText(error) }); }
  }
  async openHistoryZone(zoneId: string, nextPage = false): Promise<void> {
    if (!this.ready() || this.state.panel !== 'HISTORY' || !this.state.territory) return;
    const zone = this.state.history.zones.find(z => z.zoneId === zoneId && z.availability === 'PUBLISHED' && z.validUntil && Date.parse(z.validUntil) > Date.now());
    const cursor = nextPage && this.state.history.zoneId === zoneId ? this.state.history.page?.nextCursor : null;
    if (!zone || (nextPage && !cursor)) return;
    ++this.historyGeneration; this.historyAbort?.abort(); const generation = this.historyGeneration, epoch = this.epoch;
    const abort = new AbortController(); this.historyAbort = abort; const zones = this.state.history.zones;
    this.publish({ notice: null, history: { phase: 'LOADING', zones, zoneId, page: null } });
    try {
      const page = await this.repository.loadHistory(this.state.territory.territoryId, zoneId, abort.signal, cursor);
      if (!this.current(epoch) || generation !== this.historyGeneration) return;
      if (!zone.validUntil || Date.parse(zone.validUntil) <= Date.now()) throw new NetworkV2Error('INVALID_DATA');
      this.publish({ history: { phase: 'READY', zones, zoneId, page } }); this.scheduleHistoryExpiry();
    } catch (error) { if (this.current(epoch) && generation === this.historyGeneration) this.publish({
      history: { phase: 'ERROR', zones: [], zoneId: null, page: null }, notice: networkV2ErrorText(error) }); }
  }
  private scheduleHistoryExpiry() {
    if (this.historyTimer !== null) clearTimeout(this.historyTimer);
    const deadline = Math.min(...this.state.history.zones.map(z => z.validUntil ? Date.parse(z.validUntil) : Infinity),
      ...(this.state.history.page?.entries.map(e => Date.parse(e.validUntil)) ?? []));
    if (!Number.isFinite(deadline)) return;
    const generation = this.historyGeneration;
    this.historyTimer = setTimeout(() => { this.historyTimer = null;
      if (generation !== this.historyGeneration) return;
      if (Date.now() >= deadline) { this.clearHistory(); this.publish({ notice: 'Disponibilità dello storico scaduta. Rileggi lo stato autorizzato.' }); }
      else this.scheduleHistoryExpiry();
    }, Math.max(1, Math.min(60000, deadline - Date.now() + 1)));
  }
  /** Ownership is checked by the server, never inferred from a public nickname. Repeat is idempotent. */
  async finishEvent(publicId: string, kind: 'RESOLVED' | 'WITHDRAWN'): Promise<void> {
    if (!this.ready() || this.state.finish?.state === 'SENDING') return;
    if (this.state.draft?.state === 'SUBMITTING' || this.state.draft?.state === 'UNKNOWN') {
      this.publish({ notice: 'Verifica prima l’invio pendente o incerto.' }); return;
    }
    const previous = this.state.finish;
    if (previous && (previous.publicId !== publicId || previous.kind !== kind)) return;
    if (!previous && this.state.detail?.marker.publicId !== publicId && this.state.draft?.receipt?.publicId !== publicId && !this.state.own.rows.some(r => r.publicId === publicId)) return;
    const epoch = this.epoch, abort = new AbortController(); this.finishAbort = abort;
    this.publish({ finish: { publicId, kind, state: 'SENDING' }, notice: null });
    try {
      await this.repository.finish(publicId, kind, abort.signal);
      if (!this.current(epoch)) return;
      this.publish({ finish: null, notice: kind === 'RESOLVED' ? 'Conclusione confermata dal server.' : 'Ritiro confermato dal server.',
        draft: this.state.draft?.receipt?.publicId === publicId ? null : this.state.draft });
      if (this.state.panel === 'OWN') await this.showOwn(); else await this.refresh();
    } catch (error) {
      if (!this.current(epoch)) return;
      const uncertain = !!previous || (error instanceof NetworkV2Error && error.outcome === 'UNKNOWN');
      this.publish({ finish: uncertain ? { publicId, kind, state: 'UNKNOWN' } : null,
        notice: uncertain ? 'Esito chiusura incerto. Riprova esclusivamente la stessa operazione.' : networkV2ErrorText(error) });
    } finally { if (this.finishAbort === abort) this.finishAbort = null; }
  }
  recoverySettled() { this.writeAbort?.abort(); this.finishAbort?.abort(); this.attempt = null; this.attemptUncertain = false;
    this.publish({ draft: null, finish: null }); this.closePanel(); if (this.state.territory) void this.refresh(); }
  private clearOwn() { ++this.ownGeneration;this.ownAbort?.abort();this.ownAbort=null;if(this.ownTimer)clearTimeout(this.ownTimer);this.ownTimer=null;
    this.state=Object.freeze({...this.state,own:{phase:'IDLE' as const,rows:[],hasMore:false}}); }
  async showOwn(nextPage=false) {
    if (!this.ready() || this.lockedContext()) return;
    const before=nextPage?this.state.own.rows.at(-1):undefined;if(nextPage&&!this.state.own.hasMore)return;
    this.clearDetail();this.clearHistory();this.clearOwn();const epoch=this.epoch,generation=this.ownGeneration,abort=new AbortController();this.ownAbort=abort;
    this.publish({panel:'OWN',detail:null,selectedId:null,detailStatus:'IDLE',notice:null,own:{phase:'LOADING',rows:[],hasMore:false}});
    try { const rows=await this.repository.loadOwn(abort.signal,before);
      if(!this.current(epoch)||generation!==this.ownGeneration)return;
      this.publish({own:{phase:'READY',rows,hasMore:rows.length===20}});
      this.ownTimer=setTimeout(()=>{if(this.current(epoch)&&generation===this.ownGeneration){this.clearOwn();this.publish({notice:'Rileggi i metadati dei tuoi invii per verificarne lo stato.'});}},60000);
    } catch(error){if(this.current(epoch)&&generation===this.ownGeneration)this.publish({own:{phase:'ERROR',rows:[],hasMore:false},notice:networkV2ErrorText(error)});}
  }
}
