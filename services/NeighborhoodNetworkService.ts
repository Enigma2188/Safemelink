import { NeighborhoodNetworkRepository } from '@/backend/repositories/NeighborhoodNetworkRepository';

const INVITE_TOKEN_PATTERN = /^NQ-[0-9A-F]{32}$/;

export const NeighborhoodNetworkService = {
  load: async () => {
    const [networks, invitations] = await Promise.all([
      NeighborhoodNetworkRepository.getOverview(),
      NeighborhoodNetworkRepository.listInvitations(),
    ]);
    const network = networks[0] ?? null;
    const members = network
      ? await NeighborhoodNetworkRepository.listMembers(network.network_id)
      : [];
    return { network, members, invitations };
  },

  create(name: string) {
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (normalized.length < 3 || normalized.length > 60) {
      throw new Error('Il nome deve contenere da 3 a 60 caratteri.');
    }
    return NeighborhoodNetworkRepository.createNetwork(normalized);
  },

  generateInviteToken: NeighborhoodNetworkRepository.generateInviteToken,

  invite(networkId: string, inviteToken: string) {
    const normalized = inviteToken.trim().toUpperCase();
    if (!INVITE_TOKEN_PATTERN.test(normalized)) {
      throw new Error('Inserisci il codice temporaneo NQ-… generato dall’altra persona.');
    }
    return NeighborhoodNetworkRepository.invite(networkId, normalized);
  },

  respond: NeighborhoodNetworkRepository.respond,
  cancelInvitation: NeighborhoodNetworkRepository.cancelInvitation,
  removeMember: NeighborhoodNetworkRepository.removeMember,
  leave: NeighborhoodNetworkRepository.leave,
};
