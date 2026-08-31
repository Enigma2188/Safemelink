import { requireOptionalNativeModule } from 'expo-modules-core';

type SafeMeLinkSmsNativeModule = {
  sendSms(phone: string, message: string): Promise<void>;
};

export const SafeMeLinkSms =
  requireOptionalNativeModule<SafeMeLinkSmsNativeModule>('SafeMeLinkSms');
