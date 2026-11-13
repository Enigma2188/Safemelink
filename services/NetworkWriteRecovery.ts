import { NetworkV2Error, type NetworkV2RpcArgs, type NetworkV2RpcReply, type NetworkV2Transport } from '@/backend/repositories/NetworkV2Repository';
import { decodeNetworkSocialReceipt, isNetworkSocialUuid } from './NetworkSocialContractV2';

export interface NetworkJournalStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
type RecordV1 = Readonly<{ version: 1; rpc: 'create_network_event_v2' | 'mutate_network_social_v2' | 'publish_network_author_update_v2' | 'finish_my_network_event_v2' | 'remove_my_network_social_v2';
  operation: string; event: string | null; action: string | null }>;
export type NetworkRecoveryState = Readonly<{ phase: 'OFF' | 'LOADING' | 'READY' | 'WRITING' | 'BLOCKED' | 'VERIFYING' | 'ERROR'; pending: RecordV1 | null; notice: string | null; recoveredEvent: string | null }>;
export const EMPTY_NETWORK_RECOVERY: NetworkRecoveryState = Object.freeze({ phase: 'OFF', pending: null, notice: null, recoveredEvent: null });
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null) && Reflect.ownKeys(x).every(k => {
    const d = Object.getOwnPropertyDescriptor(x,k); return typeof k === 'string' && d?.enumerable && Object.prototype.hasOwnProperty.call(d,'value');
  });
