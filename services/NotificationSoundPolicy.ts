import { parseSOSNotificationPayload } from '@/services/SOSNotificationPayload';

export const requiresNotificationAttention = (data: unknown): boolean => {
  if (parseSOSNotificationPayload(data)) return true;
  if (!data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>).type === 'safety_check';
};
