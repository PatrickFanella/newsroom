import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as list, POST } from './route';
import { GET as read, PATCH } from './[id]/route';

const mocks = vi.hoisted(() => ({ session: vi.fn(), approved: vi.fn(), rpc: vi.fn(), from: vi.fn(), changed: vi.fn().mockResolvedValue(undefined), wait: vi.fn() }));
vi.mock('@/lib/session', () => ({ getSession: mocks.session, getApprovedSession: mocks.approved }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/realtime', () => ({ broadcastSessionChange: mocks.changed }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.wait }));
const id = '00000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ id }) };
const owner = { streamId: 'own-channel', role: 'streamer' };
const request = (method = 'GET', body?: unknown, query = '') => new NextRequest(`http://localhost/api/broadcasts${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
const broadcast = { id, stream_id: owner.streamId, title: 'Desk', started_at: '2026-10-14T00:00:00Z', ended_at: null, vod_url: null, vod_offset_seconds: 0, rundown: { items: [], segments: [], ungrouped_position: 0 } };
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(owner); mocks.approved.mockResolvedValue(owner); });

describe('broadcast API authorization and actions', () => {
  it('rejects unauthenticated reads and writes before touching the database', async () => {
    mocks.session.mockResolvedValue(null); mocks.approved.mockResolvedValue(null);
    expect((await list(request())).status).toBe(401);
    expect((await read(request(), context)).status).toBe(401);
    expect((await POST(request('POST', { action: 'start', title: 'Desk' }))).status).toBe(401);
    expect((await PATCH(request('PATCH', { title: 'Desk' }), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('allows moderators to read but reserves mutations for the owner', async () => {
    mocks.session.mockResolvedValue({ ...owner, role: 'mod' }); mocks.approved.mockResolvedValue({ ...owner, role: 'mod' });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await list(request())).status).toBe(200);
    expect((await POST(request('POST', { action: 'start', title: 'Desk' }))).status).toBe(403);
    expect((await PATCH(request('PATCH', { title: 'Desk' }), context)).status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('uses the signed channel and trims the title when starting', async () => {
    mocks.rpc.mockReturnValue({ single: vi.fn().mockResolvedValue({ data: broadcast, error: null }) });
    const response = await POST(request('POST', { action: 'start', title: ' Desk ', streamId: 'foreign' }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('start_broadcast', { p_stream_id: owner.streamId, p_title: 'Desk' });
    expect(mocks.changed).toHaveBeenCalledWith(owner.streamId);
  });
  it.each(['23505', '42501', 'unexpected'])('maps database failure %s without reporting success', async (code) => {
    mocks.rpc.mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { code } }) });
    expect((await POST(request('POST', { action: 'start', title: 'Desk' }))).status).toBe(code === '23505' ? 409 : code === '42501' ? 403 : 500);
    expect(mocks.changed).not.toHaveBeenCalled();
  });
  it('does not end a show belonging to another channel', async () => {
    mocks.rpc.mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: null }, error: null }) });
    expect((await POST(request('POST', { action: 'end', id }))).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith('end_broadcast', { p_stream_id: owner.streamId, p_id: id });
  });
  it.each([{ action: 'start', title: '' }, { action: 'end', id: 'invalid' }, { action: 'delete', id }])('rejects malformed action %j', async (body) => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('broadcast history and repeatable downloads', () => {
  it('uses a timestamp and id cursor to paginate tied starts', async () => {
    const rows = Array.from({ length: 50 }, () => ({ id, started_at: broadcast.started_at }));
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const response = await list(request('GET', undefined, `?before=${encodeURIComponent(`${broadcast.started_at}|${id}`)}`));
    expect(mocks.rpc).toHaveBeenCalledWith('list_broadcasts', { p_stream_id: owner.streamId, p_before: broadcast.started_at, p_before_id: id, p_active: false });
    expect((await response.json()).nextCursor).toBe(`${broadcast.started_at}|${id}`);
  });
  it.each(['?before=invalid', '?before=2026-10-14T00:00:00Z%7Cinvalid', `?active=1&before=${broadcast.started_at}%7C${id}`])('rejects cursor %s', async (query) => {
    expect((await list(request('GET', undefined, query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing or foreign show', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await read(request(), context)).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith('read_broadcast', { p_stream_id: owner.streamId, p_id: id });
  });
  it('downloads the same show twice without consuming export state', async () => {
    mocks.rpc.mockResolvedValue({ data: { broadcast, notes: [] }, error: null });
    const first = await read(request('GET', undefined, '?format=markdown'), context);
    const second = await read(request('GET', undefined, '?format=markdown'), context);
    expect(first.headers.get('Content-Disposition')).toBe(`attachment; filename="show-${id}.md"`);
    expect(await first.text()).toBe(await second.text());
    const chapters = await read(request('GET', undefined, '?format=chapters'), context);
    expect(await chapters.text()).toBe('00:00 Desk\n');
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.changed).not.toHaveBeenCalled();
  });
  it('updates only editable settings, scoped to the signed channel', async () => {
    const chain = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: broadcast, error: null }) };
    chain.update.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.select.mockReturnValue(chain); mocks.from.mockReturnValue(chain);
    expect((await PATCH(request('PATCH', { title: 'New', vodUrl: 'https://youtu.be/abcdefghijk', vodOffsetSeconds: 300, stream_id: 'foreign', rundown: {} }), context)).status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({ title: 'New', vod_url: 'https://www.youtube.com/watch?v=abcdefghijk', vod_offset_seconds: 300, updated_at: expect.any(String) });
    expect(chain.eq.mock.calls).toEqual([['id', id], ['stream_id', owner.streamId]]);
  });
});
