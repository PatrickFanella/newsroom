import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichContent } from './enrich';
const mocks = vi.hoisted(() => ({ create: vi.fn(), usage: vi.fn(), reserve: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.create }; } }));
vi.mock('./usage-budget', () => ({ reservePaidUsage: mocks.reserve, finishPaidUsage: mocks.usage }));
const input = { streamId: 'owned-channel', url: 'https://example.com/article', title: 'Title', publisher: 'Example', body: 'A short page description', kind: 'article' };
const response = (content: unknown[], stop_reason = 'end_turn') => ({ content, stop_reason, usage: { input_tokens: 100, output_tokens: 50 } });
const summary = { type: 'text', text: JSON.stringify({ summary: 'Summary', credibility: 'mainstream', topics: [], dmca_risk: 'low', content_warning: false }) };
beforeEach(() => { vi.clearAllMocks(); mocks.reserve.mockResolvedValue('receipt'); vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-only'); });
afterEach(() => vi.unstubAllEnvs());
describe('model input provenance', () => {
  it('records page retrieval only when the provider returns the tool result', async () => {
    mocks.create.mockResolvedValue(response([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: input.url, retrieved_at: '2026-10-14T00:00:00Z' } }, summary]));
    const result = await enrichContent(input);
    expect(result.evidence).toMatchObject({ source: 'page_metadata', retrieval: 'retrieved', outcome: 'succeeded', retrieved_url: input.url });
    expect(result.summary).toBe('Summary');
  });
  it('records a failed page fetch even if the model still returns a summary', async () => {
    mocks.create.mockResolvedValue(response([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } }, summary]));
    expect((await enrichContent(input)).evidence).toMatchObject({ retrieval: 'failed', outcome: 'succeeded' });
  });
  it('does not infer retrieval from a valid generated summary', async () => {
    mocks.create.mockResolvedValue(response([summary]));
    expect((await enrichContent(input)).evidence?.retrieval).toBe('not_observed');
  });
  it('records transcript input independently of article retrieval', async () => {
    mocks.create.mockResolvedValue(response([summary]));
    expect((await enrichContent({ ...input, kind: 'youtube', evidenceSource: 'transcript', body: 'x'.repeat(9000) })).evidence).toMatchObject({ source: 'transcript', input_characters: 5500, outcome: 'succeeded' });
  });
  it('distinguishes disabled AI, refusal, invalid output, and request failure', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ''); expect((await enrichContent(input)).evidence?.outcome).toBe('skipped');
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-only');
    mocks.create.mockResolvedValue(response([], 'refusal')); expect((await enrichContent(input)).evidence?.outcome).toBe('refused');
    mocks.create.mockResolvedValue(response([{ type: 'text', text: 'not json' }])); expect((await enrichContent(input)).evidence?.outcome).toBe('invalid_response');
    mocks.create.mockRejectedValue(new Error('Synthetic provider failure')); expect((await enrichContent(input)).evidence?.outcome).toBe('failed');
  });
});
