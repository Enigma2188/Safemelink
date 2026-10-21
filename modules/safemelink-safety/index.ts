import { requireOptionalNativeModule } from 'expo-modules-core';

export type CheckpointNotificationDiagnostic = {
  notificationsEnabled: boolean | null;
  channelExistedBefore: boolean | null;
  channelExists: boolean | null;
  importance: number | null;
  sound: 'unknown' | 'none' | 'default' | 'custom' | 'not_applicable';
  notifyAttempted: boolean;
  notifyOutcome: 'not_requested' | 'requested' | 'rejected';
  errorCategory: string | null;
  errorCode: string | null;
};

export const SafeMeLinkSafety = requireOptionalNativeModule<{
  testCheckpointNotification(): Promise<CheckpointNotificationDiagnostic>;
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
  getCheckpointNoticeFailure(userId: string): string | null;
  acknowledgeCheckpointNoticeFailure(userId: string, generation: string): boolean;
  addListener(event: 'onCheckpointNoticeFailed', listener: () => void): { remove(): void };
}>('SafeMeLinkSafety');
