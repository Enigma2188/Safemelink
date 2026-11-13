import { NetworkV2Error, NetworkV2Repository } from './NetworkV2Repository';
import { decodeNetworkSocialActivity, decodeNetworkSocialReceipt, decodeNetworkSocialSnapshot, isNetworkSocialUuid,
  type NetworkSocialAction, type NetworkSocialCursor } from '@/services/NetworkSocialContractV2';

/** Reuses the existing request engine: auth epoch, abort, timeout and UNKNOWN writes. */
export class NetworkSocialV2Repository extends NetworkV2Repository {
  async snapshot(eventId: string, signal: AbortSignal, before?: NetworkSocialCursor) {
    if (!isNetworkSocialUuid(eventId) || (before && (!isNetworkSocialUuid(before.publicId) || !Number.isFinite(Date.parse(before.createdAt))))) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('get_network_social_v2', { target_event: eventId, before_created: before?.createdAt ?? null, before_id: before?.publicId ?? null }, signal, data => {
      let value; try { value = decodeNetworkSocialSnapshot(data); } catch { throw new NetworkV2Error('INVALID_DATA'); }
      if (value.eventId !== eventId || Date.parse(value.validUntil) <= Date.now()) throw new NetworkV2Error('INVALID_DATA');
      return value;
    }, 'social-snapshot');
  }
  async mutate(eventId: string, operationId: string, action: NetworkSocialAction, value: string, signal: AbortSignal, authorUpdate = false) {
    if (!isNetworkSocialUuid(eventId) || !isNetworkSocialUuid(operationId) ||
      (action === 'VOTE' ? !['CONFIRMED','NO_LONGER_PRESENT','NONE'].includes(value) :
        action === 'FOLLOW' ? !['ON','OFF'].includes(value) : action !== 'COMMENT' || value.trim().length < 2 || value.trim().length > 1000)) throw new NetworkV2Error('INVALID_REQUEST');
    if (authorUpdate && (action !== 'COMMENT' || value.trim().length > 300)) throw new NetworkV2Error('INVALID_REQUEST');
    const name = authorUpdate ? 'publish_network_author_update_v2' : 'mutate_network_social_v2';
    const args = authorUpdate ? { target_event: eventId, target_operation: operationId, update_body: value.trim() } :
      { target_event: eventId, target_operation: operationId, action_kind: action, action_value: value };
    return this.request(name, args, signal, data => {
      let receipt; try { receipt = decodeNetworkSocialReceipt(data); } catch { throw new NetworkV2Error('INVALID_DATA'); }
      if (receipt.eventId !== eventId || receipt.operationId !== operationId || receipt.action !== action) throw new NetworkV2Error('INVALID_DATA');
      return receipt;
    }, undefined, true);
  }
  async activity(territoryId: string, followedOnly: boolean, signal: AbortSignal) {
    if (!isNetworkSocialUuid(territoryId) || typeof followedOnly !== 'boolean') throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('list_network_social_activity_v2', { target_territory: territoryId, followed_only: followedOnly }, signal, data => {
      try { return Object.freeze(decodeNetworkSocialActivity(data).filter(a => Date.parse(a.validUntil) > Date.now())); } catch { throw new NetworkV2Error('INVALID_DATA'); }
    }, 'social-activity');
  }
  async removeMine(eventId: string, commentId: string | null, signal: AbortSignal) {
    if (!isNetworkSocialUuid(eventId) || (commentId !== null && !isNetworkSocialUuid(commentId))) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('remove_my_network_social_v2', { target_event: eventId, target_comment: commentId }, signal,
      data => { if (data !== null) throw new NetworkV2Error('INVALID_DATA'); }, undefined, true);
  }
  async receipt(operationId: string, signal: AbortSignal) {
    if (!isNetworkSocialUuid(operationId)) throw new NetworkV2Error('INVALID_REQUEST');
    return this.request('get_my_network_social_operation_v2', { target_operation: operationId }, signal, data => {
      if (data === null) return null;
      let result; try { result = decodeNetworkSocialReceipt(data); } catch { throw new NetworkV2Error('INVALID_DATA'); }
      if (result.operationId !== operationId) throw new NetworkV2Error('INVALID_DATA'); return result;
    }, 'social-receipt');
  }
}
