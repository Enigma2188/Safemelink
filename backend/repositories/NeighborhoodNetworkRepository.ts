import type { Database } from '@/backend/database.types';
import { createBackendError } from '@/backend/errors/BackendError';
import { runRemoteRequest } from '@/backend/remoteRequest';
import { requireSupabaseClient } from '@/backend/supabaseClient';

type FunctionRows<Name extends keyof Database['public']['Functions']> =
  Database['public']['Functions'][Name]['Returns'];

const messages = {
  backendUnavailable: 'La Rete di quartiere non è ancora disponibile.',
  unauthenticated: 'Sessione scaduta. Accedi di nuovo.',
  forbidden: 'Non hai i permessi per questa operazione.',
  network: 'Connessione non disponibile. Controlla la rete e riprova.',
  conflict: 'Questa operazione è già stata completata o non è più disponibile.',
} as const;

const request = async <T>(operation: (signal: AbortSignal) => PromiseLike<T>) =>
  runRemoteRequest(
    (signal) => Promise.resolve(operation(signal)),
    'La Rete di quartiere non risponde. Riprova tra poco.',
  );

const fail = (operation: string, fallback: string, cause: unknown) =>
  createBackendError(operation, { ...messages, fallback }, cause);

export const NeighborhoodNetworkRepository = {
  async getOverview(): Promise<FunctionRows<'get_my_neighborhood_overview'>> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('get_my_neighborhood_overview').abortSignal(signal),
    );
    if (error) throw fail('neighborhood.overview', 'Impossibile caricare la rete.', error);
    return data ?? [];
  },

  async listMembers(networkId: string): Promise<FunctionRows<'list_my_neighborhood_members'>> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('list_my_neighborhood_members', { target_network_id: networkId }).abortSignal(signal),
    );
    if (error) throw fail('neighborhood.members', 'Impossibile caricare i membri.', error);
    return data ?? [];
  },

  async listInvitations(): Promise<FunctionRows<'list_my_neighborhood_invitations'>> {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('list_my_neighborhood_invitations').abortSignal(signal),
    );
    if (error) throw fail('neighborhood.invitations', 'Impossibile caricare gli inviti.', error);
    return data ?? [];
  },

  async createNetwork(name: string) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('create_neighborhood_network', { target_name: name }).abortSignal(signal).single(),
    );
    if (error) throw fail('neighborhood.create', 'Impossibile creare la rete.', error);
    return data.network_id;
  },

  async generateInviteToken() {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('generate_my_neighborhood_invite_token').abortSignal(signal).single(),
    );
    if (error) throw fail('neighborhood.generate_token', 'Impossibile generare il codice.', error);
    return data;
  },

  async invite(networkId: string, inviteToken: string) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('create_neighborhood_invitation', {
        target_network_id: networkId,
        target_invite_token: inviteToken,
      }).abortSignal(signal).single(),
    );
    if (error) throw fail('neighborhood.invite', 'Impossibile inviare l’invito.', error);
    if (!data.invitation_created) throw new Error('Impossibile inviare l’invito.');
  },

  async respond(invitationId: string, accept: boolean) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('respond_to_neighborhood_invitation', {
        target_invitation_id: invitationId,
        accept_invitation: accept,
      }).abortSignal(signal).single(),
    );
    if (error) throw fail('neighborhood.respond', 'Impossibile aggiornare l’invito.', error);
    const expectedStatus = accept ? 'accepted' : 'declined';
    if (data.invitation_status !== expectedStatus) {
      throw new Error(
        data.invitation_status === 'expired'
          ? 'Questo invito è scaduto.'
          : 'Impossibile aggiornare l’invito.',
      );
    }
  },

  async cancelInvitation(invitationId: string) {
    const client = requireSupabaseClient();
    const { data, error } = await request((signal) =>
      client.rpc('cancel_neighborhood_invitation', { target_invitation_id: invitationId }).abortSignal(signal),
    );
    if (error) throw fail('neighborhood.cancel_invitation', 'Impossibile annullare l’invito.', error);
    if (data !== 'cancelled') throw new Error('L’invito non è più annullabile.');
  },

  async removeMember(networkId: string, membershipId: string) {
    const client = requireSupabaseClient();
    const { error } = await request((signal) =>
      client.rpc('remove_neighborhood_member', {
        target_network_id: networkId,
        target_membership_id: membershipId,
      }).abortSignal(signal),
    );
    if (error) throw fail('neighborhood.remove_member', 'Impossibile rimuovere il membro.', error);
  },

  async leave(networkId: string) {
    const client = requireSupabaseClient();
    const { error } = await request((signal) =>
      client.rpc('leave_neighborhood_network', { target_network_id: networkId }).abortSignal(signal),
    );
    if (error) throw fail('neighborhood.leave', 'Impossibile lasciare la rete.', error);
  },
};
