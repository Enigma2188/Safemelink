export const REMOTE_REQUEST_TIMEOUT_MS = 15_000;

export class RemoteRequestTimeoutError extends Error {
  readonly category = 'timeout' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RemoteRequestTimeoutError';
  }
}

export async function runRemoteRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REMOTE_REQUEST_TIMEOUT_MS);

  try {
    const result = await operation(controller.signal);
    if (timedOut) {
      throw new RemoteRequestTimeoutError(timeoutMessage);
    }
    return result;
  } catch (error) {
    if (timedOut) {
      throw new RemoteRequestTimeoutError(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
