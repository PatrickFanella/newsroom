import { afterEach, expect, it, vi } from 'vitest';
import { fetchYouTubeMeta } from './extract-youtube';

const transcript = vi.hoisted(() => vi.fn());
vi.mock('youtube-transcript', () => ({ YoutubeTranscript: { fetchTranscript: transcript } }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('bounds transcript fallback requests with the shared metadata deadline', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'fixture-only');
  const deadlines: number[] = [];
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { deadlines.push(ms); return controller.signal; });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [{ snippet: { title: 'Video' }, contentDetails: { duration: 'PT2M' } }] }))));
  transcript.mockImplementation(async (_id, config) => {
    controller.abort();
    const fetchMock = vi.fn((_input, init) => {
      init.signal.throwIfAborted();
      return Promise.resolve(new Response('transcript'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await config.fetch('https://www.youtube.com/api/timedtext');
    return [];
  });
  const meta = await fetchYouTubeMeta('https://www.youtube.com/watch?v=abcdefghijk');
  expect(meta.title).toBe('Video');
  expect(meta.transcript).toBeNull();
  expect(transcript.mock.calls[0][1].fetch).toBeTypeOf('function');
  expect(deadlines).toContain(20_000);
  expect(deadlines.filter(ms => ms === 8_000)).toHaveLength(2);
});
