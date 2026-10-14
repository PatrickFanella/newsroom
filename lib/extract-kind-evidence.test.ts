import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractMetaForKind, enrichExtractedMeta } from './extract-kind';
const mocks = vi.hoisted(() => ({ youtube: vi.fn(), article: vi.fn(), enrich: vi.fn() }));
vi.mock('./extract-youtube', () => ({ fetchYouTubeMeta: mocks.youtube }));
vi.mock('./extract-article', () => ({ extractArticle: mocks.article }));
vi.mock('./enrich', () => ({ enrichContent: mocks.enrich, hostDMCARisk: () => 'low' }));
beforeEach(() => vi.clearAllMocks());
describe('extractor evidence sources', () => {
  it('puts a real transcript into the bounded model input even with a long description', async () => {
    mocks.youtube.mockResolvedValue({ title: 'Video', description: 'd'.repeat(6000), transcript: 'Actual transcript', thumbnail: null, publisher: 'Channel', publishedAt: null, durationSeconds: 10 });
    const meta = (await extractMetaForKind('https://youtube.com/watch?v=abcdefghijk', 'youtube'))!;
    expect(meta.evidenceSource).toBe('transcript'); expect(meta.bodyText?.slice(0,5500)).toContain('Actual transcript');
    mocks.enrich.mockResolvedValue({ summary: 'Summary', credibility: null, topics: [], dmcaRisk: 'low', contentWarning: false });
    await enrichExtractedMeta({ url: 'https://youtube.com/watch?v=abcdefghijk', kind: 'youtube', meta, streamId: 'stream' });
    expect(mocks.enrich).toHaveBeenCalledWith(expect.objectContaining({ evidenceSource: 'transcript' }));
  });
  it('does not call a video description a transcript', async () => {
    mocks.youtube.mockResolvedValue({ title: 'Video', description: 'Caption', transcript: null });
    expect((await extractMetaForKind('https://youtube.com/watch?v=abcdefghijk', 'youtube'))?.evidenceSource).toBe('description');
  });
  it('distinguishes empty video content from metadata descriptions', async () => {
    mocks.youtube.mockResolvedValue({ title: 'Video', description: null, transcript: null });
    expect((await extractMetaForKind('https://youtube.com/watch?v=abcdefghijk', 'youtube'))?.evidenceSource).toBe('unavailable');
  });
  it('labels article OG metadata without claiming body extraction', async () => {
    mocks.article.mockResolvedValue({ title: 'Article', description: 'Marketing description' });
    expect((await extractMetaForKind('https://example.com/article', 'article'))?.evidenceSource).toBe('page_metadata');
  });
});
