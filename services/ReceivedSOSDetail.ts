import { BackendError, classifyBackendError } from '@/backend/errors/BackendError';
import { ReceivedSOSRepository } from '@/backend/repositories/ReceivedSOSRepository';
import { SOSLifecycleService, type SOSLifecycleState } from '@/services/SOSLifecycleService';

export type ReceivedSOSDetail = Awaited<ReturnType<typeof ReceivedSOSRepository.getById>>;
export type ReceivedPosition = { latitude: number; longitude: number; accuracy: number | null; observedAt: string | null };
export type PositionSelection = { position: ReceivedPosition | null; lastKnown: boolean; issue: 'future' | 'invalid' | 'older' | 'unchanged' | 'missing' | null };
export function selectReceivedPosition(previous: ReceivedPosition | null, row: ReceivedSOSDetail, now: number): PositionSelection {
  const time = row.location_updated_at ? Date.parse(row.location_updated_at) : null;
  const fallback = (issue: PositionSelection['issue']) => ({ position: previous, lastKnown: !!previous, issue });
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude) || row.latitude === null || row.longitude === null ||
    Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) return fallback('missing');
  if (time !== null && !Number.isFinite(time)) return fallback('invalid');
  if (time !== null && time > now) return fallback('future');
  const previousTime = previous?.observedAt ? Date.parse(previous.observedAt) : null;
  if (previousTime !== null && (time === null || time <= previousTime)) return fallback(time === previousTime ? 'unchanged' : 'older');
  return { position: { latitude: row.latitude, longitude: row.longitude,
    accuracy: row.accuracy !== null && Number.isFinite(row.accuracy) && row.accuracy >= 0 ? row.accuracy : null,
    observedAt: row.location_updated_at }, lastKnown: false, issue: null };
}

export function describePositionAge(observedAt: string | null, now: number) {
  if (!observedAt) return 'Ora di rilevazione non disponibile: freschezza non verificabile.';
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return 'Timestamp non valido: freschezza non verificabile.';
  if (time > now) return 'Timestamp futuro anomalo: non considerare questa posizione recente.';
  const seconds = Math.floor((now - time) / 1000);
  if (seconds < 60) return `Rilevata ${seconds} secondi fa`;
  const minutes = Math.floor(seconds / 60);
  return minutes >= 2 ? `Posizione obsoleta: rilevata ${minutes} minuti fa` : `Rilevata ${minutes} minuto fa`;
}

type Context = { userId: string; sosId: string };
export type ReceivedDetailState = {
  context: Context | null;
  kind: 'paused' | 'loading' | 'active' | 'terminal' | 'denied' | 'error';
  sos: ReceivedSOSDetail | null;
  lifecycle: SOSLifecycleState | null;
  selection: PositionSelection;
  refreshedAt: number | null;
  accepting: boolean;
};
const empty = (context: Context | null, kind: ReceivedDetailState['kind']): ReceivedDetailState => ({ context, kind,
  sos: null, lifecycle: null, selection: { position: null, lastKnown: false, issue: null }, refreshedAt: null, accepting: false });
const active = (status: string) => status === 'open' || status === 'accepted';
const denied = (error: unknown) => {
  const category = error && typeof error === 'object' && 'category' in error ? error.category : null;
  const cause = error instanceof BackendError ? error.cause : error;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  const httpStatus = cause && typeof cause === 'object' && 'status' in cause ? cause.status : null;
  return category === 'auth' || category === 'not_authorized_or_missing' ||
    category === 'unauthenticated' || category === 'forbidden' || httpStatus === 401 || httpStatus === 403 ||
    code === 'PGRST116' || ['unauthenticated', 'forbidden'].includes(classifyBackendError(cause));
};

