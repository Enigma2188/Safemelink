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
  attemptId: string | null;
  remoteActiveId?: string;
  attempt?: VoiceSOSAttempt;
};
export const VoiceSOSRecovery = {
  async inspect(userId: string, events: SOSEvent[]): Promise<VoiceSOSRecoveryResult> {
    const runtime = VoiceProtectionRuntime.getSOSAttempt(userId);
    let stored;
    try { stored = await VoiceSOSRecoveryStorage.get(userId); }
    catch { return { kind: 'uncertain', attemptId: runtime?.attemptId ?? null }; }
    const attempt = runtime ?? stored;
    const result = (kind: VoiceSOSRecoveryResult['kind']) => ({kind, attemptId: attempt?.attemptId ?? null, ...(attempt?{attempt}: {})});
    const activeLocal = events.filter(event => (event.isActive === true || ['open','accepted'].includes(event.remoteStatus ?? '')) &&
      !['closed','cancelled'].includes(event.remoteStatus ?? ''));
    const unresolved = attempt?.phase === 'pending' || attempt?.phase === 'unknown';
    if ((await AuthService.getSession().catch(() => null))?.user.id !== userId) return result('uncertain');
    try {
      const active = await SOSRepository.findOwnActiveForVoiceRecovery(userId);
      if ((await AuthService.getSession().catch(() => null))?.user.id !== userId) return result('uncertain');
      if (active.length) return {...result('active'),remoteActiveId:active[0].id};
      // Recover the binding from the SAME local event, never from an unrelated SOS.
      const correlatedEvent = attempt?.eventId ? events.find(event => event.id === attempt.eventId) : undefined;
      if (attempt?.remoteId && correlatedEvent?.remoteSosId && attempt.remoteId !== correlatedEvent.remoteSosId) return result('uncertain');
      const attemptRemoteId = attempt?.remoteId ?? correlatedEvent?.remoteSosId;
      // A SELECT cannot fence an in-flight legacy INSERT. Only a known, correlated
      // remote ID can provide terminal proof for an uncertain creation.
      if (unresolved && !attemptRemoteId) return result('uncertain');
      const ids = new Set([...activeLocal.map(event => event.remoteSosId), attemptRemoteId].filter((id): id is string => Boolean(id)));
      if (activeLocal.some(event => !event.remoteSosId)) return result('uncertain');
      if (attempt && !attemptRemoteId) {
        // Confirmed local-only completion may be released after its own local close.
        // Missing history is NOT evidence of a close, nor of server absence.
        if (attempt.phase !== 'active' || !correlatedEvent || correlatedEvent.isActive !== false ||
          !['closed','cancelled'].includes(correlatedEvent.remoteStatus ?? '')) return result('uncertain');
      }
      for (const id of ids) {
        const state = await SOSLifecycleRepository.getStatus(id);
        if (state.sos_id !== id || !state.is_owner) return result('uncertain');
        if (state.sos_status === 'open' || state.sos_status === 'accepted') return result('active');
        if (!['closed','cancelled'].includes(state.sos_status)) return result('uncertain');
      }
      if ((await AuthService.getSession().catch(() => null))?.user.id !== userId) return result('uncertain');
      return result('clear');
    } catch (error) {
      // Fresh, clue-free offline use is allowed; this is not proof of server absence.
      const offline = error instanceof TypeError || (error instanceof BackendError && error.category === 'network');
      const ownerMatches = (await AuthService.getSession().catch(() => null))?.user.id === userId;
      return result(attempt || activeLocal.length || !offline || !ownerMatches ? 'uncertain' : 'clear');
    }
  },
};
