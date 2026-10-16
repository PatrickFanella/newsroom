// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), curate: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mocks.session, getSession: mocks.session }));
vi.mock('@/lib/curate', () => ({ sessionCanCurate: mocks.curate }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
import { PATCH } from './route';
const call = (body: unknown = { is_template: true, prep_prompt: ' Check dates ' }) => PATCH(
  new NextRequest('http://localhost/api/lists/shelf', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'shelf' }) },
);
beforeEach(() => {
  vi.resetAllMocks();
  const chain = { update: mocks.update, eq: mocks.eq, select: mocks.select, maybeSingle: mocks.single };
  mocks.from.mockReturnValue(chain); mocks.update.mockReturnValue(chain); mocks.eq.mockReturnValue(chain); mocks.select.mockReturnValue(chain);
  mocks.single.mockResolvedValue({ data: { id: 'shelf' }, error: null });
  mocks.session.mockResolvedValue({ streamId: 'owned-stream', role: 'streamer' }); mocks.curate.mockResolvedValue(true);
});
describe('preparation metadata updates', () => {
  it('updates only the owned shelf and rejects client ownership fields', async () => {
    expect((await call({ is_template: true, prep_prompt: ' Check dates ', stream_id: 'other' })).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ is_template: true, prep_prompt: 'Check dates', updated_at: expect.any(String) });
    expect(mocks.eq).toHaveBeenCalledWith('stream_id', 'owned-stream');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'shelf');
  });
  it('requires approved authentication', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires curator permission', async () => {
    mocks.curate.mockResolvedValue(false);
    expect((await call()).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('returns not found if the ownership filter matched no shelf', async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
  });
  it.each([{ is_template: 'true' }, { prep_prompt: 'x'.repeat(10001) }, null])('rejects malformed preparation settings', async (body) => {
    expect((await call(body)).status).toBe(400); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('preserves shelf renaming', async () => {
    expect((await call({ name: 'Tonight' })).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Tonight', updated_at: expect.any(String) });
  });
});
