import { AuthService } from '@/backend/auth/AuthService';

const SOS_SESSION_TIMEOUT_MS = 20_000;

export class SOSSessionTimeoutError extends Error {
  constructor() {
    super('Timeout durante il recupero della sessione per il flusso SOS.');
    this.name = 'SOSSessionTimeoutError';
  }
}

export async function getSOSSessionWithTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      AuthService.getSession(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new SOSSessionTimeoutError()),
          SOS_SESSION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
