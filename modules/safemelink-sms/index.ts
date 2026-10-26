import { requireOptionalNativeModule } from 'expo-modules-core';

export type SosSmsNativeResult = {
  attemptId: string;
  status: 'sent' | 'failed' | 'unknown';
  reason: string;
  requested: boolean;
  delivery: 'not_verified';
};

type SafeMeLinkSmsNativeModule = {
  sendSms(phone: string, message: string): Promise<void>;
  sendSosSmsWithResult(phone: string, message: string): Promise<SosSmsNativeResult>;
};

export const SafeMeLinkSms =
  requireOptionalNativeModule<SafeMeLinkSmsNativeModule>('SafeMeLinkSms');
