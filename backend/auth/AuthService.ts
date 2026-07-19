import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/backend/supabaseClient';

function requireAuthClient() {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase non configurato. Verifica le variabili EXPO_PUBLIC_SUPABASE_* locali.');
  }

  return client;
}

export const AuthService = {
  isConfigured() {
    return getSupabaseClient() !== null;
  },

  async getSession() {
    const client = getSupabaseClient();

    if (!client) {
      return null;
    }

    const { data, error } = await client.auth.getSession();

    if (error) {
      throw error;
    }

    return data.session;
  },

  async signInWithPassword(email: string, password: string) {
    const client = requireAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      throw error;
    }

    return data.session;
  },

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    const client = getSupabaseClient();

    if (!client) {
      return null;
    }

    const { data } = client.auth.onAuthStateChange(callback);
    return data.subscription;
  },

  async signOut() {
    const client = requireAuthClient();
    const { error } = await client.auth.signOut();

    if (error) {
      throw error;
    }
  },
};
