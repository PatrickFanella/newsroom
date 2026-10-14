import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { PATCH } from '../route';
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn(), changed: vi.fn().mockResolvedValue(undefined), ai: vi.fn(), coverage: vi.fn(), curate: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mocks.session, getSession: mocks.session, sessionLogin: (s: { displayName: string }) => s.displayName }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/realtime', () => ({ broadcastQueueChange: mocks.changed }));
vi.mock('@/lib/extract', () => ({ runAiEnrichment: mocks.ai }));
vi.mock('@/lib/search-coverage', () => ({ searchRelatedCoverage: mocks.coverage }));
vi.mock('@/lib/submit-url', () => ({ submitUrlToQueue: vi.fn() }));
vi.mock('@/lib/curate', () => ({ sessionCanCurate: mocks.curate }));
vi.mock('@/lib/background', () => ({ waitUntil: vi.fn() }));
const id = '00000000-0000-4000-8000-000000000001';
const session = { streamId: 'signed-channel', accountId: 'mod-a', displayName: 'A', role: 'mod' };
const current = { id, editorial_revision: 0, status: 'pending', review_claim_actor_id: null, review_claim_expires_at: null, kind: 'article', title: 'Story', related_coverage: [], normalized_url: 'https://example.com/story' };
const request = (body: unknown) => new NextRequest('http://localhost/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(session); mocks.rpc.mockResolvedValue({ data: { submission: { ...current, editorial_revision: 1 } }, error: null }); mocks.curate.mockResolvedValue(false); });
function row(item: unknown = current) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: item, error: null }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); mocks.from.mockReturnValue(chain); return chain;
}
describe('claim API identity and lease actions', () => {
  it('requires an approved signed session', async () => {
    mocks.session.mockResolvedValue(null); expect((await POST(request({ id, action: 'claim' }))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('takes actor, channel, and display name from the session', async () => {
    expect((await POST(request({ id, action: 'claim', actorId: 'foreign', streamId: 'foreign', displayName: 'Forged' }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('set_submission_review_claim', { p_stream_id: 'signed-channel', p_id: id, p_actor_id: 'mod-a', p_display_name: 'A', p_action: 'claim', p_token: null, p_force: false });
  });
  it('reserves forced release for the streamer', async () => {
    expect((await POST(request({ id, action: 'release', token: id, force: true }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ ...session, role: 'streamer' });
    expect((await POST(request({ id, action: 'release', token: id, force: true }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('set_submission_review_claim', expect.objectContaining({ p_force: true, p_token: id }));
  });
  it.each(['claimed', 'stale', 'lease_lost', 'not_found'])('reports %s without a success broadcast', async (error) => {
    mocks.rpc.mockResolvedValue({ data: { error }, error: null });
    expect((await POST(request({ id, action: 'claim' }))).status).toBe(error === 'not_found' ? 404 : 409); expect(mocks.changed).not.toHaveBeenCalled();
  });
  it('rejects malformed tokens before RPC calls', async () => {
    expect((await POST(request({ id, action: 'renew', token: 'invalid' }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('queue writes with optimistic revision checks', () => {
  it('passes an editable patch and revision to the atomic RPC', async () => {
    const chain = row(); const response = await PATCH(request({ id, trigger_warning: ' Warning ', expectedRevision: 0, actorId: 'foreign', editorial_revision: 900 }));
    expect(response.status).toBe(200); expect(chain.eq.mock.calls).toContainEqual(['stream_id', 'signed-channel']);
    expect(mocks.rpc).toHaveBeenCalledWith('apply_submission_review', { p_stream_id: 'signed-channel', p_id: id, p_actor_id: 'mod-a', p_patch: { trigger_warning: 'Warning' }, p_expected_revision: 0, p_expected_status: null });
  });
  it('rejects stale approval before provider work', async () => {
    row({ ...current, editorial_revision: 1 });
    expect((await PATCH(request({ id, status: 'approved', expectedRevision: 0 }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.coverage).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled();
  });
  it('rejects another reviewer’s active claim even for an unversioned request', async () => {
    row({ ...current, review_claim_actor_id: 'mod-b', review_claim_expires_at: '2099-01-01T00:00:00Z' });
    expect((await PATCH(request({ id, status: 'rejected' }))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('handles a race caught by the commit-time check without provider or broadcast success', async () => {
    row(); mocks.rpc.mockResolvedValue({ data: { error: 'stale' }, error: null });
    expect((await PATCH(request({ id, status: 'rejected', expectedRevision: 0 }))).status).toBe(409); expect(mocks.changed).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled();
  });
  it('allows explicitly clearing a moderator note', async () => {
    row(); expect((await PATCH(request({ id, mod_notes: null, expectedRevision: 0 }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('apply_submission_review', expect.objectContaining({ p_patch: { mod_notes: null } }));
  });
  it('keeps legacy writes without a revision supported', async () => {
    row(); expect((await PATCH(request({ id, prep_note: 'Prep' }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('apply_submission_review', expect.objectContaining({ p_expected_revision: null }));
  });
  it('rejects invalid revisions and preserves curation permission checks', async () => {
    expect((await PATCH(request({ id, expectedRevision: -1 }))).status).toBe(400);
    expect((await PATCH(request({ id, segment_id: id }))).status).toBe(403); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('returns 404 for foreign/missing items before provider work', async () => {
    row(null); expect((await PATCH(request({ id, status: 'approved', expectedRevision: 0 }))).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled();
  });
});