function decode(raw: string): RecordV1 {
  const r: unknown = JSON.parse(raw);
  if (!object(r) || Object.keys(r).sort().join(',') !== 'action,event,operation,rpc,version' || r.version !== 1 || typeof r.operation !== 'string') throw Error('Invalid journal');
  const rpc = r.rpc;
  if (!['create_network_event_v2','mutate_network_social_v2','publish_network_author_update_v2','finish_my_network_event_v2','remove_my_network_social_v2'].includes(String(rpc))) throw Error('Invalid journal');
  if (rpc === 'create_network_event_v2') { if (!isNetworkSocialUuid(r.operation) || r.event !== null || r.action !== null) throw Error('Invalid journal'); }
  else if (rpc === 'finish_my_network_event_v2') { if (!isNetworkSocialUuid(r.event) || !['RESOLVED','WITHDRAWN'].includes(String(r.action)) || r.operation !== `${r.event}:${r.action}`) throw Error('Invalid journal'); }
  else if (rpc === 'remove_my_network_social_v2') { if (!isNetworkSocialUuid(r.event) || (r.action !== null && !isNetworkSocialUuid(r.action)) || r.operation !== `${r.event}:${r.action ?? 'ALL'}`) throw Error('Invalid journal'); }
  else if (!isNetworkSocialUuid(r.operation) || !isNetworkSocialUuid(r.event) || !['VOTE','FOLLOW','COMMENT'].includes(String(r.action)) || (rpc === 'publish_network_author_update_v2' && r.action !== 'COMMENT')) throw Error('Invalid journal');
  return Object.freeze({ version: 1, rpc: rpc as RecordV1['rpc'], operation: r.operation, event: r.event as string | null, action: r.action as string | null });
}
function record<Name extends keyof NetworkV2RpcArgs>(rpc: Name, args: NetworkV2RpcArgs[Name]): RecordV1 | null {
  const a = args as Record<string, unknown>; let result: RecordV1;
  if (rpc === 'create_network_event_v2') result = { version: 1, rpc, operation: String(a.target_operation), event: null, action: null };
  else if (rpc === 'mutate_network_social_v2' || rpc === 'publish_network_author_update_v2') result = { version: 1, rpc, operation: String(a.target_operation), event: String(a.target_event), action: rpc === 'publish_network_author_update_v2' ? 'COMMENT' : String(a.action_kind) };
  else if (rpc === 'finish_my_network_event_v2') result = { version: 1, rpc, operation: `${a.target_public_id}:${a.finish_kind}`, event: String(a.target_public_id), action: String(a.finish_kind) };
  else if (rpc === 'remove_my_network_social_v2') result = { version: 1, rpc, operation: `${a.target_event}:${a.target_comment ?? 'ALL'}`, event: String(a.target_event), action: a.target_comment as string | null };
  else return null;
  return decode(JSON.stringify(result)); // Never persist request bodies, coordinates, tokens or public nickname.
}
function confirmed(r: RecordV1, response: NetworkV2RpcReply) {
  if (response.error !== null || (response.status !== undefined && (response.status < 200 || response.status >= 300))) return false;
  if (r.rpc === 'finish_my_network_event_v2' || r.rpc === 'remove_my_network_social_v2') return response.data === null;
  if (r.rpc === 'create_network_event_v2') { const d = response.data;
    return object(d) && Object.keys(d).sort().join(',') === 'publicId,publicationState,replayed,status' && isNetworkSocialUuid(d.publicId) &&
      ['ACTIVE','RESOLVED'].includes(String(d.status)) && ['PENDING','APPROVED','REJECTED','WITHDRAWN'].includes(String(d.publicationState)) && typeof d.replayed === 'boolean'; }
  try { const d = decodeNetworkSocialReceipt(response.data); return d.operationId === r.operation && d.eventId === r.event && d.action === r.action; } catch { return false; }
}
/** App-owned single-flight durable write barrier. Only technical IDs are persisted. */
export class NetworkWriteRecovery {
  private state = EMPTY_NETWORK_RECOVERY; private listeners = new Set<() => void>(); private owner: string | null = null;
  private epoch = 0; private active = false; private busy = false; private unsubscribe: (() => void) | null = null;
  private request: AbortController | null = null;
  private storagePending = 0;
  constructor(private readonly base: NetworkV2Transport, private readonly storage: NetworkJournalStorage,
    private readonly identity: { getOwner(): string | null; subscribe(fn: () => void): () => void }, private readonly settled: () => void,
    private readonly timeoutMs = 12000) {}
  readonly getState = () => this.state;
  readonly subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<NetworkRecoveryState>) { this.state = Object.freeze({ ...this.state, ...patch }); for (const fn of [...this.listeners]) { try { fn(); } catch { /* No payload logging. */ } } }
  private key(owner: string) { return `@safemelink/network-write/v1/${owner}`; }
  private current(epoch: number, owner: string) { return this.active && epoch === this.epoch && owner === this.owner && owner === this.identity.getOwner(); }
  private async bounded<T>(work: PromiseLike<T>): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve(work), new Promise<never>((_yes,no) => { timer = setTimeout(() => no(new NetworkV2Error('TIMEOUT','UNKNOWN')), this.timeoutMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  private async storageCall<T>(work: Promise<T>): Promise<T> {
    ++this.storagePending;
    const actual = Promise.resolve(work).finally(() => { --this.storagePending; });
    return this.bounded(actual);
  }
  start() { if (this.active) return; this.active = true; this.unsubscribe = this.identity.subscribe(() => { void this.reload(); }); void this.reload(); }
  stop() { this.active = false; ++this.epoch; this.request?.abort(); this.unsubscribe?.(); this.unsubscribe = null; this.owner = null; this.state = EMPTY_NETWORK_RECOVERY; this.publish({}); }
  async reload() {
    const owner = this.identity.getOwner(); if (owner === this.owner && this.state.phase !== 'ERROR' && this.state.phase !== 'OFF') return;
    const previous = owner === this.owner ? this.state.pending : null;
    const epoch = ++this.epoch; this.request?.abort(); this.owner = isNetworkSocialUuid(owner) ? owner : null;
    this.state = EMPTY_NETWORK_RECOVERY;
    if (!this.owner) { this.publish({}); return; }
    if (this.storagePending) { this.publish({ phase: 'ERROR', notice: 'Attendi la conclusione della lettura/scrittura locale prima di riprovare.' }); return; }
    this.publish({ phase: 'LOADING' });
    try { const value = await this.storageCall(this.storage.getItem(this.key(this.owner)));
      if (!this.current(epoch,this.owner)) return;
      const pending = value === null ? previous : decode(value);
      this.publish({ pending, phase: pending ? 'BLOCKED' : 'READY', notice: pending ? 'Operazione precedente da verificare. Nessun nuovo invio automatico.' : null });
    } catch { if (this.owner && this.current(epoch,this.owner)) this.publish({ phase: 'ERROR', notice: 'Registro locale non verificabile. Invii bloccati: riprova la lettura.' }); }
  }
  readonly transport: NetworkV2Transport = async (name,args,signal) => {
    const r = record(name,args); if (!r) return this.base(name,args,signal);
    const owner = this.owner, epoch = this.epoch;
    if (!owner || !this.current(epoch,owner) || this.busy || !['READY','BLOCKED'].includes(this.state.phase) ||
      (this.state.pending && JSON.stringify(this.state.pending) !== JSON.stringify(r))) throw new NetworkV2Error('CONFLICT');
    this.busy = true;
    try {
      await this.storageCall(this.storage.setItem(this.key(owner),JSON.stringify(r)));
      if (!this.current(epoch,owner)) throw new NetworkV2Error('STALE_CONTEXT');
      if (await this.storageCall(this.storage.getItem(this.key(owner))) !== JSON.stringify(r)) throw new NetworkV2Error('INVALID_DATA');
      if (!this.current(epoch,owner) || signal.aborted) throw new NetworkV2Error('STALE_CONTEXT');
      this.publish({ phase: 'WRITING', pending: r, notice: null });
      if (!this.current(epoch,owner) || signal.aborted) throw new NetworkV2Error('STALE_CONTEXT');
      const response = await this.bounded(this.base(name,args,signal));
      if (!this.current(epoch,owner)) throw new NetworkV2Error('STALE_CONTEXT','UNKNOWN');
      if (confirmed(r,response)) { await this.clear(owner,epoch,r); return response; }
      this.publish({ phase: 'BLOCKED', pending: r, notice: 'Esito da verificare prima di altre operazioni.' }); return response;
    } catch (error) { if (this.current(epoch,owner)) this.publish({ phase: 'ERROR', pending: r, notice: 'Esito incerto o registro non verificabile. Rileggi il registro prima di nuove operazioni.' }); throw error; }
    finally { this.busy = false; }
  };
  private async clear(owner: string, epoch: number, r: RecordV1) {
    if (!this.current(epoch,owner)) throw new NetworkV2Error('STALE_CONTEXT','UNKNOWN');
    const raw = await this.storageCall(this.storage.getItem(this.key(owner)));
    if (!this.current(epoch,owner) || raw !== JSON.stringify(r)) throw new NetworkV2Error('INVALID_DATA','UNKNOWN');
    await this.storageCall(this.storage.removeItem(this.key(owner)));
    if (!this.current(epoch,owner)) throw new NetworkV2Error('STALE_CONTEXT','UNKNOWN');
    if (await this.storageCall(this.storage.getItem(this.key(owner))) !== null) throw new NetworkV2Error('INVALID_DATA','UNKNOWN');
    if (!this.current(epoch,owner)) throw new NetworkV2Error('STALE_CONTEXT','UNKNOWN');
    this.publish({ phase: 'READY', pending: null });
  }
  async resolve(preventLate = false) {
    const r = this.state.pending, owner = this.owner, epoch = this.epoch;
    if (!r || !owner || this.busy || this.storagePending || this.state.phase === 'ERROR' || !this.current(epoch,owner)) return;
    this.busy = true; const abort = new AbortController(); this.request = abort; this.publish({ phase: 'VERIFYING' });
    try {
      if (!this.current(epoch,owner)) throw new NetworkV2Error('STALE_CONTEXT');
      let state: string, identifier: string | null = null;
      if (r.rpc === 'finish_my_network_event_v2' || r.rpc === 'remove_my_network_social_v2') {
        const response = await this.bounded(r.rpc === 'finish_my_network_event_v2'
          ? this.base(r.rpc,{ target_public_id: r.event!, finish_kind: r.action as 'RESOLVED' | 'WITHDRAWN' },abort.signal)
          : this.base(r.rpc,{ target_event: r.event!, target_comment: r.action },abort.signal));
        if (!confirmed(r,response)) throw new NetworkV2Error('SERVER','UNKNOWN'); state = 'FOUND';
      } else {
        const response = await this.bounded(this.base('resolve_my_network_operation_v2',{ target_kind: r.rpc === 'create_network_event_v2' ? 'EVENT' : 'SOCIAL', target_operation: r.operation, prevent_late: preventLate },abort.signal));
        const d = response.data;
        if (response.error !== null || (response.status !== undefined && (response.status < 200 || response.status >= 300)) || !object(d) || Object.keys(d).sort().join(',') !== 'publicId,state' || !['FOUND','FENCED','UNKNOWN'].includes(String(d.state)) ||
          (d.state === 'FOUND' ? !isNetworkSocialUuid(d.publicId) : d.publicId !== null)) throw new NetworkV2Error('INVALID_DATA','UNKNOWN');
        state = String(d.state); identifier = d.publicId as string | null;
      }
      if (!this.current(epoch,owner)) return;
      if (state === 'UNKNOWN') { this.publish({ phase: 'BLOCKED', notice: 'Nessuna ricevuta trovata: non prova un fallimento. Il tentativo resta incerto.' }); return; }
      // In-memory controllers discard their obsolete attempt BEFORE new writes unlock.
      if (await this.storageCall(this.storage.getItem(this.key(owner))) === null) {
        if (!this.current(epoch,owner)) return;
        await this.storageCall(this.storage.setItem(this.key(owner),JSON.stringify(r)));
      }
      if (!this.current(epoch,owner)) return;
      this.settled(); await this.clear(owner,epoch,r);
      this.publish({ notice: state === 'FOUND' ? 'Operazione confermata dal server. Aggiorna i dati autorizzati.' : 'Il vecchio tentativo non potrà essere pubblicato in ritardo. Puoi iniziare un nuovo invio.',
        recoveredEvent: state === 'FOUND' && r.rpc === 'create_network_event_v2' ? identifier : null });
    } catch { if (this.current(epoch,owner)) this.publish({ phase: 'BLOCKED', notice: 'Verifica non conclusa. Nessun esito presunto e nessun reinvio automatico.' }); }
    finally { if (this.request === abort) this.request = null; this.busy = false; }
  }
  async withdrawRecovered() {
    const id = this.state.recoveredEvent, owner = this.owner, epoch = this.epoch;
    if (!id || !owner || this.state.phase !== 'READY') return;
    try { const r = await this.transport('finish_my_network_event_v2',{ target_public_id: id, finish_kind: 'WITHDRAWN' },new AbortController().signal);
      if (this.current(epoch,owner) && r.error === null && r.data === null) this.publish({ recoveredEvent: null, notice: 'Ritiro confermato dal server.' });
    } catch { /* The journal already exposes the unresolved operation; no success is assumed. */ }
  }
  acknowledge() { if (this.state.phase === 'READY') this.publish({ notice: null, recoveredEvent: null }); }
}
