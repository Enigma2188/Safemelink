const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export const normalizePhoneDisplay = (phone: string) => phone.trim();

export const canonicalizeInternationalPhone = (phone: string | null | undefined) => {
  if (!phone) {
    return null;
  }

  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  const candidate = trimmed.startsWith('+')
    ? `+${digits}`
    : trimmed.startsWith('00')
      ? `+${digits.slice(2)}`
      : null;

  return candidate && E164_PATTERN.test(candidate) ? candidate : null;
};

export const isValidE164Phone = (phone: string | null | undefined) =>
  Boolean(phone && E164_PATTERN.test(phone));

export const getPhoneIdentityKey = (
  phone: string | null | undefined,
  phoneE164?: string | null,
) => canonicalizeInternationalPhone(phoneE164) ?? canonicalizeInternationalPhone(phone);
