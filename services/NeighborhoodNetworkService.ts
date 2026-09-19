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
    return { network, members, invitations, discoveryOptIn };
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
};
