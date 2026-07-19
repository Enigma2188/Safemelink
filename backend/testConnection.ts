import { getSupabaseClient } from '@/backend/supabaseClient';

export type SupabaseConnectionTestResult = {
  ok: boolean;
  status?: number;
  error?: {
    message: string;
    code?: string;
  };
};

export async function testSupabaseConnection(): Promise<SupabaseConnectionTestResult> {
  const client = getSupabaseClient();

  if (!client) {
    const error = {
      message: 'Configurazione Supabase assente o incompleta.',
    };

    console.error('[SafeMeLink Supabase] errore di connessione', error);
    return { ok: false, error };
  }

  try {
    const { error, status } = await client.from('profiles').select('id').limit(1);

    if (error) {
      const details = {
        message: 'La query di verifica non e stata completata.',
        code: error.code,
      };

      console.error('[SafeMeLink Supabase] errore di connessione', {
        status,
        code: error.code || 'UNKNOWN',
      });
      return { ok: false, status, error: details };
    }

    console.info('[SafeMeLink Supabase] connessione riuscita', { status });
    return { ok: true, status };
  } catch (cause) {
    const error = {
      message: cause instanceof Error ? 'Errore di rete o runtime.' : 'Errore sconosciuto.',
    };

    console.error('[SafeMeLink Supabase] errore di connessione', error);
    return { ok: false, error };
  }
}
