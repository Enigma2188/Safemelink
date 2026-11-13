import { NetworkSocialV2Repository } from '@/backend/repositories/NetworkSocialV2Repository';
import { NetworkV2Error, type NetworkV2Transport } from '@/backend/repositories/NetworkV2Repository';
import { isNetworkSocialUuid, type NetworkSocialAction, type NetworkSocialActivity, type NetworkSocialCursor,
  type NetworkSocialSnapshot } from '@/services/NetworkSocialContractV2';
import type { NetworkOperationalDetailV2 } from '@/services/NetworkMapContractV2';
import type { NetworkV2AccessContext } from './NetworkV2ScreenController';

type Attempt = Readonly<{ eventId: string; operationId: string; action: NetworkSocialAction; value: string; authorUpdate: boolean }>;
export type NetworkSocialState = Readonly<{ eventId: string | null; phase: 'IDLE' | 'LOADING' | 'READY' | 'ERROR';
  snapshot: NetworkSocialSnapshot | null; activity: readonly NetworkSocialActivity[]; write: 'IDLE' | 'SENDING' | 'UNKNOWN';
  notice: string | null; hasOlder: boolean; canRetryHere: boolean }>;
const empty = (): NetworkSocialState => Object.freeze({ eventId: null, phase: 'IDLE', snapshot: null, activity: [], write: 'IDLE', notice: null, hasOlder: false, canRetryHere: false });
export function networkSocialError(error: unknown): string {
  if (error instanceof NetworkV2Error) {
    if (error.reason === 'ACCESS_DENIED' || error.reason === 'STALE_CONTEXT') return 'Social non autorizzato o disabilitato. Nessun contenuto precedente viene mantenuto.';
    if (error.reason === 'BACKEND_UNAVAILABLE') return 'Funzioni social non ancora disponibili su questo server.';
    if (error.reason === 'RATE_LIMIT') return 'Limite richieste raggiunto. Attendi prima di riprovare.';
    if (error.reason === 'CONFLICT' || error.reason === 'INVALID_REQUEST') return 'Richiesta non accettata o duplicata. Nessun nuovo invio automatico.';
  }
  return 'Connessione o risposta non disponibile. Nessun esito viene presunto.';
}
/** One app-owned instance; no constructor requests, storage, demo data, polling or telemetry. */
export class NetworkSocialController {
  private readonly repository: NetworkSocialV2Repository;
  private state = empty(); private listeners = new Set<() => void>();
  private detail: NetworkOperationalDetailV2 | null = null; private key: string | null = null;
  private generation = 0; private active = false; private disposed = false; private visible = true; private unsubscribe: (() => void) | null = null;
  private read: AbortController | null = null; private write: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt: Attempt | null = null; private uncertain = false;
  constructor(transport: NetworkV2Transport, private readonly access: NetworkV2AccessContext,
    private readonly createOperationId: () => string) {
    this.repository = new NetworkSocialV2Repository(transport, () => this.readKey());
  }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private readKey() { try { return this.access.getKey() || null; } catch { return null; } }
  private publish(patch: Partial<NetworkSocialState>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* No content logs. */ } }
  }
  private cancelRead() { ++this.generation; this.read?.abort(); this.read = null; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private current(generation: number) { return this.active && this.key !== null && this.key === this.readKey() && generation === this.generation; }
  private authChanged = () => {
    const key = this.readKey(); if (key === this.key) return;
    this.key = key; this.cancelRead(); this.write?.abort(); this.repository.invalidate();
    this.attempt = null; this.uncertain = false; this.detail = null; this.state = empty(); this.publish({});
  };
  start() { if (this.active || this.disposed) return; this.active = true; this.unsubscribe = this.access.subscribe(this.authChanged); this.authChanged(); }
  stop() { this.active = false; this.unsubscribe?.(); this.unsubscribe = null; this.cancelRead(); this.write?.abort();
    this.repository.invalidate(); this.attempt = null; this.uncertain = false; this.detail = null; this.key = null; this.state = empty(); this.publish({}); }
  dispose() { this.disposed = true; this.stop(); this.repository.dispose(); this.listeners.clear(); }
  select(detail: NetworkOperationalDetailV2 | null) {
    if (!this.active) return; if (this.readKey() !== this.key) this.authChanged();
    this.visible = true;
    this.cancelRead(); this.detail = detail;
    this.publish({ eventId: detail?.marker.publicId ?? null, phase: 'IDLE', snapshot: null, activity: [], hasOlder: false,
      canRetryHere: !!this.attempt && this.attempt.eventId === detail?.marker.publicId,
      notice: this.uncertain ? 'Esito incerto conservato. Verifica il tentativo prima di altre azioni.' : null });
    if (detail && this.key) void this.refresh();
  }
  suspend() { this.visible = false; this.cancelRead(); this.publish({ phase: 'IDLE', snapshot: null, activity: [], hasOlder: false }); }
  resume() { this.visible = true; void this.refresh(); }
  async refresh(before?: NetworkSocialCursor) {
    if (!this.visible) return;
    if (!this.active || !this.detail || !this.key || this.readKey() !== this.key) { this.authChanged(); return; }
    if (Date.parse(this.detail.marker.validUntil) <= Date.now()) { this.suspend(); return; }
    this.cancelRead(); const generation = this.generation, detail = this.detail;
    const abort = new AbortController(); this.read = abort;
    this.publish({ phase: 'LOADING', snapshot: null, activity: [], hasOlder: false });
    try {
      const [snapshot, activity] = await Promise.all([
        this.repository.snapshot(detail.marker.publicId, abort.signal, before),
        this.repository.activity(detail.marker.territoryId, true, abort.signal),
      ]);
      if (!this.current(generation)) return;
      if (Date.parse(snapshot.validUntil) > Date.parse(detail.marker.validUntil)) throw new NetworkV2Error('INVALID_DATA');
      const deadline = Math.min(Date.parse(snapshot.validUntil), ...activity.map(a => Date.parse(a.validUntil)));
      if (deadline <= Date.now()) { this.suspend(); return; }
      this.publish({ phase: 'READY', snapshot, activity, hasOlder: snapshot.comments.length === 50 });
      const expire = () => {
        if (!this.current(generation)) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) this.suspend(); else this.timer = setTimeout(expire, Math.min(remaining, 2147483647));
      }; expire();
    } catch (error) { if (this.current(generation)) this.publish({ phase: 'ERROR', snapshot: null, activity: [], notice: networkSocialError(error) }); }
  }
  async act(action: NetworkSocialAction, value: string, authorUpdate = false) {
    if (!this.active || this.write || this.uncertain || !this.detail || !this.state.snapshot || this.state.phase !== 'READY' ||
      (this.detail.marker.status !== 'ACTIVE' && !(action === 'FOLLOW' && value === 'OFF') && !(action === 'VOTE' && value === 'NONE')) ||
      this.readKey() !== this.key || Date.parse(this.state.snapshot.validUntil) <= Date.now()) return;
    let operationId: string;
    try { operationId = this.createOperationId(); } catch { this.publish({ notice: 'Generatore sicuro di identificativi non disponibile.' }); return; }
    if (!isNetworkSocialUuid(operationId)) { this.publish({ notice: 'Generatore sicuro di identificativi non disponibile.' }); return; }
    if (authorUpdate && (action !== 'COMMENT' || value.trim().length < 2 || value.trim().length > 300)) return;
    this.attempt = Object.freeze({ eventId: this.detail.marker.publicId, operationId, action, value, authorUpdate }); await this.send();
  }
  private async send() {
    const attempt = this.attempt; if (!attempt || this.write || !this.active || this.readKey() !== this.key) return;
    const account = this.key; const abort = new AbortController(); this.write = abort;
    this.publish({ write: 'SENDING', notice: 'Richiesta in corso: nessun esito ancora confermato.' });
    try {
      await this.repository.mutate(attempt.eventId, attempt.operationId, attempt.action, attempt.value, abort.signal, attempt.authorUpdate);
      if (!this.active || account !== this.key || this.readKey() !== account) return;
      this.uncertain = false; this.attempt = null;
      this.publish({ write: 'IDLE', canRetryHere: false, notice: attempt.action === 'COMMENT'
        ? 'Commento ricevuto dal server. La pubblicazione richiede moderazione.' : 'Richiesta confermata dal server. Stato riletto, nessun aggiornamento ottimistico.' });
      await this.refresh();
    } catch (error) {
      if (!this.active || account !== this.key || this.readKey() !== account) return;
      this.uncertain = this.uncertain || (error instanceof NetworkV2Error && error.outcome === 'UNKNOWN');
      if (!this.uncertain) this.attempt = null;
      this.publish({ write: this.uncertain ? 'UNKNOWN' : 'IDLE', snapshot: null, phase: 'ERROR', activity: [],
        canRetryHere: !!this.attempt && this.attempt.eventId === this.detail?.marker.publicId,
        notice: this.uncertain ? 'Esito incerto: non ripetere con un nuovo tentativo. Puoi verificare o riprovare la stessa richiesta.' : networkSocialError(error) });
    } finally { if (this.write === abort) this.write = null; }
  }
  async retry() { if (this.uncertain && this.attempt?.eventId === this.detail?.marker.publicId) await this.send(); }
  recoverySettled() { this.write?.abort(); this.write = null; this.attempt = null; this.uncertain = false;
    this.publish({ write: 'IDLE', canRetryHere: false }); this.select(null); }
  async verify() {
    const attempt = this.attempt; if (!this.uncertain || !attempt || this.write || !this.active || !this.key || this.readKey() !== this.key) return;
    const account = this.key, abort = new AbortController(); this.write = abort;
    try {
      const receipt = await this.repository.receipt(attempt.operationId, abort.signal);
      if (!this.active || this.key !== account || this.readKey() !== account) return;
      if (!receipt) { this.publish({ notice: 'Ricevuta non trovata: non prova il fallimento. Esito ancora incerto.' }); return; }
      if (receipt.eventId !== attempt.eventId || receipt.action !== attempt.action) throw new NetworkV2Error('INVALID_DATA');
      this.uncertain = false; this.attempt = null;
      this.publish({ write: 'IDLE', canRetryHere: false, notice: 'Richiesta ricevuta dal server; la visibilità viene verificata separatamente.' });
      await this.refresh();
    } catch (error) { if (this.active && this.key === account && this.readKey() === account) this.publish({ notice: networkSocialError(error) }); }
    finally { if (this.write === abort) this.write = null; }
  }
  async withdrawComment(commentId: string) {
    if (!this.active || this.write || this.uncertain || !this.detail || this.readKey() !== this.key ||
      !this.state.snapshot?.comments.some(c => c.publicId === commentId && c.canWithdraw)) return;
    const account = this.key, eventId = this.detail.marker.publicId, abort = new AbortController(); this.write = abort;
    this.publish({ write: 'SENDING', notice: 'Ritiro richiesto, in attesa del server.' });
    try {
      await this.repository.removeMine(eventId, commentId, abort.signal);
      if (this.active && account === this.key && this.readKey() === account) { this.publish({ write: 'IDLE', notice: 'Ritiro confermato dal server.' }); await this.refresh(); }
    } catch (error) {
      if (this.active && account === this.key && this.readKey() === account) {
        // Terminal cleanup is repeatable; no creation or automatic retry is attempted.
        this.publish({ write: 'IDLE', snapshot: null, activity: [], phase: 'ERROR', notice: error instanceof NetworkV2Error && error.outcome === 'UNKNOWN'
          ? 'Ritiro con esito incerto. Aggiorna lo stato; non è stato dichiarato completato.' : networkSocialError(error) });
      }
    } finally { if (this.write === abort) this.write = null; }
  }
}
