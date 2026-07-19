export class BackendError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BackendError';
  }
}
