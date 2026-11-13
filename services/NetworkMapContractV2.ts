import { isNetworkCategoryIdV2, type NetworkCategoryIdV2 } from './NetworkCategoryRegistryV2';

/** DTO draft only. No services, UI, backend adapters or legacy models are changed. */
export const NETWORK_MAP_SCHEMA_VERSION_V2 = 2 as const;

/** Server-derived representation of the EVENT, never author/device location or GPS accuracy.
 * generalizationMeters describes policy resolution, NOT an anonymity guarantee/error radius.
 * Type/shape validation cannot prove the server actually applied that policy.
 */
export type NetworkPublicPositionV2 = Readonly<{
  latitude: number;
  longitude: number;
  generalizationMeters: number;
  representation: 'GENERALIZED_EVENT_POINT' | 'ZONE_REPRESENTATIVE_POINT';
}>;

type MarkerBaseV2 = Readonly<{
  schemaVersion: typeof NETWORK_MAP_SCHEMA_VERSION_V2;
  publicId: string;
  territoryId: string;
  zoneId: string;
  categoryId: NetworkCategoryIdV2;
  locationPolicyVersion: string;
  revision: number;
  validUntil: string;
}>;

export type NetworkOperationalMarkerV2 = MarkerBaseV2 & Readonly<{
  kind: 'OPERATIONAL_EVENT';
  publicPosition: NetworkPublicPositionV2 & { readonly representation: 'GENERALIZED_EVENT_POINT' };
  createdAt: string;
  updatedAt: string;
}> & (
  | Readonly<{ status: 'ACTIVE'; resolvedAt: null }>
  | Readonly<{ status: 'RESOLVED'; resolvedAt: string }>
);

export type NetworkHistoryMarkerV2 = MarkerBaseV2 & Readonly<{
  kind: 'REVIEWED_HISTORY';
  status: 'CONCLUDED';
  publicPosition: NetworkPublicPositionV2 & { readonly representation: 'ZONE_REPRESENTATIVE_POINT' };
  period: Readonly<{ startMonth: string; endMonthExclusive: string }>;
}>;

export type NetworkMarkerV2 = NetworkOperationalMarkerV2 | NetworkHistoryMarkerV2;

export type NetworkOperationalUpdateV2 = Readonly<{
  publicId: string;
  body: string;
  createdAt: string;
  authorRole: 'AUTHOR'; // Existing NETWORK permits author updates, not public comments.
}>;

export type NetworkOperationalDetailV2 = Readonly<{
  marker: NetworkOperationalMarkerV2;
  description: string;
  authorNickname: string;
  confirmations: Readonly<{
    confirmedCount: number;
    noLongerPresentCount: number;
    myConfirmation: 'CONFIRMED' | 'NO_LONGER_PRESENT' | null;
  }>;
  updates: readonly NetworkOperationalUpdateV2[];
}>;

export type NetworkHistoryDetailV2 = Readonly<{
  marker: NetworkHistoryMarkerV2;
  summary: string;
}>;

// Exact own-field allowlists, including nested objects: reject, do not silently coerce.
// No serializer is exported. TypeScript structural assignment alone is NOT a privacy boundary.
// Intended for decoded JSON; these guards do not detect personal data inside free text,
// prove publication authorization, enforce retention, or decide whether a record is fresh.
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && keys.includes(key) && descriptor?.enumerable === true &&
      Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
};
const jsonArray = (value: unknown): value is readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
  }
  return true;
};
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;
const integer = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const instant = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const month = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-01$/.test(value) && instant(`${value}T00:00:00.000Z`);

const position = (value: unknown, representation: NetworkPublicPositionV2['representation']) =>
  exact(value, ['latitude', 'longitude', 'generalizationMeters', 'representation']) &&
  typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
  typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 &&
  typeof value.generalizationMeters === 'number' && Number.isFinite(value.generalizationMeters) && value.generalizationMeters > 0 &&
  value.representation === representation;

const baseKeys = ['schemaVersion', 'publicId', 'territoryId', 'zoneId', 'categoryId',
  'locationPolicyVersion', 'revision', 'validUntil', 'kind', 'status', 'publicPosition'] as const;

export const isNetworkMarkerV2 = (value: unknown): value is NetworkMarkerV2 => {
  // Inspect discriminator only after rejecting accessor properties on the entire object.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  const operational = kind === 'OPERATIONAL_EVENT';
  if (!operational && kind !== 'REVIEWED_HISTORY') return false;
  if (!exact(value, [...baseKeys, ...(operational ? ['createdAt', 'updatedAt', 'resolvedAt'] : ['period'])])) return false;
  if (value.schemaVersion !== NETWORK_MAP_SCHEMA_VERSION_V2 || !uuid(value.publicId) ||
    !uuid(value.territoryId) || !uuid(value.zoneId) || !isNetworkCategoryIdV2(value.categoryId) ||
    !text(value.locationPolicyVersion, 1, 80) || !integer(value.revision, 1) || !instant(value.validUntil)) return false;
  if (operational) {
    return position(value.publicPosition, 'GENERALIZED_EVENT_POINT') &&
      instant(value.createdAt) && instant(value.updatedAt) && value.updatedAt >= value.createdAt &&
      ((value.status === 'ACTIVE' && value.resolvedAt === null) ||
        (value.status === 'RESOLVED' && instant(value.resolvedAt) &&
          value.resolvedAt >= value.createdAt && value.resolvedAt <= value.updatedAt));
  }
  return value.status === 'CONCLUDED' && position(value.publicPosition, 'ZONE_REPRESENTATIVE_POINT') &&
    exact(value.period, ['startMonth', 'endMonthExclusive']) && month(value.period.startMonth) &&
    month(value.period.endMonthExclusive) && value.period.endMonthExclusive > value.period.startMonth;
};

export const isNetworkOperationalDetailV2 = (value: unknown): value is NetworkOperationalDetailV2 =>
  exact(value, ['marker', 'description', 'authorNickname', 'confirmations', 'updates']) &&
  isNetworkMarkerV2(value.marker) && value.marker.kind === 'OPERATIONAL_EVENT' &&
  text(value.description, 10, 500) && text(value.authorNickname, 2, 40) &&
  exact(value.confirmations, ['confirmedCount', 'noLongerPresentCount', 'myConfirmation']) &&
  integer(value.confirmations.confirmedCount, 0) && integer(value.confirmations.noLongerPresentCount, 0) &&
  [null, 'CONFIRMED', 'NO_LONGER_PRESENT'].includes(value.confirmations.myConfirmation as string | null) &&
  jsonArray(value.updates) && value.updates.every(update =>
    exact(update, ['publicId', 'body', 'createdAt', 'authorRole']) && uuid(update.publicId) &&
    text(update.body, 2, 300) && instant(update.createdAt) && update.authorRole === 'AUTHOR');

export const isNetworkHistoryDetailV2 = (value: unknown): value is NetworkHistoryDetailV2 =>
  exact(value, ['marker', 'summary']) && isNetworkMarkerV2(value.marker) &&
  value.marker.kind === 'REVIEWED_HISTORY' && text(value.summary, 10, 500);
