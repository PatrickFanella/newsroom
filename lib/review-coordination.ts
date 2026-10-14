export type ReviewState = {
  editorial_revision?: number;
  review_claim_actor_id?: string | null;
  review_claim_display_name?: string | null;
  review_claim_token?: string | null;
  review_claim_expires_at?: string | null;
};
export const validReviewId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function activeReviewClaim(item: ReviewState, now = Date.now()) {
  return !!item.review_claim_actor_id && !!item.review_claim_expires_at && Date.parse(item.review_claim_expires_at) > now;
}
export function reviewConflict(item: ReviewState, actorId: string, revision: number | null) {
  if (revision !== null && item.editorial_revision !== revision) return 'stale';
  if (activeReviewClaim(item) && item.review_claim_actor_id !== actorId) return 'claimed';
  return null;
}
export function expectedReviewRevision(body: Record<string, unknown>): number | null {
  if (!('expectedRevision' in body)) return null;
  const value = body.expectedRevision;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error('Invalid item revision.');
  return value;
}
export const reviewConflictMessage = (error: string) => error === 'claimed'
  ? 'Another reviewer has an active claim. Refresh the item before continuing.'
  : error === 'lease_lost' ? 'This review claim has expired or changed. Refresh before continuing.'
    : 'This item changed elsewhere. Your action was not saved; review the latest item before trying again.';

export function parseReviewAction(body: unknown) {
  if (!body || typeof body !== 'object') throw new Error('Invalid review action.');
  const input = body as Record<string, unknown>;
  if (!validReviewId(input.id) || !['claim', 'renew', 'release'].includes(String(input.action))) throw new Error('Invalid review action.');
  if (input.action !== 'claim' && !validReviewId(input.token)) throw new Error('Invalid review claim.');
  if (input.force === true && input.action !== 'release') throw new Error('Invalid review action.');
  if ('force' in input && typeof input.force !== 'boolean') throw new Error('Invalid review action.');
  return { id: input.id, action: input.action as 'claim' | 'renew' | 'release', token: input.action === 'claim' ? null : input.token as string, force: input.force === true };
}
