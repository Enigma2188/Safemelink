import { requireOptionalNativeModule } from 'expo-modules-core';
export type VoiceLabSnapshot = { state: 'OFF' | 'PREPARING' | 'LISTENING' | 'STOPPING' | 'ERROR'; reason: string; detections: number; busy: boolean };
export const VoskLab = requireOptionalNativeModule<{
  enabled(): boolean;
  busy(): boolean;
  start(phrase: string): void;
  stop(forget: boolean): void;
  reset(): void;
  snapshot(): VoiceLabSnapshot;
}>('SafeMeLinkVoskLab');
