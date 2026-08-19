import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.109.0';

export type SOSRecipientToken = {
  token: string;
  isTrusted: boolean;
  isNearby: boolean;
};

type SOSRecipientRow = {
  recipient_user_id: string;
  is_trusted: boolean;
  is_nearby: boolean;
  distance_meters: number | null;
};

export async function getActiveRecipientTokens(
  adminClient: SupabaseClient,
  sosId: string,
): Promise<{
  recipientIds: string[];
  recipientTokens: SOSRecipientToken[];
  trustedRecipientCount: number;
  nearbyRecipientCount: number;
}> {
  const { data: resolvedRecipients, error: recipientsError } = await adminClient.rpc(
    'prepare_sos_delivery',
    { target_sos_id: sosId },
  );

  if (recipientsError) {
    throw recipientsError;
  }

  const recipientRows = (resolvedRecipients ?? []) as SOSRecipientRow[];
  const recipientIds = [...new Set(recipientRows.map((recipient) => recipient.recipient_user_id))];
  const recipientById = new Map(
    recipientRows.map((recipient) => [recipient.recipient_user_id, recipient]),
  );
  const trustedRecipientCount = recipientRows.filter((recipient) => recipient.is_trusted).length;
  const nearbyRecipientCount = recipientRows.filter((recipient) => recipient.is_nearby).length;

  if (recipientIds.length === 0) {
    return {
      recipientIds,
      recipientTokens: [],
      trustedRecipientCount,
      nearbyRecipientCount,
    };
  }

  const { data: tokenRows, error: tokensError } = await adminClient
    .from('device_push_tokens')
    .select('user_id,expo_push_token')
    .in('user_id', recipientIds)
    .eq('active', true);

  if (tokensError) {
    throw tokensError;
  }

  const pushTokenRows = (tokenRows ?? []) as {
    user_id: string;
    expo_push_token: string;
  }[];
  const recipientTokensByToken = new Map<string, SOSRecipientToken>();

  for (const row of pushTokenRows) {
    if (!/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(row.expo_push_token)) {
      continue;
    }

    const recipient = recipientById.get(row.user_id);
    if (!recipient) {
      continue;
    }

    recipientTokensByToken.set(row.expo_push_token, {
      token: row.expo_push_token,
      isTrusted: recipient.is_trusted,
      isNearby: recipient.is_nearby,
    });
  }

  const recipientTokens = [...recipientTokensByToken.values()];

  console.log('[send-sos-push] Token destinatari verificati.', {
    recipientCount: recipientIds.length,
    trustedRecipientCount,
    nearbyRecipientCount,
    activeTokenRowCount: pushTokenRows.length,
    validUniqueTokenCount: recipientTokens.length,
    discardedTokenCount: pushTokenRows.length - recipientTokens.length,
  });

  return {
    recipientIds,
    recipientTokens,
    trustedRecipientCount,
    nearbyRecipientCount,
  };
}
