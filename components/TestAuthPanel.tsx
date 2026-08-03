import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';

export function TestAuthPanel() {
  const { session, isInitializing, isSubmitting, error, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isAuthenticated = session !== null;

  const handleLogin = async () => {
    await login(email, password);
    setPassword('');
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>SUPABASE SESSION</Text>
      <Text style={[styles.status, isAuthenticated ? styles.authenticated : styles.notAuthenticated]}>
        {isAuthenticated ? 'AUTHENTICATED' : 'NOT AUTHENTICATED'}
      </Text>

      {isAuthenticated ? (
        <>
          <Text numberOfLines={1} style={styles.email}>
            {session.user.email ?? 'Email non disponibile'}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void logout()}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
            <Text style={styles.buttonText}>Logout</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            editable={!isSubmitting}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            style={styles.input}
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            editable={!isSubmitting}
            onChangeText={setPassword}
            onSubmitEditing={() => void handleLogin()}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || !email.trim() || !password}
            onPress={() => void handleLogin()}
            style={({ pressed }) => [
              styles.button,
              (isSubmitting || !email.trim() || !password) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}>
            <Text style={styles.buttonText}>Login</Text>
          </Pressable>
        </View>
      )}

      {(isInitializing || isSubmitting) && <ActivityIndicator size="small" color="#2563eb" />}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#f8fafc',
    borderBottomColor: '#cbd5e1',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heading: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  status: {
    fontSize: 13,
    fontWeight: '800',
  },
  authenticated: {
    color: '#15803d',
  },
  notAuthenticated: {
    color: '#b91c1c',
  },
  email: {
    color: '#0f172a',
    fontSize: 13,
  },
  form: {
    gap: 8,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#94a3b8',
    borderRadius: 6,
    borderWidth: 1,
    color: '#0f172a',
    flex: 1,
    fontSize: 13,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#2563eb',
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    color: '#b91c1c',
    fontSize: 12,
  },
});
