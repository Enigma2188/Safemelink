import { NetworkV2Error, createNetworkV2SupabaseTransport, type NetworkV2RpcClient } from '@/backend/repositories/NetworkV2Repository';
import { NetworkV2ScreenController, type NetworkV2AccessContext } from '@/components/network/NetworkV2ScreenController';
import { NetworkSocialController } from '@/components/network/NetworkSocialController';
import type { NetworkMapRegion } from '@/components/network/NetworkMap.types';
import { NetworkWriteRecovery, type NetworkJournalStorage } from './NetworkWriteRecovery';

/** No global client, account, region, secret or navigation import. Default OFF. */
export function createNetworkV2Composition(options: { enabled?: boolean; client: NetworkV2RpcClient; access: NetworkV2AccessContext;
  createOperationId: () => string; initialRegion: NetworkMapRegion; storage?: NetworkJournalStorage }) {
  if (options.enabled !== true) return null;
  const transport = createNetworkV2SupabaseTransport(options.client);
  const recovery = options.storage ? new NetworkWriteRecovery(transport, options.storage,
    { getOwner: () => options.access.getOwner?.() ?? null, subscribe: listener => options.access.subscribe(listener) },
    () => { runtime.recoverySettled(); social.recoverySettled(); }) : null;
  const guarded = recovery?.transport ?? transport;
  const runtime = new NetworkV2ScreenController(guarded, options.access, options.createOperationId, options.initialRegion);
  const social = new NetworkSocialController(guarded, options.access, options.createOperationId);
  return Object.freeze({ runtime, social, recovery, start: () => { recovery?.start(); runtime.start(); social.start(); },
    stop: () => { recovery?.stop(); social.stop(); runtime.stop(); }, dispose: () => { recovery?.stop(); social.dispose(); runtime.dispose(); } });
}
export type NetworkV2Composition = NonNullable<ReturnType<typeof createNetworkV2Composition>>;

export type NetworkV2AuthClient = { auth: {
  getSession(): PromiseLike<{ data: { session: { user: { id: string }; access_token?: string } | null }; error: unknown }>;
  onAuthStateChange(listener: (event: string, session: { user: { id: string }; access_token?: string } | null) => void): { data: { subscription: { unsubscribe(): void } } };
} };
/** Local session is a UI context, NOT proof of server authorization. Every RPC verifies auth.uid(). */
export function createNetworkV2AuthAccess(client: NetworkV2AuthClient) {
  let key: string | null = null, owner: string | null = null, epoch = 0, generation = 0, lifecycle = 0, active = false;
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const change = (session: { user: { id: string } } | null, event?: string) => {
    // A normal token renewal for the SAME identity must not erase UNKNOWN writes.
    // Server authorization remains mandatory on every request; no token is cached here.
    if (['TOKEN_REFRESHED', 'SIGNED_IN', 'INITIAL_SESSION'].includes(event ?? '') && key && owner && session?.user.id === owner) return;
    owner = session?.user.id ?? null;
    key = session?.user.id ? `network-auth-epoch-${++epoch}` : null;
    for (const listener of [...listeners]) { try { listener(); } catch { /* No auth logs. */ } }
  };
  return {
    getKey: () => key,
    getOwner: () => owner,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async start() {
      if (active) return; active = true; const initial = ++generation, life = ++lifecycle;
      try { subscription = client.auth.onAuthStateChange((event, session) => { if (active && life === lifecycle) { ++generation; change(session, event); } }).data.subscription; }
      catch { active = false; change(null); return; }
      try { const result = await client.auth.getSession(); if (active && generation === initial) change(result.error ? null : result.data.session); }
      catch { if (active && generation === initial) change(null); }
    },
    stop() { active = false; ++generation; ++lifecycle; try { subscription?.unsubscribe(); } catch { /* Auth state still clears. */ }
      subscription = null; change(null); },
  };
}

/** Ready for a real injected SDK client. Neither Auth nor RPC starts while the feature gate is OFF. */
export function createNetworkV2AppComposition(options: { enabled?: boolean; client: NetworkV2RpcClient & NetworkV2AuthClient;
  createOperationId: () => string; initialRegion: NetworkMapRegion; storage?: NetworkJournalStorage }): NetworkV2Composition | null {
  if (options.enabled !== true) return null;
  const access = createNetworkV2AuthAccess(options.client);
  const boundClient: NetworkV2RpcClient = { rpc: (name,args) => ({ abortSignal: async signal => {
    const key = access.getKey(), owner = access.getOwner();
    if (!key || !owner || signal.aborted) throw new NetworkV2Error('STALE_CONTEXT');
    const result = await options.client.auth.getSession();
    if (result.error || result.data.session?.user.id !== owner || !result.data.session.access_token || access.getKey() !== key || signal.aborted) throw new NetworkV2Error('STALE_CONTEXT');
    const request = options.client.rpc(name,args);
    if (!request.setHeader) throw new NetworkV2Error('ACCESS_DENIED');
    // Installed SDK fetchWithAuth preserves an explicit Authorization header. A later
    // account switch cannot silently send this operation with the new user's JWT.
    return await request.setHeader('Authorization', `Bearer ${result.data.session.access_token}`).abortSignal(signal);
  } }) };
  const composition = createNetworkV2Composition({ ...options, client: boundClient, access });
  if (!composition) return null;
  let disposed = false;
  return Object.freeze({ runtime: composition.runtime, social: composition.social, recovery: composition.recovery,
    start: () => { if (!disposed) { composition.start(); void access.start(); } },
    stop: () => { composition.stop(); access.stop(); },
    dispose: () => { disposed = true; composition.dispose(); access.stop(); } });
}
