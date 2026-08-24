import { createClient } from 'npm:@supabase/supabase-js@2.109.0';

import { getActiveRecipientTokens } from './pushRecipients.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SOS_CHANNEL_ID = 'sos-alerts';

type SOSPushRequest = {
  sosId: string;
};

type SOSRecord = {
  id: string;
  user_id: string;
  device_time: string | null;
  created_at: string;
  status: string;
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoPushError = {
  code?: string;
  message: string;
};

type SOSDispatchClaim =
  | 'claimed'
  | 'already_dispatched'
  | 'rate_limited'
  | 'unavailable';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const isSOSPushRequest = (value: unknown): value is SOSPushRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const body = value as Partial<SOSPushRequest>;

  const isUuid = (input: unknown): input is string =>
    typeof input === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);

  return isUuid(body.sosId);
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!accessToken) {
    return jsonResponse({ error: 'Authentication required.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration missing.' }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(accessToken);

  if (userError || !user) {
    return jsonResponse({ error: 'Invalid authentication.' }, 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  if (!isSOSPushRequest(body)) {
    return jsonResponse({ error: 'Invalid SOS payload.' }, 400);
  }

  try {
    const { data: sosData, error: sosError } = await adminClient
      .from('sos')
      .select('id,user_id,device_time,created_at,status')
      .eq('id', body.sosId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .maybeSingle();

    if (sosError) {
      throw sosError;
    }

    if (!sosData) {
      return jsonResponse({ error: 'SOS not found or not authorized.' }, 404);
    }

    const sos = sosData as SOSRecord;
    const { data: dispatchClaimData, error: dispatchClaimError } = await adminClient.rpc(
      'claim_sos_push_dispatch',
      { target_sos_id: sos.id },
    );

    if (dispatchClaimError) {
      throw dispatchClaimError;
    }

    const dispatchClaim = dispatchClaimData as SOSDispatchClaim;

    if (dispatchClaim !== 'claimed') {
      console.warn('[send-sos-push] Invio non acquisito.', {
        reason: dispatchClaim,
      });
      return jsonResponse({
        sent: 0,
        failed: 0,
        reason: dispatchClaim,
        recipientCount: 0,
        trustedRecipientCount: 0,
        nearbyRecipientCount: 0,
        tokenCount: 0,
      });
    }

    const {
      recipientIds,
      recipientTokens,
      trustedRecipientCount,
      nearbyRecipientCount,
    } = await getActiveRecipientTokens(adminClient, sos.id);
    const tokens = recipientTokens.map((recipient) => recipient.token);
    const { data: senderProfile, error: senderProfileError } = await adminClient
      .from('profiles')
      .select('nickname')
      .eq('id', user.id)
      .maybeSingle();

    if (senderProfileError) {
      console.warn('[send-sos-push] Profilo mittente non disponibile.', {
        category: 'profile_unavailable',
      });
    }

    const trustedSenderDisplayName =
      typeof senderProfile?.nickname === 'string' && senderProfile.nickname.trim()
        ? senderProfile.nickname.trim()
        : 'Un contatto fidato';
    const { data: senderRadarPreferences, error: senderRadarPreferencesError } =
      await adminClient
        .from('radar_preferences')
        .select('show_nickname,public_nickname')
        .eq('user_id', user.id)
        .maybeSingle();

    if (senderRadarPreferencesError) {
      console.warn('[send-sos-push] Preferenze pubbliche mittente non disponibili.', {
        category: 'network_profile_unavailable',
      });
    }

    const nearbySenderDisplayName =
      senderRadarPreferences?.show_nickname === true &&
      typeof senderRadarPreferences.public_nickname === 'string' &&
      senderRadarPreferences.public_nickname.trim()
        ? senderRadarPreferences.public_nickname.trim()
        : 'Un utente SafeMeLink';

    console.log('[send-sos-push] Destinatari risolti.', {
      recipientCount: recipientIds.length,
      trustedRecipientCount,
      nearbyRecipientCount,
      tokenCount: tokens.length,
    });
    console.info('[send-sos-push] SOS_NEARBY_RECIPIENT_COUNT', {
      count: nearbyRecipientCount,
    });
    console.info('[send-sos-push] PUSH_TOKEN_COUNT', {
      count: tokens.length,
    });

    if (tokens.length === 0) {
      const reason =
        recipientIds.length === 0
          ? 'no_eligible_recipients'
          : 'recipients_without_active_tokens';
      console.warn('[send-sos-push] Invio non eseguito.', {
        recipientCount: recipientIds.length,
        trustedRecipientCount,
        nearbyRecipientCount,
        tokenCount: 0,
        reason,
      });
      if (recipientIds.length === 0) {
        console.info('[send-sos-push] SOS_NEARBY_NO_ELIGIBLE_USERS');
      }
      console.info('[send-sos-push] EXPO_TICKET_OK_COUNT', { count: 0 });
      console.info('[send-sos-push] EXPO_TICKET_ERROR_COUNT', { count: 0 });
      console.info('[send-sos-push] PUSH_SENT_COUNT', { count: 0 });
      console.info('[send-sos-push] PUSH_FAILED_COUNT', { count: 0 });
      return jsonResponse({
        sent: 0,
        failed: 0,
        reason,
        recipientCount: recipientIds.length,
        trustedRecipientCount,
        nearbyRecipientCount,
        tokenCount: 0,
      });
    }

    const createdAt = sos.device_time ?? sos.created_at;
    const messages = recipientTokens.map((recipient) => ({
      to: recipient.token,
      title: 'SOS SafeMeLink',
      body: `${
        recipient.isTrusted ? trustedSenderDisplayName : nearbySenderDisplayName
      } ha attivato un SOS e potrebbe aver bisogno di aiuto.`,
      sound: 'default',
      priority: 'high',
      channelId: SOS_CHANNEL_ID,
      data: {
        type: 'sos_alert',
        sosId: sos.id,
        createdAt,
      },
    }));
    const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    const ticketsWithTokens: { ticket: ExpoPushTicket; token: string }[] = [];
    const expoErrors: ExpoPushError[] = [];

    for (let start = 0; start < messages.length; start += 100) {
      const messageBatch = messages.slice(start, start + 100);
      const tokenBatch = tokens.slice(start, start + 100);
      const expoResponse = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(expoAccessToken ? { authorization: `Bearer ${expoAccessToken}` } : {}),
        },
        body: JSON.stringify(messageBatch),
      });

      if (!expoResponse.ok) {
        console.error('[send-sos-push] Expo Push API non disponibile.', {
          batch: start / 100 + 1,
          status: expoResponse.status,
        });
        expoErrors.push({
          code: `HTTP_${expoResponse.status}`,
          message: `Expo Push API ha restituito HTTP ${expoResponse.status}.`,
        });
        continue;
      }

      const result = (await expoResponse.json()) as {
        data?: ExpoPushTicket[];
        errors?: ExpoPushError[];
      };
      const batchTickets = Array.isArray(result.data) ? result.data : [];

      console.log('[send-sos-push] Risposta Expo Push API.', {
        batch: start / 100 + 1,
        httpStatus: expoResponse.status,
        ticketCount: batchTickets.length,
        apiErrorCount: result.errors?.length ?? 0,
      });
      expoErrors.push(...(result.errors ?? []));
      batchTickets.forEach((ticket, index) => {
        if (tokenBatch[index]) {
          ticketsWithTokens.push({ ticket, token: tokenBatch[index] });
        }
      });
    }

    const tickets = ticketsWithTokens.map((item) => item.ticket);
    console.log('[send-sos-push] Ticket Expo.', {
      ok: tickets.filter((ticket) => ticket.status === 'ok').length,
      failed: tickets.filter((ticket) => ticket.status === 'error').length,
      receiptCheckRecommendedAfterMinutes: 15,
    });
    const invalidTokens = ticketsWithTokens
      .filter(
        ({ ticket }) =>
          ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered',
      )
      .map(({ token }) => token);

    if (invalidTokens.length > 0) {
      console.warn('[send-sos-push] Token DeviceNotRegistered rilevati.', {
        count: invalidTokens.length,
      });
      await adminClient
        .from('device_push_tokens')
        .update({ active: false })
        .in('expo_push_token', invalidTokens);
    }

    const ticketErrors = tickets
      .filter((ticket) => ticket.status === 'error')
      .map((ticket) => ({
        code: ticket.details?.error,
        message: ticket.message ?? 'Expo non ha accettato la notifica.',
      }));
    const unprocessedCount = tokens.length - tickets.length;
    const sent = tickets.filter((ticket) => ticket.status === 'ok').length;
    const failed =
      tickets.filter((ticket) => ticket.status === 'error').length + unprocessedCount;
    const expoTicketErrorCount = tickets.filter((ticket) => ticket.status === 'error').length;

    console.info('[send-sos-push] EXPO_TICKET_OK_COUNT', { count: sent });
    console.info('[send-sos-push] EXPO_TICKET_ERROR_COUNT', {
      count: expoTicketErrorCount,
    });
    console.info('[send-sos-push] PUSH_SENT_COUNT', { count: sent });
    console.info('[send-sos-push] PUSH_FAILED_COUNT', { count: failed });

    console.log('[send-sos-push] Invio completato.', {
      recipientCount: recipientIds.length,
      trustedRecipientCount,
      nearbyRecipientCount,
      tokenCount: tokens.length,
      sent,
      failed,
    });

    return jsonResponse({
      sent,
      failed,
      recipientCount: recipientIds.length,
      trustedRecipientCount,
      nearbyRecipientCount,
      tokenCount: tokens.length,
      expoTicketOkCount: sent,
      expoTicketErrorCount,
      errors: [...expoErrors, ...ticketErrors],
    });
  } catch {
    console.error('[send-sos-push] Invio fallito.', { category: 'unclassified_error' });
    return jsonResponse({ error: 'Unable to send SOS push notification.' }, 500);
  }
});
