import { SOSClosureRecovery } from '@/services/SOSClosureRecovery';
import { AuthService } from '@/backend/auth/AuthService';
import { BackendError } from '@/backend/errors/BackendError';
import { SOSLifecycleRepository } from '@/backend/repositories/SOSLifecycleRepository';
import { SOSRepository } from '@/backend/repositories/SOSRepository';
import type { SOSEvent } from '@/services/SOSService';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceSOSRecoveryStorage } from '@/storage/VoiceSOSRecoveryStorage';
import type { VoiceSOSAttempt } from '@/storage/VoiceSOSRecoveryStorage';

export type VoiceSOSRecoveryResult = {
  kind: 'clear' | 'active' | 'uncertain';
  reason?: 'verified_clear' | 'offline_without_local_evidence' | 'remote_active' | 'journal_unreadable' | 'account_changed' | 'binding_conflict' | 'unbound_attempt' | 'unbound_local_event' | 'local_close_missing' | 'remote_proof_invalid' | 'remote_check_failed' | 'closure_unbound' | 'closure_journal_unreadable';
  attemptId: string | null;
  remoteActiveId?: string;
  attempt?: VoiceSOSAttempt;
  pendingClosures?: number;
  closureCheckFailed?: boolean;
  localActiveCount?: number;
};
export const VoiceSOSRecovery = {
  async inspect(userId: string, events: SOSEvent[]): Promise<VoiceSOSRecoveryResult> {
    let stored;
    try { stored = await VoiceSOSRecoveryStorage.get(userId); }
    catch { return { kind: 'uncertain', reason: 'journal_unreadable', attemptId: VoiceProtectionRuntime.getSOSAttempt(userId)?.attemptId ?? null }; }
    const runtime = VoiceProtectionRuntime.getSOSAttempt(userId);
    const attempt = runtime ?? stored;
    let pendingClosures: number | undefined;
    const result = (kind: VoiceSOSRecoveryResult['kind'], reason: VoiceSOSRecoveryResult['reason']) => ({kind, reason, pendingClosures, attemptId: attempt?.attemptId ?? null, ...(attempt?{attempt}: {})});
    if (runtime && stored && (runtime.attemptId !== stored.attemptId ||
      (runtime.remoteId && stored.remoteId && runtime.remoteId !== stored.remoteId) ||
      (runtime.eventId && stored.eventId && runtime.eventId !== stored.eventId))) return result('uncertain', 'binding_conflict');
    const activeLocal = events.filter(event => (event.isActive === true || ['open','accepted'].includes(event.remoteStatus ?? '')) &&
      !['closed','cancelled'].includes(event.remoteStatus ?? ''));
    const unresolved = attempt?.phase === 'pending' || attempt?.phase === 'unknown';
    if ((await AuthService.getSession().catch(() => null))?.user.id !== userId) return result('uncertain', 'account_changed');
    let closures;
    try { closures = await SOSClosureRecovery.inspectState(userId); pendingClosures = closures.pending; }
    catch { return { ...result('uncertain', 'closure_journal_unreadable'), closureCheckFailed: true }; }
    try {
      const active = await SOSRepository.findOwnActiveForVoiceRecovery(userId);
      if ((await AuthService.getSession().catch(() => null))?.user.id !== userId) return result('uncertain', 'account_changed');
      if (active.length) return {...result('active', 'remote_active'),remoteActiveId:active[0].id};
      if (closures.unbound) return result('uncertain', 'closure_unbound');
      // Recover the binding from the SAME local event, never from an unrelated SOS.
      const correlatedEvent = attempt?.eventId ? events.find(event => event.id === attempt.eventId) : undefined;
      if (attempt?.remoteId && correlatedEvent?.remoteSosId && attempt.remoteId !== correlatedEvent.remoteSosId) return result('uncertain', 'binding_conflict');
      const attemptRemoteId = attempt?.remoteId ?? correlatedEvent?.remoteSosId;
      // A SELECT cannot fence an in-flight legacy INSERT. Only a known, correlated
      // remote ID can provide terminal proof for an uncertain creation.
      if (unresolved && !attemptRemoteId) return result('uncertain', 'unbound_attempt');
      const ids = new Set([...(closures.remoteIds ?? []), ...activeLocal.map(event => event.remoteSosId), attemptRemoteId].filter((id): id is string => Boolean(id)));
      if (activeLocal.some(event => !event.remoteSosId)) return result('uncertain', 'unbound_local_event');
      if (attempt && !attemptRemoteId) {
        // Confirmed local-only completion may be released after its own local close.
        // Missing history is NOT evidence of a close, nor of server absence.
        if (attempt.phase !== 'active' || !correlatedEvent || correlatedEvent.isActive !== false ||
          !['closed','cancelled'].includes(correlatedEvent.remoteStatus ?? '')) return result('uncertain', 'local_close_missing');
      }
      for (const id of ids) {
        const state = await SOSLifecycleRepository.getStatus(id);
        if (state.sos_id !== id || state.is_owner !== true) return result('uncertain', 'remote_proof_invalid');
        if (state.sos_status === 'open' || state.sos_status === 'accepted') return {...result('active', 'remote_active'), remoteActiveId: id};
        if (!['closed','cancelled'].includes(state.sos_status)) return result('uncertain', 'remote_proof_invalid');
      }
      if ((await AuthService.getSession().catch(() => null))?.user.id !== userId) return result('uncertain', 'account_changed');
      return result('clear', 'verified_clear');
    } catch (error) {
      // Fresh, clue-free offline use is allowed; this is not proof of server absence.
      const offline = error instanceof TypeError || (error instanceof BackendError && error.category === 'network');
      const ownerMatches = (await AuthService.getSession().catch(() => null))?.user.id === userId;
      return attempt || activeLocal.length || closures.pending || !offline || !ownerMatches
        ? result('uncertain', ownerMatches ? 'remote_check_failed' : 'account_changed')
        : result('clear', 'offline_without_local_evidence');
    }
  },
};
