export class SafetyOperationError extends Error {
  constructor(readonly stage: string) {
    super('Controllo di sicurezza non disponibile. Riprova.');
    this.name = 'SafetyOperationError';
  }
}

export const reportSafetyError = (stage: string) => {
  console.warn('[SafetyExpiration] OPERATION_FAILED', { stage });
};

export const getSafetyErrorMessage = (error: unknown) => {
  if (error instanceof SafetyOperationError) {
    if (/storage|source|history/.test(error.stage)) return 'Salvataggio sul dispositivo non riuscito. Riprova.';
    if (/service|task|voice_settings/.test(error.stage)) return 'Il servizio di sicurezza non è partito. Verifica le autorizzazioni Android e riprova.';
  }
  return 'Programmazione del controllo non confermata. Riprova.';
};

export async function withSafetyTimeout<T>(
  operation: PromiseLike<T>,
  stage: string,
  timeoutMs = 8_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SafetyOperationError(stage)), timeoutMs);
      }),
    ]);
  } catch {
    reportSafetyError(stage);
    throw new SafetyOperationError(stage);
  } finally {
    clearTimeout(timer);
  }
}
