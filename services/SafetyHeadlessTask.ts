import { AppRegistry } from 'react-native';
import { SafeMeLinkSafety } from '@/modules/safemelink-safety';
import { getSOSSessionWithTimeout } from '@/services/SOSSessionTimeout';
import { SafetyExpirationRuntime } from '@/services/SafetyExpirationRuntime';
import { reportSafetyError } from '@/services/SafetyOperation';

export async function runSafetyEscalation(data: { userId: string; sessionId: string; generation: string }) {
  try {
    if (!SafeMeLinkSafety?.isCurrentDeadline(data.userId, data.sessionId, data.generation)) return;
    const session = await getSOSSessionWithTimeout();
    if (!session) {
      // Missing Auth is not evidence of a different account. Preserve bounded recovery.
      reportSafetyError('native_escalation_auth_unavailable');
      return;
    }
    if (session.user.id !== data.userId) {
      SafeMeLinkSafety.finishDeadlines(data.userId, data.sessionId, data.generation);
      reportSafetyError('native_escalation_account_mismatch');
      return;
    }
    // Authentication awaited above may overlap cancellation/account changes.
    if (!SafeMeLinkSafety.isCurrentDeadline(data.userId, data.sessionId, data.generation)) return;
    console.info('[SafetyExpiration] HEADLESS_EXECUTION_READY', { nowMs: Date.now() });
    await SafetyExpirationRuntime.processDue(data.userId);
    // processDue starts the existing SOS asynchronously. Keep the headless
    // service/wake lock alive until that SAME execution, not a second SOS, finishes.
    await SafetyExpirationRuntime.waitForExecution(data.userId);
  } catch {
    reportSafetyError('native_escalation');
  }
}

AppRegistry.registerHeadlessTask('SafeMeLinkSafetyEscalation', () => runSafetyEscalation);
