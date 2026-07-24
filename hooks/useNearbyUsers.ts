import { useRadar, type RadarViewStatus } from '@/components/RadarProvider';

export type { RadarViewStatus };

export function useNearbyUsers() {
  return useRadar();
}
