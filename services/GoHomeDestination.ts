import type { DestinationCandidate } from '@/services/DestinationAddressService';

// Ephemeral selection, not an address book or a replacement for current GPS.
let selection: { userId: string; destination: DestinationCandidate & { savedAt: string } } | null = null;
export const GoHomeDestination = {
  set(userId: string, destination: DestinationCandidate) { selection = { userId, destination: { ...destination, savedAt: new Date().toISOString() } }; },
  get(userId: string) { return selection?.userId === userId ? selection.destination : null; },
  clear() { selection = null; },
};
