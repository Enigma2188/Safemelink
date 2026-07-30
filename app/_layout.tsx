import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider } from '@/backend/auth/AuthProvider';
import { PushTokenRegistrar } from '@/components/PushTokenRegistrar';
import { RadarProvider } from '@/components/RadarProvider';
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
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <View style={styles.container}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ title: 'Login' }} />
              <Stack.Screen
                name="emergency-profile"
                options={{ title: 'Profilo di Emergenza' }}
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