// Android recipient only. No global polling, GPS acquisition or persistence.
export class ReceivedSOSDetailController {
  private context: Context | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private pendingRefresh = false;
  private halted = false;
  private position: ReceivedPosition | null = null;
  private state: ReceivedDetailState = empty(null, 'paused');
  constructor(private readonly publish: (state: ReceivedDetailState) => void,
    private readonly dependencies = {
      status: SOSLifecycleService.getStatus,
      detail: ReceivedSOSRepository.getById,
      accept: SOSLifecycleService.accept,
      now: () => Date.now(),
    }) {}
  private emit(state: ReceivedDetailState) { this.state = state; this.publish(state); }
  private cancelTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  configure(context: Context | null) {
    this.generation++; this.cancelTimer(); this.context = context; this.position = null; this.halted = false;
    this.pendingRefresh = !!context;
    this.emit(empty(context, context ? 'loading' : 'paused'));
    if (context) void this.refresh();
  }
  private current(generation: number, context: Context) {
    return generation === this.generation && this.context?.userId === context.userId && this.context.sosId === context.sosId;
  }
  private async read(generation: number, context: Context) {
    let lifecycle: SOSLifecycleState;
    try { lifecycle = await this.dependencies.status(context.sosId); }
    catch (error) {
      if (!this.current(generation, context)) return;
      const category = error && typeof error === 'object' && 'category' in error ? error.category : null;
      // The existing status adapter loses the code when maybeSingle is empty.
      // Only a second, server-authorized single-row read may prove unavailable;
      // never infer denial/closure from a generic status or transport error.
      if (!denied(error) && (category === 'unknown' || category === 'unexpected_response')) {
        await this.dependencies.detail(context.sosId);
        if (!this.current(generation, context)) return;
      }
      throw error;
    }
    if (!this.current(generation, context)) return;
    if (lifecycle.sos_id !== context.sosId) throw new Error('Unexpected SOS identity');
    if (!active(lifecycle.sos_status)) {
      if (!['closed', 'cancelled'].includes(lifecycle.sos_status)) throw new Error('Unexpected SOS status');
      this.position = null; this.halted = true;
      this.emit({ ...empty(context, 'terminal'), lifecycle }); return;
    }
    const sos = await this.dependencies.detail(context.sosId);
    if (!this.current(generation, context)) return;
    if (!sos || sos.sos_id !== context.sosId) throw new Error('Unexpected SOS identity');
    if (!active(sos.sos_status)) {
      if (!['closed', 'cancelled'].includes(sos.sos_status)) throw new Error('Unexpected SOS status');
      this.position = null; this.halted = true;
      this.emit({ ...empty(context, 'terminal'), lifecycle: { ...lifecycle, sos_status: sos.sos_status } }); return;
    }
    const refreshedAt = this.dependencies.now();
    const selection = selectReceivedPosition(this.position, sos, refreshedAt);
    this.position = selection.position;
    this.emit({ context, kind: 'active', sos, lifecycle: { ...lifecycle, sos_status: sos.sos_status },
      selection, refreshedAt, accepting: false });
  }
  private finish() {
    this.inFlight = false;
    if (this.pendingRefresh && this.context && !this.halted) { void this.refresh(); return; }
    if (this.context && !this.halted) this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 15_000);
  }
  async refresh() {
    if (!this.context || this.halted) return;
    if (this.inFlight) { this.pendingRefresh = true; return; }
    this.pendingRefresh = false; this.cancelTimer(); this.inFlight = true;
    const context = this.context, generation = this.generation;
    this.emit(empty(context, 'loading'));
    try { await this.read(generation, context); }
    catch (error) {
      if (this.current(generation, context)) {
        this.position = null; this.halted = denied(error);
        this.emit(empty(context, this.halted ? 'denied' : 'error'));
      }
    } finally { this.finish(); }
  }
  async accept() {
    if (!this.context || this.halted || this.inFlight || this.state.kind !== 'active' || this.state.lifecycle?.sos_status !== 'open') return;
    this.cancelTimer(); this.inFlight = true;
    const context = this.context, generation = this.generation;
    this.emit({ ...empty(context, 'loading'), accepting: true });
    try {
      const result = await this.dependencies.accept(context.sosId);
      if (!this.current(generation, context)) return;
      if (result.sos_id !== context.sosId) throw new Error('Unexpected SOS identity');
      await this.read(generation, context);
    } catch (error) {
      if (this.current(generation, context)) {
        this.position = null; this.halted = denied(error);
        this.emit(empty(context, this.halted ? 'denied' : 'error'));
      }
    } finally { this.finish(); }
  }
}
