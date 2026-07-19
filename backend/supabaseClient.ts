import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';

import { supabaseConfig } from '@/backend/config';
import type { Database } from '@/backend/database.types';

let client: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!supabaseConfig.isConfigured) {
    return null;
  }

  if (!client) {
    client = createClient<Database>(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
    });

    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        client?.auth.startAutoRefresh();
        return;
      }

      client?.auth.stopAutoRefresh();
    });

    if (AppState.currentState === 'active') {
      client.auth.startAutoRefresh();
    } else {
      client.auth.stopAutoRefresh();
    }
  }

  return client;
}

export function requireSupabaseClient(): SupabaseClient<Database> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase non configurato. Aggiungi le variabili EXPO_PUBLIC_SUPABASE_* locali.');
  }

  return supabase;
}
