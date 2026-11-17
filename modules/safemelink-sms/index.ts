import { requireOptionalNativeModule } from 'expo-modules-core';

export type SosSmsNativeResult = {
  attemptId: string;
  status: 'sent' | 'failed' | 'unknown';
  reason: string;
  requested: boolean;
  delivery: 'not_verified';
};

export type SmsDeviceState = {
  sdk: number;
  messagingSupported: boolean;
  permissionGranted: boolean;
  requestPreviouslyMade: boolean;
  shouldShowRationale: boolean | null;
  readiness: 'ready' | 'default_sim_missing' | 'sim_absent' | 'sim_not_ready' | 'telephony_unavailable' | 'unknown';
};

type SafeMeLinkSmsNativeModule = {
  // Optional during an update from an APK containing the older native bridge.
  getDeviceState?(): Promise<SmsDeviceState>;
  notePermissionRequest?(): Promise<void>;
  sendSms(phone: string, message: string): Promise<void>;
  sendSosSmsWithResult(phone: string, message: string): Promise<SosSmsNativeResult>;
};

export const SafeMeLinkSms =
  requireOptionalNativeModule<SafeMeLinkSmsNativeModule>('SafeMeLinkSms');
