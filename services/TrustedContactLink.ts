export function parseTrustedContactToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toUpperCase();
  return /^SML-[0-9A-F]{8}$/.test(token) ? token : null;
}

export function trustedContactUrl(token: string): string {
  const valid = parseTrustedContactToken(token);
  return valid ? `safemelink://connect?token=${encodeURIComponent(valid)}` : '';
}
