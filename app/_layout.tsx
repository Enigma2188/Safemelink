import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, type Href, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import '@/services/SOSNetworkBackgroundTask';
import '@/services/SOSLiveLocationBackgroundTask';

import { AuthProvider } from '@/backend/auth/AuthProvider';
import { OfflineStatusBanner } from '@/components/OfflineStatusBanner';
import { OnboardingProvider, useOnboarding } from '@/components/OnboardingProvider';
import { PushTokenRegistrar } from '@/components/PushTokenRegistrar';
import { SOSNotificationCenter } from '@/components/SOSNotificationCenter';
import { SOSNetworkPresenceProvider } from '@/components/SOSNetworkPresenceProvider';
import { VoiceProtectionLifecycle } from '@/components/VoiceProtectionLifecycle';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <OnboardingProvider>
      <RootNavigator />
    </OnboardingProvider>
  );
}

function RootNavigator() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const { isComplete, isLoading } = useOnboarding();
  const currentRootSegment = String(segments[0] ?? '');

  if (isLoading) {
    return <View style={styles.loadingScreen} />;
  }

  // Confirmation links must remain reachable even before first-run onboarding.
  if (!isComplete && currentRootSegment === 'email-confirmed') {
    return <Stack><Stack.Screen name="email-confirmed" options={{ headerShown: false }} /></Stack>;
  }

  if (!isComplete) {
    if (currentRootSegment !== 'onboarding') {
      return <Redirect href={'/onboarding' as Href} />;
    }

    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <View style={styles.container}>
          <Stack>
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="light" />
        </View>
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider>
      <SOSNetworkPresenceProvider>
        <PushTokenRegistrar />
        <VoiceProtectionLifecycle />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <View style={styles.container}>
            <OfflineStatusBanner />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ title: 'Login' }} />
              <Stack.Screen name="email-confirmed" options={{ headerShown: false }} />
              <Stack.Screen
                name="emergency-profile"
                options={{ title: 'Profilo di Emergenza' }}
              />
              <Stack.Screen
                name="voice-protection"
                options={{
                  headerStyle: { backgroundColor: '#080D20' },
                  headerTintColor: '#F7FAFF',
                  title: 'Protezione Vocale',
                }}
              />
              <Stack.Screen
                name="neighborhood-network"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="network" options={{ headerShown: false }} />
              <Stack.Screen name="protection-signal" options={{ headerShown: false }} />
              <Stack.Screen
                name="how-safemelink-works"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            </Stack>
            <SOSNotificationCenter />
            <StatusBar style="auto" />
          </View>
        </ThemeProvider>
      </SOSNetworkPresenceProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingScreen: {
    backgroundColor: '#050816',
    flex: 1,
  },
});
