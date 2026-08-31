import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';

type AccessMode = 'login' | 'signup';

export function AccountAccessPanel() {
  const { session, isInitializing, isOffline, isSubmitting, error, login, signup, logout } = useAuth();
  const [mode, setMode] = useState<AccessMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const normalizedEmail = email.trim();
  const isSignup = mode === 'signup';
  const isAuthenticated = session !== null;
  const hasValidSignupInput =
    normalizedEmail.length > 0 &&
    password.length >= 8 &&
    password === passwordConfirmation;
  const canSubmit = isSignup
    ? hasValidSignupInput
    : normalizedEmail.length > 0 && password.length > 0;

  const clearSensitiveFields = () => {
    setPassword('');
    setPasswordConfirmation('');
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    setFeedback(null);

    if (!isSignup) {
      await login(normalizedEmail, password);
      clearSensitiveFields();
      return;
    }

    const result = await signup(normalizedEmail, password);
    clearSensitiveFields();

    if (result?.requiresEmailConfirmation) {
      setFeedback(
        'Account creato. Controlla la tua email per confermare l’indirizzo, poi effettua l’accesso.',
      );
      setMode('login');
    } else if (result) {
      setFeedback('Account creato e configurato correttamente.');
    }
  };

  const switchMode = (nextMode: AccessMode) => {
    if (isSubmitting || nextMode === mode) {
      return;
    }

    setMode(nextMode);
    setFeedback(null);
    clearSensitiveFields();
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Account SafeMeLink</Text>
      <Text style={styles.description}>
        Accedi oppure crea un account personale. I dati locali restano separati per ogni utente.
      </Text>

      {isAuthenticated ? (
        <>
          <Text style={isOffline ? styles.offline : styles.success}>
            {isOffline ? 'Account attivo · modalità offline' : 'Account attivo'}
          </Text>
          <Text numberOfLines={1} style={styles.email}>
            {session.user.email ?? 'Email non disponibile'}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void logout()}
            style={({ pressed }) => [
              styles.button,
              isSubmitting && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}>
            <Text style={styles.buttonText}>Disconnetti</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.modeRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => switchMode('login')}
              style={[styles.modeButton, mode === 'login' && styles.modeButtonActive]}>
              <Text style={[styles.modeText, mode === 'login' && styles.modeTextActive]}>
                Accesso
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => switchMode('signup')}
              style={[styles.modeButton, mode === 'signup' && styles.modeButtonActive]}>
              <Text style={[styles.modeText, mode === 'signup' && styles.modeTextActive]}>
                Crea account
              </Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              editable={!isSubmitting}
              keyboardType="email-address"
              onChangeText={(value) => {
                setEmail(value);
                setFeedback(null);
              }}
              placeholder="Email"
              placeholderTextColor="#7180A3"
              style={styles.input}
              value={email}
            />
            <TextInput
              autoCapitalize="none"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              editable={!isSubmitting}
              onChangeText={(value) => {
                setPassword(value);
                setFeedback(null);
              }}
              onSubmitEditing={() => {
                if (!isSignup) {
                  void handleSubmit();
                }
              }}
              placeholder={isSignup ? 'Password (almeno 8 caratteri)' : 'Password'}
              placeholderTextColor="#7180A3"
              secureTextEntry
              style={styles.input}
              value={password}
            />
            {isSignup ? (
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isSubmitting}
                onChangeText={(value) => {
                  setPasswordConfirmation(value);
                  setFeedback(null);
                }}
                onSubmitEditing={() => void handleSubmit()}
                placeholder="Conferma password"
                placeholderTextColor="#7180A3"
                secureTextEntry
                style={styles.input}
                value={passwordConfirmation}
              />
            ) : null}

            {isSignup && password.length > 0 && password.length < 8 ? (
              <Text style={styles.help}>La password deve contenere almeno 8 caratteri.</Text>
            ) : null}
            {isSignup && passwordConfirmation && password !== passwordConfirmation ? (
              <Text style={styles.help}>Le password non coincidono.</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || !canSubmit}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [
                styles.button,
                (isSubmitting || !canSubmit) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.buttonText}>{isSignup ? 'Crea account' : 'Accedi'}</Text>
            </Pressable>
          </View>
        </>
      )}

      {(isInitializing || isSubmitting) && <ActivityIndicator size="small" color="#45B7FF" />}
      {feedback ? <Text style={styles.success}>{feedback}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#080D20',
    borderColor: 'rgba(69, 183, 255, 0.24)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    margin: 18,
    padding: 20,
  },
  heading: {
    color: '#F7FAFF',
    fontSize: 24,
    fontWeight: '900',
  },
  description: {
    color: '#A8B5D1',
    fontSize: 14,
    lineHeight: 20,
  },
  modeRow: {
    backgroundColor: '#101936',
    borderRadius: 12,
    flexDirection: 'row',
    padding: 4,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    padding: 10,
  },
  modeButtonActive: {
    backgroundColor: '#7868FF',
  },
  modeText: {
    color: '#A8B5D1',
    fontSize: 14,
    fontWeight: '800',
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  email: {
    color: '#F7FAFF',
    fontSize: 14,
  },
  form: {
    gap: 10,
  },
  input: {
    backgroundColor: '#101936',
    borderColor: 'rgba(69, 183, 255, 0.28)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#F7FAFF',
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  help: {
    color: '#FBBF24',
    fontSize: 12,
  },
  offline: {
    color: '#FBBF24',
    fontSize: 13,
    lineHeight: 18,
  },
  success: {
    color: '#45D6A5',
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: '#FF8096',
    fontSize: 13,
    lineHeight: 18,
  },
});
