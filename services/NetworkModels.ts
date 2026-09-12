import type {
  Json,
  NetworkConfirmationKind,
  NetworkReportCategory,
  NetworkReportStatus,
} from '@/backend/database.types';

export const NETWORK_FEED_RADIUS_METERS = 5_000;
export const NETWORK_PAGE_SIZE = 20;

export type NetworkRestrictionStatus =
  | 'NONE'
  | 'READ_ONLY'
  | 'PUBLISH_BLOCKED'
  | 'INTERACTIONS_BLOCKED'
  | 'FULL_NETWORK_BLOCKED';

export type NetworkOnboardingStatus = {
  emailVerified: boolean;
  nicknamePresent: boolean;
  phoneVerified: boolean;
  currentTermsVersion: string;
  acceptedTermsVersion: string | null;
  termsAccepted: boolean;
  eligible: boolean;
  restrictionStatus: NetworkRestrictionStatus;
  nickname: string | null;
};

export type NetworkPhoneChallenge = {
  userId: string;
  challengeId: string;
  operationId?: string;
  expiresAt: string;
  resendAvailableAt: string;
};

export type NetworkPhoneVerificationStatus =
  | { status: 'not_verified' | 'delivery_pending' | 'expired' | 'verified' | 'already_verified' }
  | ({ status: 'code_requested' } & NetworkPhoneChallenge);

export type NetworkPhoneVerificationErrorCode =
  | 'invalid_phone'
  | 'account_changed'
  | 'timeout'
  | 'rate_limit'
  | 'invalid_code'
  | 'expired'
  | 'provider_not_configured'
  | 'unavailable';

export class NetworkPhoneVerificationError extends Error {
  constructor(
    readonly code: NetworkPhoneVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkPhoneVerificationError';
  }
}

export const NETWORK_CATEGORIES: readonly {
  value: NetworkReportCategory;
  label: string;
}[] = [
  { value: 'SUSPICIOUS_ACTIVITY', label: 'Attività sospetta' },
  { value: 'DISTURBANCE_OR_DANGER', label: 'Disturbo o situazione di pericolo' },
  { value: 'UNSAFE_AREA', label: 'Zona poco sicura' },
  { value: 'URBAN_HAZARD', label: 'Pericolo urbano' },
  { value: 'OTHER_SAFETY', label: 'Altro problema di sicurezza' },
];

export type NetworkReportUpdate = {
  id: string;
  body: string;
  createdAt: string;
};

export type NetworkFeedReport = {
  id: string;
  status: NetworkReportStatus;
  category: NetworkReportCategory;
  description: string;
  authorNickname: string;
  publicArea: string;
  distanceBucketMeters: number;
  createdAt: string;
  expiresAt: string;
  confirmationCount: number;
  noLongerPresentCount: number;
  myConfirmation: NetworkConfirmationKind | null;
};

export type NetworkReportDetail = Omit<NetworkFeedReport, 'distanceBucketMeters'> & {
  updates: NetworkReportUpdate[];
};

export type NetworkFeedCursor = {
  statusBucket: 0 | 1;
  createdAt: string;
  reportId: string;
};

export const getNetworkCategoryLabel = (category: NetworkReportCategory) =>
  NETWORK_CATEGORIES.find((item) => item.value === category)?.label ??
  'Segnalazione di sicurezza';

export const parseNetworkUpdates = (value: Json): NetworkReportUpdate[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object') {
      return [];
    }
    const id = candidate.id;
    const body = candidate.body;
    const createdAt = candidate.createdAt;
    return typeof id === 'string' && typeof body === 'string' && typeof createdAt === 'string'
      ? [{ id, body, createdAt }]
      : [];
  });
};

export const getNetworkFeedCursor = (
  report: NetworkFeedReport,
): NetworkFeedCursor => ({
  statusBucket: report.status === 'ACTIVE' ? 0 : 1,
  createdAt: report.createdAt,
  reportId: report.id,
});
