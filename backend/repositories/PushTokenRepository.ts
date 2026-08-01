import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type PushTokenInsert = Database['public']['Tables']['device_push_tokens']['Insert'];

export const PushTokenRepository = {
  async upsertForUser(input: PushTokenInsert) {
    const { data, error } = await requireSupabaseClient()
      .from('device_push_tokens')
      .upsert(
        {
          ...input,
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'expo_push_token' },
      )
      .select('id,user_id,active,updated_at')
      .single();

    if (error) {
      throw new BackendError('Impossibile salvare il token push del dispositivo.', error);
    }

    console.log('[SafeMeLink Push] Upsert device_push_tokens completato.', {
      rowId: data.id,
      userId: input.user_id,
      platform: input.platform,
      active: data.active,
      updatedAt: data.updated_at,
    });

    return data;
  },

  async deactivateForUserAndToken(userId: string, expoPushToken: string) {
    const { error } = await requireSupabaseClient()
      .from('device_push_tokens')
      .update({
        active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('expo_push_token', expoPushToken);

    if (error) {
      throw new BackendError('Impossibile disattivare il token push del dispositivo.', error);
    }

    console.log('[SafeMeLink Push] Token disattivato per il logout.', { userId });
  },
};
