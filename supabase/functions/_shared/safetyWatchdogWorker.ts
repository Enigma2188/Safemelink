// Private, unscheduled server library. Never imported by the app.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.109.0';
import { getActiveRecipientTokens } from '../send-sos-push/pushRecipients.ts';

type Event = {
  id: string; kind: 'SAFETY_CHECK_DUE' | 'SOS_DISPATCH'; sessionId: string;
  generation: number; mode: string; ownerId: string; sosId: string | null; deadline: string;
};
type Delivery = Event & { deliveryId: string; recipientHash: string };
export async function watchdogRecipientHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
export async function runSafetyWatchdogOutbox(
  db: SupabaseClient, expoAccessToken?: string, transport: typeof fetch = fetch,
): Promise<{ processed: number; accepted: number; uncertain: number }> {
  const totals = { processed: 0, accepted: 0, uncertain: 0 };
  async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await db.rpc(name, args);
    if (result.error) throw new Error('Watchdog database operation failed.');
    return result.data;
  }
  async function resolve(event: Event): Promise<Map<string, string>> {
    let tokens: string[] = [];
    if (event.kind === 'SOS_DISPATCH') {
      if (!event.sosId) throw new Error('SOS unavailable.');
      tokens = (await getActiveRecipientTokens(db, event.sosId)).recipientTokens.map((r) => r.token);
    } else {
      for (let offset = 0; offset < 10000; offset += 1000) {
        const result = await db.from('device_push_tokens').select('expo_push_token')
          .eq('user_id', event.ownerId).eq('active', true).order('id').range(offset, offset + 999);
        if (result.error) throw new Error('Token lookup failed.');
        const rows = result.data ?? [];
        tokens.push(...rows.map((row) => String(row.expo_push_token)));
        if (rows.length < 1000) break;
        if (offset === 9000) throw new Error('Recipient bound exceeded.');
      }
    }
    const unique = [...new Set(tokens)].filter((t) => /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(t));
    return new Map(await Promise.all(unique.map(async (t) => [await watchdogRecipientHash(t), t] as const)));
  }
  // A lost stage response may already have committed; never release that claim.
  for (let index = 0; index < 5; index += 1) {
    const claim = crypto.randomUUID();
    const event = await rpc('claim_safety_watchdog_outbox', { p_claim_id: claim }) as Event | null;
    if (!event) break;
    let sosClaimed = false;
    let staging = false;
    try {
      if (event.kind === 'SOS_DISPATCH') {
        const state = await rpc('claim_sos_push_dispatch', { target_sos_id: event.sosId, requested_claim_id: claim });
        if (state !== 'claimed') {
          await rpc('finish_safety_watchdog_outbox', { p_event_id: event.id, p_claim_id: claim,
            p_action: state === 'already_dispatched' || state === 'unavailable' ? 'obsolete' : state === 'attempt_in_progress' ? 'unknown' : 'release' });
          continue;
        }
        sosClaimed = true;
      }
      const recipients = await resolve(event);
      if (!recipients.size) throw new Error('No devices.');
      staging = true;
      const staged = await rpc('stage_safety_watchdog_deliveries', {
        p_event_id: event.id, p_claim_id: claim, p_hashes: [...recipients.keys()].sort(),
      });
      if (staged !== true) { staging = false; throw new Error('Stage rejected.'); }
    } catch {
      if (!staging) {
        if (sosClaimed) await rpc('release_sos_push_dispatch', { target_sos_id: event.sosId, expected_claim_id: claim });
        await rpc('finish_safety_watchdog_outbox', { p_event_id: event.id, p_claim_id: claim, p_action: 'release' });
      }
    }
  }
  // Durable per-send progress; crash cannot replay accepted or lose pending siblings.
  for (let index = 0; index < 20; index += 1) {
    const claim = crypto.randomUUID();
    const event = await rpc('claim_safety_watchdog_delivery', { p_claim_id: claim }) as Delivery | null;
    if (!event) break;
    totals.processed += 1;
    let attempted = false;
    const finish = (action: string) => rpc('finish_safety_watchdog_delivery', {
      p_delivery_id: event.deliveryId, p_claim_id: claim, p_action: action,
    });
    try {
      // Current authorization and ownership are rechecked, never trust old tokens.
      const token = (await resolve(event)).get(event.recipientHash);
      if (!token) { await finish('obsolete'); continue; }
      if (await finish('attempt') !== true) { await finish('obsolete'); continue; }
      attempted = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await transport('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'content-type': 'application/json',
            ...(expoAccessToken ? { authorization: `Bearer ${expoAccessToken}` } : {}) },
          body: JSON.stringify([{
            to: token, title: event.kind === 'SOS_DISPATCH' ? 'SOS SafeMeLink' : 'Stai bene?',
            body: event.kind === 'SOS_DISPATCH' ? 'È stato attivato un SOS. Apri SafeMeLink.' : 'Apri SafeMeLink per confermare.',
            sound: 'default', priority: 'high', channelId: event.kind === 'SOS_DISPATCH' ? 'sos-alerts' : 'safety-checks',
            data: event.kind === 'SOS_DISPATCH' ? { type: 'sos_alert', sosId: event.sosId }
              : { type: 'safety_check_due', sessionId: event.sessionId, generation: event.generation, mode: event.mode },
          }]), signal: controller.signal,
        });
        const payload = await response.json() as { data?: { status?: string }[] };
        const status = response.ok && payload.data?.length === 1 ? payload.data[0].status : undefined;
        const outcome = status === 'ok' ? 'accepted' : status === 'error' ? 'rejected' : 'unknown';
        if (await finish(outcome) !== true) throw new Error('Acknowledgment uncertain.');
        if (outcome === 'accepted') totals.accepted += 1; // Provider acceptance only.
        if (outcome === 'unknown') totals.uncertain += 1;
      } finally { clearTimeout(timeout); }
    } catch {
      await finish(attempted ? 'unknown' : 'release');
      if (attempted) totals.uncertain += 1;
    }
  }
  await rpc('reconcile_safety_watchdog_deliveries');
  return totals;
}
