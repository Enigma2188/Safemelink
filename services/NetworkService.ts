import type { NetworkConfirmationKind, NetworkReportCategory } from '@/backend/database.types';
import { NetworkRepository } from '@/backend/repositories/NetworkRepository';
import { LocationService } from '@/services/LocationService';
import {
  getNetworkFeedCursor,
  NETWORK_FEED_RADIUS_METERS,
  NETWORK_PAGE_SIZE,
  parseNetworkUpdates,
  type NetworkFeedCursor,
  type NetworkFeedReport,
  type NetworkOnboardingStatus,
  type NetworkPhoneChallenge,
  type NetworkReportDetail,
} from '@/services/NetworkModels';

const normalizeFeed = (
  rows: Awaited<ReturnType<typeof NetworkRepository.listFeed>>,
): NetworkFeedReport[] => rows.map((row) => ({
  id: row.report_id,
  status: row.report_status,
  category: row.category,
  description: row.description,
  authorNickname: row.author_nickname,
  publicArea: row.public_area,
  distanceBucketMeters: Math.max(0, row.distance_bucket_meters),
  createdAt: row.report_created_at,
  expiresAt: row.report_expires_at,
  confirmationCount: Math.max(0, row.confirmation_count),
  noLongerPresentCount: Math.max(0, row.no_longer_present_count),
  myConfirmation: row.my_confirmation,
}));

export const NetworkService = {
  async getMyNetworkOnboardingStatus(): Promise<NetworkOnboardingStatus> {
    const row = await NetworkRepository.getOnboardingStatus();
    return {
      emailVerified: row.email_verified,
      nicknamePresent: row.nickname_present,
      phoneVerified: row.phone_verified,
      currentTermsVersion: row.current_terms_version,
      acceptedTermsVersion: row.accepted_terms_version,
      termsAccepted: row.terms_accepted,
      eligible: row.eligible,
      restrictionStatus: row.restriction_status,
      nickname: row.nickname,
    };
  },

  acceptCurrentTerms(status: NetworkOnboardingStatus) {
    return NetworkRepository.acceptTerms(status.currentTermsVersion, NETWORK_FEED_RADIUS_METERS);
  },

  startPhoneVerification(phone: string): Promise<NetworkPhoneChallenge> {
    return NetworkRepository.startPhoneVerification(phone.trim());
  },

  completePhoneVerification(challenge: NetworkPhoneChallenge, code: string) {
    return NetworkRepository.completePhoneVerification({ ...challenge, code: code.trim() });
  },

  async recoverPhoneVerification() {
    return NetworkRepository.getPhoneVerificationStatus();
  },

  cancelPhoneVerification(challenge: NetworkPhoneChallenge) {
    return NetworkRepository.cancelPhoneVerification(challenge.userId, challenge.challengeId);
  },

  async loadFeed(cursor?: NetworkFeedCursor | null) {
    const location = await LocationService.getCurrentLocation({
      timeoutMs: 15_000,
      accuracy: 'balanced',
    });
    const reports = normalizeFeed(await NetworkRepository.listFeed({
      latitude: location.latitude,
      longitude: location.longitude,
      radiusMeters: NETWORK_FEED_RADIUS_METERS,
      pageSize: NETWORK_PAGE_SIZE,
      cursor,
    }));
    return {
      reports,
      nextCursor: reports.length === NETWORK_PAGE_SIZE
        ? getNetworkFeedCursor(reports[reports.length - 1])
        : null,
    };
  },

  async createReport(category: NetworkReportCategory, description: string) {
    const location = await LocationService.getCurrentLocation({
      timeoutMs: 15_000,
      accuracy: 'high',
    });
    return NetworkRepository.createReport({
      category,
      description: description.trim(),
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
    });
  },

  async getReport(reportId: string): Promise<NetworkReportDetail | null> {
    const row = await NetworkRepository.getReport(reportId);
    if (!row) return null;
    return {
      id: row.report_id,
      status: row.report_status,
      category: row.category,
      description: row.description,
      authorNickname: row.author_nickname,
      publicArea: row.public_area,
      createdAt: row.report_created_at,
      expiresAt: row.report_expires_at,
      confirmationCount: Math.max(0, row.confirmation_count),
      noLongerPresentCount: Math.max(0, row.no_longer_present_count),
      myConfirmation: row.my_confirmation,
      updates: parseNetworkUpdates(row.updates),
    };
  },

  respond(reportId: string, kind: NetworkConfirmationKind) {
    return NetworkRepository.respond(reportId, kind);
  },

  addUpdate(reportId: string, body: string) {
    return NetworkRepository.addUpdate(reportId, body.trim());
  },

  resolve(reportId: string) {
    return NetworkRepository.resolve(reportId);
  },
};
