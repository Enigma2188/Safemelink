import { requireOptionalNativeModule } from 'expo-modules-core';

export const SafeMeLinkSafety = requireOptionalNativeModule<{
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): Promise<void>;
  prepareDeadlines(userId: string, kind: string, sessionId: string, expiresAt: number, escalationAt: number): string;
  recoverDeadlines(userId: string, kind: string, sessionId: string, expiresAt: number, escalationAt: number, generation: string | null): string | null;
  armDeadlines(generation: string, channelId: string): Promise<boolean>;
  cancelDeadlines(userId: string, kind: string | null, sessionId: string | null): void;
  claimEscalation(userId: string, sessionId: string, generation: string): boolean;
  escalationState(userId: string, sessionId: string, generation: string): string;
  operationId(userId: string, sessionId: string, generation: string): string;
  releaseEscalation(userId: string, sessionId: string, generation: string): void;
  finishDeadlines(userId: string, sessionId: string, generation: string): void;
  rollbackDeadlines(userId: string, sessionId: string, generation: string): boolean;
  isCurrentDeadline(userId: string, sessionId: string, generation: string): boolean;
}>('SafeMeLinkSafety');
