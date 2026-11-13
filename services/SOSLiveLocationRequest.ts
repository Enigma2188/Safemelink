// One transport at a time: abort is awaited, never raced with another request.
// No payload persistence, unbounded queue, or background execution guarantee.
const BACKOFF_MS = [1_000, 3_000];
const REQUEST_TIMEOUT_MS = 8_000;

const abortError = () => new Error('GPS request cancelled');
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
  signal.addEventListener('abort', cancel, { once: true });
});

const transient = (error: unknown) => {
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error;
  if (cause instanceof TypeError) return true;
  if (!cause || typeof cause !== 'object') return false;
  const status = 'status' in cause ? Number(cause.status) : 0;
  const message = 'message' in cause ? String(cause.message) : '';
  return status === 429 || status >= 500 && status <= 599 ||
    /failed to fetch|network request failed|networkerror/i.test(message);
};

export async function requestSOSLocation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  current: () => boolean,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted || !current()) throw abortError();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const result = await operation(controller.signal);
      if (signal.aborted || !current()) throw abortError();
      if (timedOut) throw new Error('GPS response timed out');
      return result;
    } catch (error) {
      if (signal.aborted || !current() || attempt >= BACKOFF_MS.length || (!timedOut && !transient(error))) throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
    await wait(BACKOFF_MS[attempt], signal);
  }
}
