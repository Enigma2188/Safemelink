import { createClient } from 'npm:@supabase/supabase-js@2.109.0';

import { getActiveRecipientTokens } from '../_shared/pushRecipients.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SOS_CHANNEL_ID = 'safemelink-sos';

type SOSPushRequest = {
  sosId: string;
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
  message?: string;
  details?: { error?: string };
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

  return typeof body.sosId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sosId);
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
    const tokens = await getActiveRecipientTokens(adminClient, user.id);

    if (tokens.length === 0) {
      return jsonResponse({ sent: 0, failed: 0, reason: 'no_active_recipients' });
    }

    const createdAt = sos.device_time ?? sos.created_at;
    const mapsUrl = `https://maps.google.com/?q=${sos.latitude},${sos.longitude}`;
    const messages = tokens.map((token) => ({
      to: token,
      title: 'SOS SafeMeLink',
      body: 'Un tuo contatto fidato ha attivato un SOS.',
      sound: 'default',
      priority: 'high',
      channelId: SOS_CHANNEL_ID,
      data: {
        type: 'sos',
        senderUserId: user.id,
        sosId: sos.id,
        createdAt,
        latitude: sos.latitude,
        longitude: sos.longitude,
        mapsUrl,
      },
    }));
    const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    const expoResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(expoAccessToken ? { authorization: `Bearer ${expoAccessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });

    if (!expoResponse.ok) {
      throw new Error(`Expo Push API returned HTTP ${expoResponse.status}.`);
    }

    const result = (await expoResponse.json()) as { data?: ExpoPushTicket[] };
    const tickets = Array.isArray(result.data) ? result.data : [];
    const invalidTokens = tickets.reduce<string[]>((items, ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        return [...items, tokens[index]];
      }

      return items;
    }, []);

    if (invalidTokens.length > 0) {
      await adminClient
        .from('device_push_tokens')
        .update({ active: false })
        .in('expo_push_token', invalidTokens);
    }

    return jsonResponse({
      sent: tickets.filter((ticket) => ticket.status === 'ok').length,
      failed: tickets.filter((ticket) => ticket.status === 'error').length,
    });
  } catch (error) {
    console.error('send-sos-push failed', error);
    return jsonResponse({ error: 'Unable to send SOS push notification.' }, 500);
  }
});
