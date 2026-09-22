import type { NetworkConfirmationKind, NetworkReportCategory } from '@/backend/database.types';
import { NetworkRepository } from '@/backend/repositories/NetworkRepository';
import { AuthService } from '@/backend/auth/AuthService';
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
  isMine: row.is_mine,
}));

export const NetworkService = {
  async getMyNetworkOnboardingStatus(): Promise<NetworkOnboardingStatus> {
    const row = await NetworkRepository.getOnboardingStatus();
    return {
      emailVerified: row.email_verified,
      firstNamePresent: row.first_name_present,
      lastNamePresent: row.last_name_present,
      nicknamePresent: row.nickname_present,
      phonePresent: row.phone_present,
      phoneVerified: row.phone_verified,
      currentTermsVersion: row.current_terms_version,
      acceptedTermsVersion: row.accepted_terms_version,
      termsAccepted: row.terms_accepted,
      eligible: row.eligible,
      restrictionStatus: row.restriction_status,
      nickname: row.nickname,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
    };
  },

  updateIdentity(input: { firstName: string; lastName: string; nickname: string; phone: string }) {
    return NetworkRepository.updateIdentity(input);
  },

  acceptCurrentTerms(status: NetworkOnboardingStatus) {
    return NetworkRepository.acceptTerms(status.currentTermsVersion, NETWORK_FEED_RADIUS_METERS);
  },

  getFeedRadius: NetworkRepository.getFeedRadius,

  setFeedRadius(radiusMeters: number) {
    return NetworkRepository.setFeedRadius(radiusMeters);
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

  async loadFeed(radiusMeters = NETWORK_FEED_RADIUS_METERS, cursor?: NetworkFeedCursor | null) {
    const location = await LocationService.getCurrentLocation({
      timeoutMs: 15_000,
      accuracy: 'balanced',
    });
    const reports = normalizeFeed(await NetworkRepository.listFeed({
      latitude: location.latitude,
      longitude: location.longitude,
      radiusMeters,
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
    const owner = (await AuthService.getSession())?.user.id;
    if (!owner) throw new Error('Accedi prima di pubblicare una segnalazione.');
    const location = await LocationService.getCurrentLocation({
      timeoutMs: 15_000,
      accuracy: 'high',
    });
    // The GPS request can outlive logout/login; do not publish A's draft as B.
    if ((await AuthService.getSession())?.user.id !== owner) {
      throw new Error('Account cambiato durante la richiesta. Riprova con l’account attuale.');
    }
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
