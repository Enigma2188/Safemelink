import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type PushTokenInsert = Database['public']['Tables']['device_push_tokens']['Insert'];

export const PushTokenRepository = {
  async upsertForUser(input: PushTokenInsert) {
    const { error } = await requireSupabaseClient()
      .from('device_push_tokens')
      .upsert(
        {
          ...input,
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'expo_push_token' },
      );

    if (error) {
      throw new BackendError('Impossibile salvare il token push del dispositivo.', error);
    }

    console.log('[SafeMeLink Push] Upsert device_push_tokens completato.', {
      userId: input.user_id,
      platform: input.platform,
    });
  },
};
