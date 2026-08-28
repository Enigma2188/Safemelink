import type { Session } from '@supabase/supabase-js';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import {
  AuthService,
  classifyAuthFailure,
} from '@/backend/auth/AuthService';
import { PushNotificationService } from '@/services/PushNotificationService';
import { RadarService } from '@/services/RadarService';
import { SOSNetworkPresenceRepository } from '@/backend/repositories/SOSNetworkPresenceRepository';
import { SOSNetworkPresenceService } from '@/services/SOSNetworkPresenceService';

type AuthContextValue = {
  session: Session | null;
  isInitializing: boolean;
  isSubmitting: boolean;
  isOffline: boolean;
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
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let sessionGeneration = 0;
    let initializedUserId: string | null = null;
    let offlineUserId: string | null = null;
    let currentSession: Session | null = null;
    let recoveryAttempt = 0;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRecoveryTimer = () => {
      if (recoveryTimer) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
    };

    const invalidateSession = (generation: number) => {
      if (!isMounted || generation !== sessionGeneration) {
        return;
      }

      clearRecoveryTimer();
      currentSession = null;
      initializedUserId = null;
      offlineUserId = null;
      setSession(null);
      setIsOffline(false);
      setError('La sessione è scaduta. Accedi nuovamente.');
      setIsInitializing(false);
    };

    const bootstrapSession = async (
      nextSession: Session,
      generation: number,
      allowRefresh = true,
    ): Promise<void> => {
      try {
        await AuthService.initializeAccount(nextSession.user.id);

        if (!isMounted || generation !== sessionGeneration) {
          return;
        }

        clearRecoveryTimer();
        recoveryAttempt = 0;
        initializedUserId = nextSession.user.id;
        offlineUserId = null;
        setSession(nextSession);
        setIsOffline(false);
        setError(null);
      } catch (initializationError: unknown) {
        if (!isMounted || generation !== sessionGeneration) {
          return;
        }

        const category = classifyAuthFailure(initializationError);
        if (category === 'network') {
          offlineUserId = nextSession.user.id;
          setSession(nextSession);
          setIsOffline(true);
          setError(null);
          scheduleRecovery(nextSession, generation);
          return;
        }

        if (category === 'invalid_session' && allowRefresh) {
          try {
            const refreshedSession = await AuthService.refreshSession();
            if (
              !refreshedSession ||
              refreshedSession.user.id !== nextSession.user.id
            ) {
              invalidateSession(generation);
              return;
            }

            if (!isMounted || generation !== sessionGeneration) {
              return;
            }

            currentSession = refreshedSession;
            setSession(refreshedSession);
            await bootstrapSession(refreshedSession, generation, false);
            return;
          } catch (refreshError: unknown) {
            if (classifyAuthFailure(refreshError) === 'network') {
              offlineUserId = nextSession.user.id;
              setSession(nextSession);
              setIsOffline(true);
              setError(null);
              scheduleRecovery(nextSession, generation);
              return;
            }
          }
        }

        if (category === 'invalid_session') {
          invalidateSession(generation);
          return;
        }

        setSession(nextSession);
        setIsOffline(false);
        setError(getErrorMessage(initializationError));
      } finally {
        if (isMounted && generation === sessionGeneration) {
          setIsInitializing(false);
        }
      }
    };

    function scheduleRecovery(nextSession: Session, generation: number) {
      if (
        !isMounted ||
        generation !== sessionGeneration ||
        recoveryTimer ||
        offlineUserId !== nextSession.user.id
      ) {
        return;
      }

      const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(recoveryAttempt, 4));
      recoveryAttempt += 1;
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        if (
          isMounted &&
          generation === sessionGeneration &&
          currentSession?.user.id === nextSession.user.id
        ) {
          void bootstrapSession(currentSession, generation);
        }
      }, delayMs);
    }

    const applySession = async (nextSession: Session | null) => {
      const generation = ++sessionGeneration;
      clearRecoveryTimer();
      currentSession = nextSession;

      if (!nextSession) {
        initializedUserId = null;
        offlineUserId = null;
        recoveryAttempt = 0;
        if (isMounted) {
          setSession(null);
          setIsOffline(false);
          setIsInitializing(false);
        }
        return;
      }

      if (isMounted) {
        setSession(nextSession);
        setIsInitializing(
          initializedUserId !== nextSession.user.id || offlineUserId !== null,
        );
        setError(null);
      }

      if (initializedUserId === nextSession.user.id && offlineUserId === null) {
        setIsOffline(false);
        return;
      }

      await bootstrapSession(nextSession, generation);
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
          const category = classifyAuthFailure(sessionError);
          setIsOffline(category === 'network');
          setError(category === 'network' ? null : getErrorMessage(sessionError));
        }
      })
      .finally(() => {
        if (isMounted && sessionGeneration === 0) {
          setIsInitializing(false);
        }
      });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !currentSession || !offlineUserId) {
        return;
      }

      clearRecoveryTimer();
      void bootstrapSession(currentSession, sessionGeneration);
    });

    return () => {
      isMounted = false;
      clearRecoveryTimer();
      subscription?.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isInitializing,
      isSubmitting,
      isOffline,
      error,
      login: async (email, password) => {
        setIsSubmitting(true);
        setError(null);

        try {
          const nextSession = await AuthService.signInWithPassword(email.trim(), password);

          if (!nextSession) {
            throw new Error('Accesso non completato. Verifica l’account e riprova.');
          }

          setSession(nextSession);
          setIsOffline(false);
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
            setSession(result.session);
            setIsOffline(false);
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
        if (isOffline) {
          setError('Sei offline. Riconnettiti prima di cambiare o disconnettere l’account.');
          return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
          if (session) {
            const cleanupResults = await Promise.allSettled([
              RadarService.deactivatePresence(),
              SOSNetworkPresenceService.stopBackgroundUpdates(),
              SOSNetworkPresenceRepository.deactivatePresence(),
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
    [error, isInitializing, isOffline, isSubmitting, session],
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
