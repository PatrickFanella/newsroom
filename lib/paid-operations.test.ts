// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ reserve: vi.fn(), finish: vi.fn(), create: vi.fn() }));
vi.mock('./usage-budget', () => ({ reservePaidUsage: mock.reserve, finishPaidUsage: mock.finish }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mock.create }; } }));
import { enrichContent } from './enrich';
import { searchRelatedCoverage } from './search-coverage';
const input = { url: 'https://example.com/story', title: 'A sufficiently long news headline', publisher: 'Example', body: 'Source text', kind: 'article', streamId: 'owned' };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY','fixture'); vi.stubEnv('BRAVE_SEARCH_API_KEY','fixture'); mock.finish.mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('paid operations admission', () => {
  it('does not call AI when the allowance check denies or is unavailable', async () => {
    mock.reserve.mockResolvedValue(null); expect((await enrichContent(input)).summary).toBeNull(); expect(mock.create).not.toHaveBeenCalled();
  });
  it('counts and records a refusal without a second reservation', async () => {
    mock.reserve.mockResolvedValue('receipt'); mock.create.mockResolvedValue({ stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 1 }, content: [] });
    expect((await enrichContent(input)).summary).toBeNull(); expect(mock.reserve).toHaveBeenCalledOnce(); expect(mock.finish).toHaveBeenCalledWith('receipt',expect.objectContaining({ outcome: 'refused', input_tokens: 100 }));
  });
  it('records an admitted request that fails', async () => {
    vi.spyOn(console,'error').mockImplementation(() => {}); mock.reserve.mockResolvedValue('receipt'); mock.create.mockRejectedValue(new Error('fixture provider failure'));
    await enrichContent(input); expect(mock.finish).toHaveBeenCalledWith('receipt',expect.objectContaining({ outcome: 'failed' })); vi.restoreAllMocks();
  });
  it('blocks both general and targeted searches before fetch', async () => {
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher); mock.reserve.mockResolvedValue(null);
    expect(await searchRelatedCoverage({ ...input, preferredSources: ['reuters.com'] })).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
    expect(mock.reserve).toHaveBeenCalledWith('owned','coverage_search',2,{ preferred: true });
  });
  it('admits exactly the two searches for preferred sources', async () => {
    const fetcher=vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ web: { results: [] } }),{ status: 200 }))); vi.stubGlobal('fetch',fetcher); mock.reserve.mockResolvedValue('receipt');
    await searchRelatedCoverage({ ...input, preferredSources: ['reuters.com'] }); expect(fetcher).toHaveBeenCalledTimes(2); expect(mock.reserve).toHaveBeenCalledOnce();
  });
});
