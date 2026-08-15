import type { Database } from '@/backend/database.types';
import { BackendError } from '@/backend/errors/BackendError';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type PushTokenInsert = Database['public']['Tables']['device_push_tokens']['Insert'];

const isMissingClaimFunction = (error: { code?: string } | null) =>
  error?.code === 'PGRST202' || error?.code === '42883';

export const PushTokenRepository = {
  async upsertForUser(input: PushTokenInsert) {
    const client = requireSupabaseClient();
    const claimResult = await client
      .rpc('claim_my_device_push_token', {
        target_expo_push_token: input.expo_push_token,
        target_platform: input.platform,
        target_device_name: input.device_name ?? null,
      })
      .single();

    if (!claimResult.error) {
      console.log('[SafeMeLink Push] Token associato al dispositivo corrente.', {
        platform: input.platform,
        active: claimResult.data.active,
        updatedAt: claimResult.data.updated_at,
      });
      return claimResult.data;
    }

    if (!isMissingClaimFunction(claimResult.error)) {
      console.error('[SafeMeLink Push] Claim device_push_tokens non riuscito.', {
        platform: input.platform,
        code: claimResult.error.code,
      });
      throw new BackendError(
        'Impossibile associare il token push al dispositivo corrente.',
        claimResult.error,
      );
    }

    console.warn('[SafeMeLink Push] RPC claim token non disponibile; uso compatibilità legacy.');
    const { data, error } = await client
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
      console.error('[SafeMeLink Push] Upsert device_push_tokens non riuscito.', {
        platform: input.platform,
        code: error.code,
        possibleTokenOwnershipConflict:
          error.code === '23505' || error.code === '42501',
      });
      throw new BackendError('Impossibile salvare il token push del dispositivo.', error);
    }

    console.log('[SafeMeLink Push] Upsert device_push_tokens completato.', {
      platform: input.platform,
      active: data.active,
      updatedAt: data.updated_at,
    });

    return data;
  },

  async removeForUserAndToken(userId: string, expoPushToken: string) {
    const { error } = await requireSupabaseClient()
      .from('device_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('expo_push_token', expoPushToken);

    if (error) {
      throw new BackendError('Impossibile rimuovere il token push del dispositivo.', error);
    }

    console.log('[SafeMeLink Push] Token rimosso per il logout.');
  },
};
