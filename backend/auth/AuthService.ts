import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/backend/supabaseClient';

const AUTH_REQUEST_TIMEOUT_MS = 15_000;
const ACCOUNT_INITIALIZATION_TIMEOUT_MS = 15_000;
const accountInitializations = new Map<string, Promise<void>>();

const withAuthRequestTimeout = async <T>(
  operation: PromiseLike<T>,
  timeoutMessage = 'Servizio account non disponibile. Controlla la rete e riprova.',
) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(timeoutMessage)),
          AUTH_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

function requireAuthClient() {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase non configurato. Verifica le variabili EXPO_PUBLIC_SUPABASE_* locali.');
  }

  return client;
}

export const AuthService = {
  isConfigured() {
    return getSupabaseClient() !== null;
  },

  async getSession() {
    const client = getSupabaseClient();

    if (!client) {
      return null;
    }

    const { data, error } = await withAuthRequestTimeout(client.auth.getSession());

    if (error) {
      throw error;
    }

    return data.session;
  },

  async signInWithPassword(email: string, password: string) {
    const client = requireAuthClient();
    const { data, error } = await withAuthRequestTimeout(
      client.auth.signInWithPassword({ email, password }),
    );

    if (error) {
      throw error;
    }

    return data.session;
  },

  async signUp(email: string, password: string) {
    const client = requireAuthClient();
    const { data, error } = await withAuthRequestTimeout(
      client.auth.signUp({ email, password }),
    );

    if (error) {
      throw error;
    }

    return {
      session: data.session,
      requiresEmailConfirmation: data.session === null,
    };
  },

  initializeAccount(userId: string) {
    const existingInitialization = accountInitializations.get(userId);

    if (existingInitialization) {
      return existingInitialization;
    }

    const initialization = (async () => {
      const client = requireAuthClient();
      const { data: sessionData, error: sessionError } = await withAuthRequestTimeout(
        client.auth.getSession(),
        'Configurazione account non disponibile. Riprova.',
      );

      if (sessionError || sessionData.session?.user.id !== userId) {
        throw sessionError ?? new Error('Sessione account non più disponibile.');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        ACCOUNT_INITIALIZATION_TIMEOUT_MS,
      );

      try {
        const { data, error } = await client
          .rpc('initialize_my_account')
          .abortSignal(controller.signal)
          .single();

        if (error || data.profile_id !== userId) {
          throw error ?? new Error('Profilo account non inizializzato.');
        }
      } catch (initializationError) {
        if (controller.signal.aborted) {
          throw new Error('Configurazione account non disponibile. Riprova.');
        }
        throw initializationError;
      } finally {
        clearTimeout(timeoutId);
      }
    })().finally(() => {
      if (accountInitializations.get(userId) === initialization) {
        accountInitializations.delete(userId);
      }
    });

    accountInitializations.set(userId, initialization);
    return initialization;
  },

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    const client = getSupabaseClient();

    if (!client) {
      return null;
    }

    const { data } = client.auth.onAuthStateChange(callback);
    return data.subscription;
  },

  async signOut() {
    const client = requireAuthClient();
    const { error } = await withAuthRequestTimeout(client.auth.signOut());

    if (error) {
      throw error;
    }
  },
};
