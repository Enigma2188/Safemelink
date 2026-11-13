/** Social DTOs never contain account IDs, follower lists, private points or tokens. */
export type NetworkSocialAction = 'VOTE' | 'FOLLOW' | 'COMMENT';
export type NetworkSocialVote = 'CONFIRMED' | 'NO_LONGER_PRESENT';
export type NetworkSocialComment = Readonly<{ publicId: string; nickname: string; body: string; createdAt: string; canWithdraw: boolean }>;
export type NetworkSocialSnapshot = Readonly<{ eventId: string; validUntil: string; confirmedCount: number;
  noLongerPresentCount: number; myVote: NetworkSocialVote | null; following: boolean; comments: readonly NetworkSocialComment[] }>;
export type NetworkSocialReceipt = Readonly<{ operationId: string; eventId: string; action: NetworkSocialAction; commentId: string | null; replayed: boolean }>;
export type NetworkSocialActivity = Readonly<{ publicId: string; eventId: string; kind: 'COMMENT_APPROVED'; createdAt: string; validUntil: string }>;
export type NetworkSocialCursor = Readonly<{ createdAt: string; publicId: string }>;
export type NetworkSocialV2RpcArgs = {
  get_network_social_v2: { target_event: string; before_created: string | null; before_id: string | null };
  mutate_network_social_v2: { target_event: string; target_operation: string; action_kind: NetworkSocialAction; action_value: string };
  remove_my_network_social_v2: { target_event: string; target_comment: string | null };
  get_my_network_social_operation_v2: { target_operation: string };
  list_network_social_activity_v2: { target_territory: string; followed_only: boolean };
};
export const isNetworkSocialUuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const exact = (x: unknown, fields: readonly string[]): x is Record<string, unknown> => !!x && typeof x === 'object' &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null) &&
  Reflect.ownKeys(x).length === fields.length && Reflect.ownKeys(x).every(k => typeof k === 'string' && fields.includes(k) &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(x, k), 'value'));
const string = (x: unknown, min: number, max: number): x is string => typeof x === 'string' && x.trim().length >= min && x.length <= max;
const date = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(Date.parse(x)).toISOString().slice(0, 23) === x.slice(0, 23);
const count = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const invalid = () => { throw new Error('INVALID_SOCIAL_DTO'); };
export function decodeNetworkSocialSnapshot(x: unknown): NetworkSocialSnapshot {
  if (!exact(x, ['eventId','validUntil','confirmedCount','noLongerPresentCount','myVote','following','comments']) ||
    !isNetworkSocialUuid(x.eventId) || !date(x.validUntil) || !count(x.confirmedCount) || !count(x.noLongerPresentCount) ||
    (x.myVote !== null && x.myVote !== 'CONFIRMED' && x.myVote !== 'NO_LONGER_PRESENT') || typeof x.following !== 'boolean' ||
    !Array.isArray(x.comments) || x.comments.length > 50) return invalid();
  const ids = new Set<string>();
  const comments = x.comments.map((c: unknown) => {
    if (!exact(c, ['publicId','nickname','body','createdAt','canWithdraw']) || !isNetworkSocialUuid(c.publicId) || ids.has(c.publicId) || typeof c.canWithdraw !== 'boolean' ||
      !string(c.nickname, 2, 40) || !string(c.body, 2, 1000) || !date(c.createdAt)) return invalid();
    ids.add(c.publicId);
    return Object.freeze({ publicId: c.publicId, nickname: c.nickname, body: c.body, createdAt: c.createdAt, canWithdraw: c.canWithdraw });
  });
  return Object.freeze({ eventId: x.eventId, validUntil: x.validUntil, confirmedCount: x.confirmedCount,
    noLongerPresentCount: x.noLongerPresentCount, myVote: x.myVote, following: x.following, comments: Object.freeze(comments) });
}
export function decodeNetworkSocialReceipt(x: unknown): NetworkSocialReceipt {
  if (!exact(x, ['operationId','eventId','action','commentId','replayed']) || !isNetworkSocialUuid(x.operationId) ||
    !isNetworkSocialUuid(x.eventId) || (x.action !== 'VOTE' && x.action !== 'FOLLOW' && x.action !== 'COMMENT') ||
    typeof x.replayed !== 'boolean' || (x.action === 'COMMENT' ? !isNetworkSocialUuid(x.commentId) : x.commentId !== null)) return invalid();
  return Object.freeze({ operationId: x.operationId, eventId: x.eventId, action: x.action, commentId: x.commentId as string | null, replayed: x.replayed });
}
export function decodeNetworkSocialActivity(x: unknown): readonly NetworkSocialActivity[] {
  if (!Array.isArray(x) || x.length > 50) return invalid(); const ids = new Set<string>();
  return Object.freeze(x.map((a: unknown) => {
    if (!exact(a, ['publicId','eventId','kind','createdAt','validUntil']) || !isNetworkSocialUuid(a.publicId) || ids.has(a.publicId) ||
      !isNetworkSocialUuid(a.eventId) || a.kind !== 'COMMENT_APPROVED' || !date(a.createdAt) || !date(a.validUntil)) return invalid();
    ids.add(a.publicId); return Object.freeze({ publicId: a.publicId, eventId: a.eventId, kind: a.kind, createdAt: a.createdAt, validUntil: a.validUntil });
  }));
}
