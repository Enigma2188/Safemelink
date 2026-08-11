import type { SosStatus } from '@/backend/database.types';
import {
  BackendError,
  classifyBackendError,
} from '@/backend/errors/BackendError';
import { SOSLifecycleRepository } from '@/backend/repositories/SOSLifecycleRepository';

export type SOSLifecycleState = Awaited<
  ReturnType<typeof SOSLifecycleRepository.getStatus>
>;
export type SOSTransition = 'accept' | 'cancel' | 'close';
export type SOSLifecycleErrorCategory =
  | 'auth'
  | 'invalid_sos_id'
  | 'not_authorized_or_missing'
  | 'invalid_transition'
  | 'timeout'
  | 'rpc_unavailable'
  | 'unexpected_response'
  | 'unexpected_status'
  | 'network'
  | 'unknown';

const SOS_LIFECYCLE_ERROR_MESSAGES: Record<SOSLifecycleErrorCategory, string> = {
  auth: 'Sessione non disponibile. Accedi di nuovo e riprova.',
  invalid_sos_id: 'Il riferimento remoto dell’SOS non è valido.',
  not_authorized_or_missing:
    'SOS remoto non trovato oppure non associato all’account attivo.',
  invalid_transition: 'Lo stato remoto dell’SOS non consente questa operazione.',
  timeout: 'Il server non ha risposto in tempo. L’SOS resta attivo.',
  rpc_unavailable: 'Il servizio remoto di chiusura non è disponibile.',
  unexpected_response: 'Il server non ha restituito la conferma attesa.',
  unexpected_status: 'Il server ha restituito uno stato diverso da quello richiesto.',
  network: 'Connessione al servizio non disponibile. Controlla la rete e riprova.',
  unknown: 'Errore tecnico durante la chiusura remota. L’SOS resta attivo.',
};

export class SOSLifecycleDiagnosticError extends Error {
  constructor(readonly category: SOSLifecycleErrorCategory) {
    super(SOS_LIFECYCLE_ERROR_MESSAGES[category]);
    this.name = 'SOSLifecycleDiagnosticError';
  }
}

const getSupabaseErrorCode = (error: unknown) => {
  const source = error instanceof BackendError ? error.cause : error;
  if (!source || typeof source !== 'object' || !('code' in source)) {
    return null;
  }

  return typeof source.code === 'string' ? source.code.toUpperCase() : null;
};

export const getSOSLifecycleDiagnosticError = (error: unknown) => {
  if (error instanceof SOSLifecycleDiagnosticError) {
    return error;
  }

  if (error instanceof BackendError && error.technicalCode === 'EMPTY_RPC_RESULT') {
    return new SOSLifecycleDiagnosticError('unexpected_response');
  }

  const code = getSupabaseErrorCode(error);
  if (code === 'PGRST116') {
    return new SOSLifecycleDiagnosticError('unexpected_response');
  }
  if (code === '55000') {
    return new SOSLifecycleDiagnosticError('invalid_transition');
  }

  const source = error instanceof BackendError ? error.cause : error;
  const backendCategory = classifyBackendError(source);
  if (backendCategory === 'unauthenticated') {
    return new SOSLifecycleDiagnosticError('auth');
  }
  if (backendCategory === 'forbidden') {
    return new SOSLifecycleDiagnosticError('not_authorized_or_missing');
  }
  if (backendCategory === 'backend_unavailable') {
    return new SOSLifecycleDiagnosticError('rpc_unavailable');
  }
  if (backendCategory === 'network') {
    return new SOSLifecycleDiagnosticError('network');
  }

  return new SOSLifecycleDiagnosticError('unknown');
};

const inFlightTransitions = new Map<string, Promise<SOSLifecycleState>>();
const SOS_TRANSITION_TIMEOUT_MS = 12_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireSOSId = (sosId: string) => {
  if (!UUID_PATTERN.test(sosId)) {
    throw new SOSLifecycleDiagnosticError('invalid_sos_id');
  }
};

const runTransition = (
  transition: SOSTransition,
  sosId: string,
  operation: (signal: AbortSignal) => Promise<SOSLifecycleState>,
) => {
  requireSOSId(sosId);
  const requestKey = `${transition}:${sosId}`;
  const existingRequest = inFlightTransitions.get(requestKey);

  if (existingRequest) {
    return existingRequest;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const request = Promise.race([
    operation(controller.signal),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => {
          reject(new SOSLifecycleDiagnosticError('timeout'));
          controller.abort();
        },
        SOS_TRANSITION_TIMEOUT_MS,
      );
    }),
  ])
    .catch((error: unknown) => {
      throw getSOSLifecycleDiagnosticError(error);
    })
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (inFlightTransitions.get(requestKey) === request) {
        inFlightTransitions.delete(requestKey);
      }
    });
  inFlightTransitions.set(requestKey, request);
  return request;
};

export const isActiveSOSStatus = (
  status: SosStatus,
): status is Extract<SosStatus, 'open' | 'accepted'> =>
  status === 'open' || status === 'accepted';

export const SOSLifecycleService = {
  async getStatus(sosId: string) {
    requireSOSId(sosId);
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        SOSLifecycleRepository.getStatus(sosId, controller.signal),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new SOSLifecycleDiagnosticError('timeout'));
            controller.abort();
          }, SOS_TRANSITION_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      throw getSOSLifecycleDiagnosticError(error);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  },

  accept(sosId: string) {
    return runTransition('accept', sosId, (signal) => SOSLifecycleRepository.accept(sosId, signal));
  },

  close(sosId: string) {
    return runTransition('close', sosId, (signal) => SOSLifecycleRepository.close(sosId, signal));
  },

  cancel(sosId: string) {
    return runTransition('cancel', sosId, (signal) => SOSLifecycleRepository.cancel(sosId, signal));
  },
};
