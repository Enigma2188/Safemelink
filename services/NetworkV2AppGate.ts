/** Release switch, not authorization. Server gates, terms and policy checks still apply. */
export const networkV2Enabled = (value: unknown): boolean => value === 'true';

/** No weak entropy fallback: unavailable secure entropy blocks writes, not reading. */
export function createNetworkV2OperationId(fillRandomValues: (bytes: Uint8Array) => void = bytes => {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure operation identifiers unavailable');
  globalThis.crypto.getRandomValues(bytes);
}): string {
  const bytes = new Uint8Array(16);
  fillRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
