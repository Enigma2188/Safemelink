import { createClient } from 'npm:@supabase/supabase-js@2.109.0';

import { getActiveRecipientTokens } from '../_shared/pushRecipients.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SOS_CHANNEL_ID = 'sos-alerts';

type SOSPushRequest = {
  sosId: string;
  senderUserId: string;
  latitude: number;
  longitude: number;
};

type SOSRecord = {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
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

  return (
    isUuid(body.sosId) &&
    isUuid(body.senderUserId) &&
    typeof body.latitude === 'number' &&
    Number.isFinite(body.latitude) &&
    body.latitude >= -90 &&
    body.latitude <= 90 &&
    typeof body.longitude === 'number' &&
    Number.isFinite(body.longitude) &&
    body.longitude >= -180 &&
    body.longitude <= 180
  );
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

  if (body.senderUserId !== user.id) {
    return jsonResponse({ error: 'Sender does not match authenticated user.' }, 403);
  }

  try {
    const { data: sosData, error: sosError } = await adminClient
      .from('sos')
      .select('id,user_id,latitude,longitude,device_time,created_at,status')
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
    const coordinatesMatch =
      Math.abs(sos.latitude - body.latitude) < 0.0000001 &&
      Math.abs(sos.longitude - body.longitude) < 0.0000001;

    if (!coordinatesMatch) {
      return jsonResponse({ error: 'SOS coordinates do not match stored event.' }, 400);
    }

    const { recipientIds, tokens } = await getActiveRecipientTokens(adminClient, user.id);
    const { data: senderProfile, error: senderProfileError } = await adminClient
      .from('profiles')
      .select('nickname')
      .eq('id', user.id)
      .maybeSingle();

    if (senderProfileError) {
      console.warn('[send-sos-push] Profilo mittente non disponibile.', senderProfileError);
    }

    const senderDisplayName =
      typeof senderProfile?.nickname === 'string' && senderProfile.nickname.trim()
        ? senderProfile.nickname.trim()
        : 'Un contatto fidato';

    console.log('[send-sos-push] Destinatari risolti.', {
      sosId: sos.id,
      senderUserId: user.id,
      recipientCount: recipientIds.length,
      tokenCount: tokens.length,
    });

    if (tokens.length === 0) {
      const reason =
        recipientIds.length === 0
          ? 'no_linked_recipients'
          : 'recipients_without_active_tokens';
      console.warn('[send-sos-push] Invio non eseguito.', {
        sosId: sos.id,
        recipientCount: recipientIds.length,
        tokenCount: 0,
        reason,
      });
      return jsonResponse({
        sent: 0,
        failed: 0,
        reason,
        recipientCount: recipientIds.length,
        tokenCount: 0,
      });
    }

    const createdAt = sos.device_time ?? sos.created_at;
    const messages = tokens.map((token) => ({
      to: token,
      title: 'SOS SafeMeLink',
      body: `${senderDisplayName} ha attivato un SOS e potrebbe aver bisogno di aiuto.`,
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
    const ticketIds = tickets
      .map((ticket) => ticket.id)
      .filter((ticketId): ticketId is string => typeof ticketId === 'string');
    console.log('[send-sos-push] Ticket Expo.', {
      ok: tickets.filter((ticket) => ticket.status === 'ok').length,
      failed: tickets.filter((ticket) => ticket.status === 'error').length,
      ticketIds,
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

    console.log('[send-sos-push] Invio completato.', {
      sosId: sos.id,
      recipientCount: recipientIds.length,
      tokenCount: tokens.length,
      sent,
      failed,
    });

    return jsonResponse({
      sent,
      failed,
      recipientCount: recipientIds.length,
      tokenCount: tokens.length,
      errors: [...expoErrors, ...ticketErrors],
    });
  } catch (error) {
    console.error('send-sos-push failed', error);
    return jsonResponse({ error: 'Unable to send SOS push notification.' }, 500);
  }
});
