import type { Session } from '@supabase/supabase-js';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { AuthService } from '@/backend/auth/AuthService';

type AuthContextValue = {
  session: Session | null;
  isInitializing: boolean;
  isSubmitting: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Operazione di autenticazione non riuscita.';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const subscription = AuthService.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        setSession(nextSession);
      }
    });

    void AuthService.getSession()
      .then((storedSession) => {
        if (isMounted) {
          setSession(storedSession);
        }
      })
      .catch((sessionError: unknown) => {
        if (isMounted) {
          setError(getErrorMessage(sessionError));
        }
      })
      .finally(() => {
        if (isMounted) {
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
          setSession(nextSession);
        } catch (loginError: unknown) {
          setError(getErrorMessage(loginError));
        } finally {
          setIsSubmitting(false);
        }
      },
      logout: async () => {
        setIsSubmitting(true);
        setError(null);

        try {
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
