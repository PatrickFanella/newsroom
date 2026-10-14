import { describe, expect, it } from 'vitest';
import { activeReviewClaim, expectedReviewRevision, parseReviewAction, reviewConflict } from './review-coordination';
const id = '00000000-0000-4000-8000-000000000001';
const item = { editorial_revision: 2, review_claim_actor_id: 'mod-a', review_claim_expires_at: '2099-01-01T00:00:00Z' };
describe('review claims and revisions', () => {
  it('allows same reviewer and rejects other reviewers even without a revision', () => {
    expect(reviewConflict(item, 'mod-a', 2)).toBeNull(); expect(reviewConflict(item, 'mod-b', null)).toBe('claimed');
  });
  it('rejects stale edits and treats an expired lease as available', () => {
    expect(reviewConflict(item, 'mod-a', 1)).toBe('stale');
    expect(activeReviewClaim(item, Date.parse(item.review_claim_expires_at))).toBe(false);
    expect(reviewConflict({ ...item, review_claim_expires_at: '2000-01-01T00:00:00Z' }, 'mod-b', 2)).toBeNull();
  });
  it('allows absent revisions for legacy clients while validating supplied ones', () => {
    expect(expectedReviewRevision({})).toBeNull(); expect(expectedReviewRevision({ expectedRevision: 0 })).toBe(0);
  });
  it.each([null, '2', -1, 1.5, 2147483648])('rejects revision %j', (expectedRevision) => {
    expect(() => expectedReviewRevision({ expectedRevision })).toThrow();
  });
  it('parses explicit claim, renewal, and release without trusting supplied ownership', () => {
    expect(parseReviewAction({ id, action: 'claim', actorId: 'foreign', streamId: 'foreign' })).toEqual({ id, action: 'claim', token: null, force: false });
    expect(parseReviewAction({ id, action: 'release', token: id, force: true })).toEqual({ id, action: 'release', token: id, force: true });
  });
  it.each([{ id: 'invalid', action: 'claim' }, { id, action: 'delete' }, { id, action: 'renew' }, { id, action: 'claim', force: true }])('rejects invalid action %j', (body) => {
    expect(() => parseReviewAction(body)).toThrow();
  });
});
