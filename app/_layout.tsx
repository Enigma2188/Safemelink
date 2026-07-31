import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider } from '@/backend/auth/AuthProvider';
import { PushTokenRegistrar } from '@/components/PushTokenRegistrar';
import { RadarProvider } from '@/components/RadarProvider';
import { VoiceProtectionLifecycle } from '@/components/VoiceProtectionLifecycle';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <RadarProvider>
        <PushTokenRegistrar />
        <VoiceProtectionLifecycle />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <View style={styles.container}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ title: 'Login' }} />
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
            </Stack>
            <StatusBar style="auto" />
          </View>
        </ThemeProvider>
      </RadarProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
