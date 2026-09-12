import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import {
  CURRENT_ONBOARDING_VERSION,
  OnboardingStorage,
} from '@/storage/OnboardingStorage';

type OnboardingContextValue = {
  completeOnboarding: () => Promise<void>;
  isComplete: boolean;
  isLoading: boolean;
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export function OnboardingProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void OnboardingStorage.getCompletedVersion()
      .then((completedVersion) => {
        if (isMounted) {
          setIsComplete(completedVersion >= CURRENT_ONBOARDING_VERSION);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsComplete(false);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      completeOnboarding: async () => {
        await OnboardingStorage.markCurrentVersionCompleted();
        setIsComplete(true);
      },
      isComplete,
      isLoading,
    }),
    [isComplete, isLoading],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error('useOnboarding deve essere usato dentro OnboardingProvider.');
  }

  return context;
}
