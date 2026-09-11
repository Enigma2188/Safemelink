const TRUSTED_IP_HEADERS = new Set([
  'cf-connecting-ip',
  'x-real-ip',
  'x-forwarded-for',
]);

export const getTrustedClientIp = (request: Request, configuredHeader: string | undefined) => {
  const header = configuredHeader?.trim().toLowerCase();
  if (!header || !TRUSTED_IP_HEADERS.has(header)) return null;

  const rawValue = request.headers.get(header);
  const candidate = header === 'x-forwarded-for'
    ? rawValue?.split(',', 1)[0]?.trim()
    : rawValue?.trim();
  return candidate && candidate.length <= 64 && /^[0-9a-f:.]+$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
};
