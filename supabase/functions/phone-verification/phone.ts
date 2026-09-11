const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export const normalizeE164Phone = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  const candidate = trimmed.startsWith('+')
    ? `+${digits}`
    : trimmed.startsWith('00')
      ? `+${digits.slice(2)}`
      : null;
  return candidate && E164_PATTERN.test(candidate) ? candidate : null;
};

export const isValidE164Phone = (value: string) => E164_PATTERN.test(value);
