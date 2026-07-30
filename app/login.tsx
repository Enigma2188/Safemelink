import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';
import { TestAuthPanel } from '@/components/TestAuthPanel';

export default function LoginScreen() {
  const { session, isInitializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isInitializing && session) {
      router.back();
    }
  }, [isInitializing, router, session]);

  return (
    <SafeAreaView style={styles.container}>
      <TestAuthPanel />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
});
