import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.109.0';

export async function getActiveRecipientTokens(
  adminClient: SupabaseClient,
  senderUserId: string,
): Promise<string[]> {
  const { data: contacts, error: contactsError } = await adminClient
    .from('trusted_contacts')
    .select('linked_profile_id')
    .eq('user_id', senderUserId)
    .not('linked_profile_id', 'is', null);

  if (contactsError) {
    throw contactsError;
  }

  const contactRows = (contacts ?? []) as { linked_profile_id: string | null }[];
  const recipientIds = [
    ...new Set(
      contactRows
        .map((contact) => contact.linked_profile_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  if (recipientIds.length === 0) {
    return [];
  }

  const { data: tokenRows, error: tokensError } = await adminClient
    .from('device_push_tokens')
    .select('expo_push_token')
    .in('user_id', recipientIds)
    .eq('active', true);

  if (tokensError) {
    throw tokensError;
  }

  const pushTokenRows = (tokenRows ?? []) as { expo_push_token: string }[];

  return [
    ...new Set(
      pushTokenRows
        .map((row) => row.expo_push_token)
        .filter((token): token is string => typeof token === 'string' && token.length > 0),
    ),
  ];
}
