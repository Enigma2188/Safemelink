import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import { TestAuthPanel } from '@/components/TestAuthPanel';

export default function LoginScreen() {
  const { session, isInitializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isInitializing && session) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    }
  }, [isInitializing, router, session]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <TestAuthPanel />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
});
