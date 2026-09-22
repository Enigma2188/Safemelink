import { NeighborhoodNetworkRepository } from '@/backend/repositories/NeighborhoodNetworkRepository';
import { AuthService } from '@/backend/auth/AuthService';
import { LocationService } from '@/services/LocationService';

const INVITE_TOKEN_PATTERN = /^NQ-[0-9A-F]{32}$/;

const freshLocationFor = async (userId: string) => {
  const location = await LocationService.getCurrentLocation({ timeoutMs: 15_000, accuracy: 'high' });
  const session = await AuthService.getSession();
  if (!session || session.user.id !== userId) throw new Error('Sessione cambiata. Riprova.');
  if (location.source !== 'fresh' || location.accuracy === null || location.accuracy < 0 || location.accuracy > 100 || !location.observedAt) {
    throw new Error('Posizione troppo imprecisa. Attiva il GPS e riprova.');
  }
  return { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, observedAt: location.observedAt };
};

export const NeighborhoodNetworkService = {
  load: async () => {
    const [networks, invitations, discoveryOptIn] = await Promise.all([
      NeighborhoodNetworkRepository.getOverview(),
      NeighborhoodNetworkRepository.listInvitations(),
      NeighborhoodNetworkRepository.getDiscoveryPreference(),
    ]);
    const network = networks[0] ?? null;
    const members = network
      ? await NeighborhoodNetworkRepository.listMembers(network.network_id)
      : [];
    const discussions = network ? await NeighborhoodNetworkRepository.listDiscussions() : [];
    return { network, members, invitations, discoveryOptIn, discussions };
  },

  async setDiscoveryPreference(userId: string, enabled: boolean) {
    if (!enabled) return NeighborhoodNetworkRepository.setDiscoveryPreference(userId, false);
    const location = await freshLocationFor(userId);
    await NeighborhoodNetworkRepository.setDiscoveryPreference(userId, true);
    await NeighborhoodNetworkRepository.publishDiscoveryPresence(userId, location);
  },

  async refreshDiscoveryPresence(userId: string) {
    const location = await freshLocationFor(userId);
    await NeighborhoodNetworkRepository.publishDiscoveryPresence(userId, location);
  },

  async inviteNearby(userId: string, networkId: string) {
    const location = await freshLocationFor(userId);
    await NeighborhoodNetworkRepository.publishDiscoveryPresence(userId, location, true);
    return NeighborhoodNetworkRepository.inviteNearby(userId, networkId);
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
  listDiscussions: NeighborhoodNetworkRepository.listDiscussions,
  createDiscussion(networkId: string, title: string, category: string) {
    const normalizedTitle = title.trim().replace(/\s+/g, ' ');
    if (normalizedTitle.length < 3 || normalizedTitle.length > 100) {
      throw new Error('Il titolo deve contenere da 3 a 100 caratteri.');
    }
    if (!['Sicurezza', 'Aiuto', 'Informazioni', 'Altro'].includes(category)) {
      throw new Error('Scegli una categoria.');
    }
    return NeighborhoodNetworkRepository.createDiscussion(networkId, normalizedTitle, category);
  },
  listMessages: NeighborhoodNetworkRepository.listMessages,
  createMessage(discussionId: string, body: string) {
    const normalizedBody = body.trim();
    if (normalizedBody.length < 1 || normalizedBody.length > 2000) {
      throw new Error('Il messaggio deve contenere da 1 a 2000 caratteri.');
    }
    return NeighborhoodNetworkRepository.createMessage(discussionId, normalizedBody);
  },
  closeDiscussion: NeighborhoodNetworkRepository.closeDiscussion,
};
