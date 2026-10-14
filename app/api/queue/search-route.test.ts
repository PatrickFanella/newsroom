import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/session', () => ({ getSession: mocks.session, getApprovedSession: vi.fn(), sessionLogin: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/curate', () => ({ sessionCanCurate: vi.fn() }));
vi.mock('@/lib/search-coverage', () => ({ searchRelatedCoverage: vi.fn() }));
vi.mock('@/lib/extract', () => ({ runAiEnrichment: vi.fn() }));
vi.mock('@/lib/submit-url', () => ({ submitUrlToQueue: vi.fn() }));
vi.mock('@/lib/realtime', () => ({ broadcastQueueChange: vi.fn() }));
const request = (query = '?page=1') => new NextRequest(`http://localhost/api/queue${query}`);
const overview = { pending: 210, approved: 1, played: 2, rejected: 3, total: 216, now_playing: { id: 'on-air' } };
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ streamId: 'signed-channel' }); });
function backend(search = { data: { submissions: [{ id: 'story' }], next_cursor: 'cursor', matched_count: 76 }, error: null } as { data: unknown; error: unknown }) {
  mocks.rpc.mockImplementation((name: string) => name === 'search_queue' ? Promise.resolve(search) : { maybeSingle: vi.fn().mockResolvedValue({ data: overview, error: null }) });
}
describe('paged queue reads', () => {
  it('requires authentication before any database request', async () => {
    mocks.session.mockResolvedValue(null); expect((await GET(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('scopes search to the signed channel and keeps global counts/on-air separate from matches', async () => {
    backend();
    const response = await GET(request('?page=1&status=rejected&q=budget&kind=article&stream_id=foreign'));
    expect(mocks.rpc).toHaveBeenCalledWith('search_queue', { p_stream_id: 'signed-channel', p_status: 'rejected', p_query: 'budget', p_kind: 'article', p_before: null, p_before_id: null });
    expect(await response.json()).toEqual({ submissions: [{ id: 'story' }], nextCursor: 'cursor', matchedCount: 76, nowPlaying: { id: 'on-air' }, counts: { pending: 210, approved: 1, played: 2, rejected: 3, total: 216 } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('passes the exact timestamp and UUID boundary to the next page', async () => {
    backend(); const id = '00000000-0000-4000-8000-000000000001';
    await GET(request(`?page=1&before=2026-10-14T00:00:00.123456Z%7C${id}`));
    expect(mocks.rpc).toHaveBeenCalledWith('search_queue', expect.objectContaining({ p_before: '2026-10-14T00:00:00.123456Z', p_before_id: id }));
  });
  it('rejects malformed filters before touching the database', async () => {
    expect((await GET(request('?page=1&kind=invalid'))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reports the missing migration instead of silently falling back to capped results', async () => {
    backend({ data: null, error: { code: 'PGRST202' } });
    const response = await GET(request()); expect(response.status).toBe(503); expect((await response.json()).error).toContain('unavailable');
  });
  it('does not expose internal database error details', async () => {
    backend({ data: null, error: { code: 'XX000', message: 'private database internals' } });
    const response = await GET(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain('private');
  });
  it('retains the unpaged position-ordered 200-item response for deck consumers', async () => {
    backend();
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain); chain.limit.mockResolvedValue({ data: [{ id: 'deck-story' }], error: null }); mocks.from.mockReturnValue(chain);
    // This fake terminal needs to remain chainable for the status predicate.
    chain.limit.mockReturnValue({ ...chain, eq: vi.fn().mockResolvedValue({ data: [{ id: 'deck-story' }], error: null }) });
    const response = await GET(request('?status=approved'));
    expect(chain.order.mock.calls).toEqual([['position', { ascending: true, nullsFirst: false }], ['created_at', { ascending: false }]]); expect(chain.limit).toHaveBeenCalledWith(200);
    const body = await response.json(); expect(body.submissions).toEqual([{ id: 'deck-story' }]); expect(body).not.toHaveProperty('nextCursor');
    expect(mocks.rpc).not.toHaveBeenCalledWith('search_queue', expect.anything());
  });
});
