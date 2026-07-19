import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider } from '@/backend/auth/AuthProvider';
import { PushTokenRegistrar } from '@/components/PushTokenRegistrar';
import { TestAuthPanel } from '@/components/TestAuthPanel';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <PushTokenRegistrar />
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <View style={styles.container}>
          <TestAuthPanel />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </View>
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
