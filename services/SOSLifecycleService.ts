import type { SosStatus } from '@/backend/database.types';
import { SOSLifecycleRepository } from '@/backend/repositories/SOSLifecycleRepository';

export type SOSLifecycleState = Awaited<
  ReturnType<typeof SOSLifecycleRepository.getStatus>
>;
export type SOSTransition = 'accept' | 'cancel' | 'close';

const inFlightTransitions = new Map<string, Promise<SOSLifecycleState>>();
const SOS_TRANSITION_TIMEOUT_MS = 12_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireSOSId = (sosId: string) => {
  if (!UUID_PATTERN.test(sosId)) {
    throw new Error('Identificativo SOS non valido.');
  }
};

const runTransition = (
  transition: SOSTransition,
  sosId: string,
  operation: () => Promise<SOSLifecycleState>,
) => {
  requireSOSId(sosId);
  const requestKey = `${transition}:${sosId}`;
  const existingRequest = inFlightTransitions.get(requestKey);

  if (existingRequest) {
    return existingRequest;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const request = Promise.race([
    operation(),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('La richiesta di chiusura SOS non risponde. Riprova.')),
        SOS_TRANSITION_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
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
    return SOSLifecycleRepository.getStatus(sosId);
  },

  accept(sosId: string) {
    return runTransition('accept', sosId, () => SOSLifecycleRepository.accept(sosId));
  },

  close(sosId: string) {
    return runTransition('close', sosId, () => SOSLifecycleRepository.close(sosId));
  },

  cancel(sosId: string) {
    return runTransition('cancel', sosId, () => SOSLifecycleRepository.cancel(sosId));
  },
};
