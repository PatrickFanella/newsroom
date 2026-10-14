import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcastQueueChange } from './realtime';

const retained = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ waitUntil: retained }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('serverless Realtime delivery', () => {
  it('retains an unawaited notification in the Vercel request lifetime', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-only');
    let finish!: (value: Response) => void;
    const request = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', request);
    const work = broadcastQueueChange('channel');
    expect(retained).toHaveBeenCalledWith(work);
    expect(request.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
    finish(new Response(null, { status: 202 }));
    await work;
  });
});
