// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), curate: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mocks.session }));
vi.mock('@/lib/curate', () => ({ sessionCanCurate: mocks.curate }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const call = (body: unknown = { name: ' Tonight ', streamId: 'attacker' }, sourceId = id) => POST(
  new NextRequest('http://localhost/api/lists/template/instantiate', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: sourceId }) },
);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ streamId: 'owned-stream', role: 'streamer' });
  mocks.curate.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { id: 'working-id', name: 'Tonight' }, error: null });
});
describe('template instantiation', () => {
  it('uses session ownership, not client ownership', async () => {
    const response = await call();
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith('instantiate_preparation_template', {
      p_stream_id: 'owned-stream', p_template_id: id, p_name: 'Tonight',
    });
    expect(await response.json()).toEqual({ list: { id: 'working-id', name: 'Tonight' } });
  });
  it('requires an approved session', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires curator permission', async () => {
    mocks.curate.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects missing or overlong names before copying', async () => {
    expect((await call({ name: '' })).status).toBe(400);
    expect((await call({ name: 'x'.repeat(81) })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid source IDs', async () => {
    expect((await call({}, 'invalid')).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('treats other streams and ordinary shelves as absent', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
  });
  it('does not claim creation or expose SQL internals on a failed transaction', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private constraint details' } });
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not create the working shelf' });
  });
});
