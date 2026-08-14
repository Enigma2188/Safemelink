const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SOSNotificationPayload = {
  type: 'sos_alert';
  sosId: string;
};

export const parseSOSNotificationPayload = (
  data: unknown,
): SOSNotificationPayload | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  if (
    (candidate.type !== 'sos_alert' && candidate.type !== 'sos') ||
    typeof candidate.sosId !== 'string' ||
    !UUID_PATTERN.test(candidate.sosId)
  ) {
    return null;
  }

  return {
    type: 'sos_alert',
    sosId: candidate.sosId,
  };
};
