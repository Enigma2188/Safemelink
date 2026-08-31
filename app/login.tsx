import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import { AccountAccessPanel } from '@/components/AccountAccessPanel';

export default function LoginScreen() {
  const { session, isInitializing } = useAuth();
  const router = useRouter();
  const navigationInFlightRef = useRef(false);
  const navigationCompletedRef = useRef(false);

  useEffect(
    () => () => {
      if (navigationInFlightRef.current) {
        console.info('[SafeMeLink Navigation] navigazione login annullata nel cleanup.', {
          origin: '/login',
        });
      }
      navigationInFlightRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (isInitializing || !session) {
      if (!session) {
        navigationCompletedRef.current = false;
      }
      return;
    }

    if (navigationInFlightRef.current || navigationCompletedRef.current) {
      console.info('[SafeMeLink Navigation] navigazione login duplicata ignorata.', {
        origin: '/login',
      });
      return;
    }

    navigationInFlightRef.current = true;
    const startedAt = Date.now();
    const canGoBack = router.canGoBack();
    const destination = canGoBack ? 'schermata precedente' : '/';
    console.info('[SafeMeLink Navigation] inizio navigazione dopo login.', {
      origin: '/login',
      destination,
    });

    try {
      if (canGoBack) {
        router.back();
      } else {
        router.replace('/');
      }
      navigationCompletedRef.current = true;
      console.info('[SafeMeLink Navigation] fine navigazione dopo login.', {
        origin: '/login',
        destination,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error('[SafeMeLink Navigation] errore navigazione dopo login.', {
        origin: '/login',
        destination,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'Errore sconosciuto.',
      });
    } finally {
      navigationInFlightRef.current = false;
    }
  }, [isInitializing, router, session]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoidingView}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
          keyboardShouldPersistTaps="handled">
          <AccountAccessPanel />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#050816',
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
});
