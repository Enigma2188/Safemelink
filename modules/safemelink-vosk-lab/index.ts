import { requireOptionalNativeModule } from 'expo-modules-core';
export type VoiceLabSnapshot = {
  state: 'OFF' | 'PREPARING' | 'LISTENING' | 'STOPPING' | 'ERROR';
  reason: string; detections: number; busy: boolean;
  audioLevel: number; audioPeak: number; gainRequested: boolean; gainActive: boolean;
};
export const VoskLab = requireOptionalNativeModule<{
  enabled(): boolean;
  busy(): boolean;
  start(phrase: string, automaticGain: boolean): void;
  stop(forget: boolean): void;
  reset(): void;
  snapshot(): VoiceLabSnapshot;
}>('SafeMeLinkVoskLab');
