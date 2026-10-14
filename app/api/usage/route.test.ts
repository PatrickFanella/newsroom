// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mock.session }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ rpc: mock.rpc, from: () => ({ update: mock.update }) }) }));
import { GET, PATCH } from './route';
const patch = (body: unknown = { monthly_budget_usd: 1 }) => PATCH(new NextRequest('http://localhost/api/usage', { method: 'PATCH', body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks(); mock.session.mockResolvedValue({ streamId: 'owned', role: 'streamer' });
  const chain = { eq: mock.eq, select: mock.select, maybeSingle: mock.single }; mock.update.mockReturnValue(chain); mock.eq.mockReturnValue(chain); mock.select.mockReturnValue(chain);
  mock.single.mockResolvedValue({ data: { id: 'owned' }, error: null }); mock.rpc.mockResolvedValue({ data: { summaries: 1 }, error: null });
});
describe('owner usage API', () => {
  it('scopes reads and writes to the session', async () => {
    expect((await GET()).status).toBe(200); expect(mock.rpc).toHaveBeenCalledWith('owner_usage_overview', { p_stream_id: 'owned' });
    expect((await patch({ monthly_budget_usd: 1, stream_id: 'other' })).status).toBe(200); expect(mock.eq).toHaveBeenCalledWith('id', 'owned');
  });
  it('denies moderators, including curators', async () => {
    mock.session.mockResolvedValue({ streamId: 'owned', role: 'mod' });
    expect((await GET()).status).toBe(403); expect((await patch()).status).toBe(403); expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
  });
  it('denies unauthenticated or blocked sessions', async () => {
    mock.session.mockResolvedValue(null); expect((await GET()).status).toBe(401); expect((await patch()).status).toBe(401);
  });
  it('rejects invalid settings before a write', async () => {
    expect((await patch({ monthly_budget_usd: -1 })).status).toBe(400); expect(mock.update).not.toHaveBeenCalled();
  });
  it('reports unavailable usage rather than zero activity', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: {} }); expect((await GET()).status).toBe(503);
  });
});
