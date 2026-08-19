import type { Session } from '@supabase/supabase-js';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { AuthService } from '@/backend/auth/AuthService';
import { PushNotificationService } from '@/services/PushNotificationService';
import { RadarService } from '@/services/RadarService';

type AuthContextValue = {
  session: Session | null;
  isInitializing: boolean;
  isSubmitting: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
  ) => Promise<{ requiresEmailConfirmation: boolean } | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getErrorMessage(error: unknown) {
  const errorLike = error && typeof error === 'object'
    ? (error as { code?: unknown; message?: unknown })
    : null;
  const code = typeof errorLike?.code === 'string' ? errorLike.code : '';
  const message = typeof errorLike?.message === 'string' ? errorLike.message : '';

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'Email o password non corrette.';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Conferma l’indirizzo email prima di accedere.';
  }
  if (code === 'user_already_exists' || /user already registered/i.test(message)) {
    return 'Esiste già un account con questo indirizzo email.';
  }
  if (code === 'weak_password' || /password.*weak/i.test(message)) {
    return 'Scegli una password più sicura.';
  }
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(message)) {
    return 'Sono state effettuate troppe richieste. Attendi qualche minuto e riprova.';
  }
  if (code === 'signup_disabled') {
    return 'La creazione di nuovi account non è disponibile.';
  }
  if (/network|failed to fetch|fetch failed/i.test(message)) {
    return 'Connessione non disponibile. Controlla la rete e riprova.';
  }
  if (
    /^(Configurazione account|Servizio account|Sessione account|Accesso non completato|Supabase non configurato)/.test(
      message,
    )
  ) {
    return message;
  }

  return 'Operazione di autenticazione non riuscita. Riprova.';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let sessionGeneration = 0;
    let initializedUserId: string | null = null;

    const applySession = async (nextSession: Session | null) => {
      const generation = ++sessionGeneration;

      if (!nextSession) {
        initializedUserId = null;
        if (isMounted) {
          setSession(null);
          setIsInitializing(false);
        }
        return;
      }

      try {
        if (initializedUserId !== nextSession.user.id) {
          await AuthService.initializeAccount(nextSession.user.id);
          if (generation === sessionGeneration) {
            initializedUserId = nextSession.user.id;
          }
        }

        if (isMounted && generation === sessionGeneration) {
          setSession(nextSession);
          setError(null);
        }
      } catch (initializationError: unknown) {
        if (isMounted && generation === sessionGeneration) {
          setSession((currentSession) =>
            currentSession?.user.id === nextSession.user.id ? currentSession : null,
          );
          setError(getErrorMessage(initializationError));
        }
      } finally {
        if (isMounted && generation === sessionGeneration) {
          setIsInitializing(false);
        }
      }
    };

    const subscription = AuthService.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    void AuthService.getSession()
      .then((storedSession) => {
        void applySession(storedSession);
      })
      .catch((sessionError: unknown) => {
        if (isMounted) {
          setError(getErrorMessage(sessionError));
        }
      })
      .finally(() => {
        if (isMounted && sessionGeneration === 0) {
          setIsInitializing(false);
        }
      });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isInitializing,
      isSubmitting,
      error,
      login: async (email, password) => {
        setIsSubmitting(true);
        setError(null);

        try {
          const nextSession = await AuthService.signInWithPassword(email.trim(), password);

          if (!nextSession) {
            throw new Error('Accesso non completato. Verifica l’account e riprova.');
          }

          await AuthService.initializeAccount(nextSession.user.id);
          setSession(nextSession);
        } catch (loginError: unknown) {
          setError(getErrorMessage(loginError));
        } finally {
          setIsSubmitting(false);
        }
      },
      signup: async (email, password) => {
        setIsSubmitting(true);
        setError(null);

        try {
          const result = await AuthService.signUp(email.trim(), password);

          if (result.session) {
            await AuthService.initializeAccount(result.session.user.id);
            setSession(result.session);
          }

          return { requiresEmailConfirmation: result.requiresEmailConfirmation };
        } catch (signupError: unknown) {
          setError(getErrorMessage(signupError));
          return null;
        } finally {
          setIsSubmitting(false);
        }
      },
      logout: async () => {
        setIsSubmitting(true);
        setError(null);

        try {
          if (session) {
            const cleanupResults = await Promise.allSettled([
              RadarService.deactivatePresence(),
              PushNotificationService.unregisterDeviceForUser(session.user.id),
            ]);

            cleanupResults.forEach((result) => {
              if (result.status === 'rejected') {
                console.warn('[SafeMeLink Auth] Pulizia pre-logout non riuscita.', {
                  category: result.reason instanceof Error ? result.reason.name : 'unknown',
                });
              }
            });
          }

          await AuthService.signOut();
          setSession(null);
        } catch (logoutError: unknown) {
          setError(getErrorMessage(logoutError));
        } finally {
          setIsSubmitting(false);
        }
      },
    }),
    [error, isInitializing, isSubmitting, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth deve essere usato all\'interno di AuthProvider.');
  }

  return context;
}
