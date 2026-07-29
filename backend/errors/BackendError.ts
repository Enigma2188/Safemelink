export type BackendErrorCategory =
  | 'backend_unavailable'
  | 'unauthenticated'
  | 'forbidden'
  | 'network'
  | 'conflict'
  | 'unknown';

type BackendErrorMessages = {
  fallback: string;
  backendUnavailable?: string;
  unauthenticated?: string;
  forbidden?: string;
  network?: string;
  conflict?: string;
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

const getErrorDetails = (error: unknown) => {
  const errorLike =
    error && typeof error === 'object' ? (error as ErrorLike) : null;
  const code =
    typeof errorLike?.code === 'string' ? errorLike.code.toUpperCase() : null;
  const message =
    typeof errorLike?.message === 'string' ? errorLike.message : '';

  return { code, message };
};

export function classifyBackendError(error: unknown): BackendErrorCategory {
  const { code, message } = getErrorDetails(error);

  if (
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '42883' ||
    code === '42P01'
  ) {
    return 'backend_unavailable';
  }

  if (code === '28000' || code === 'PGRST301') {
    return 'unauthenticated';
  }

  if (code === '42501') {
    return 'forbidden';
  }

  if (code === '23505') {
    return 'conflict';
  }

  if (
    error instanceof TypeError ||
    /failed to fetch|network request failed|networkerror/i.test(message)
  ) {
    return 'network';
  }

  return 'unknown';
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly category: BackendErrorCategory = 'unknown',
    readonly technicalCode: string | null = null,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export function createBackendError(
  operation: string,
  messages: BackendErrorMessages,
  cause: unknown,
) {
  const category = classifyBackendError(cause);
  const { code } = getErrorDetails(cause);
  const message =
    category === 'backend_unavailable'
      ? messages.backendUnavailable ?? messages.fallback
      : category === 'unauthenticated'
        ? messages.unauthenticated ?? messages.fallback
        : category === 'forbidden'
          ? messages.forbidden ?? messages.fallback
          : category === 'network'
            ? messages.network ?? messages.fallback
            : category === 'conflict'
              ? messages.conflict ?? messages.fallback
              : messages.fallback;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[SafeMeLink Backend] ${operation}`, {
      category,
      code,
    });
  }

  return new BackendError(message, cause, category, code);
}
