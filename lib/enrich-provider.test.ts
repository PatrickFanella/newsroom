import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichContent } from './enrich';

const mocks = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn(), usage: vi.fn(), reserve: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  messages = { create: mocks.create };
  constructor(options: unknown) { mocks.options(options); }
} }));
vi.mock('./usage-budget', () => ({ reservePaidUsage: mocks.reserve, finishPaidUsage: mocks.usage }));
const input = { streamId: 'owned-channel', url: 'https://example.com/story', kind: 'article', title: 'A story', publisher: 'Example', body: null };

beforeEach(() => {
  vi.resetAllMocks(); mocks.reserve.mockResolvedValue('receipt');
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('AI enrichment outcomes', () => {
  it('reports unconfigured AI rather than treating a missing summary as success', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await enrichContent(input)).failureReason).toBe('AI is not configured.');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports missing source content without invoking the provider', async () => {
    expect((await enrichContent({ ...input, kind: 'youtube' })).failureReason).toContain('No source content');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports a provider refusal as a retryable processing failure', async () => {
    mocks.create.mockResolvedValue({ stop_reason: 'refusal', content: [] });
    expect((await enrichContent(input)).failureReason).toContain('declined');
  });

  it.each(['not json', '{"summary":null}', '{"summary":" "}'])('reports invalid output %s and still records billed usage', async (text) => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text }], usage: { input_tokens: 20, output_tokens: 5 } });
    expect((await enrichContent(input)).failureReason).toContain('failed');
    expect(mocks.usage).toHaveBeenCalledOnce();
  });

  it('never calls the provider when allowance admission fails', async () => {
    mocks.reserve.mockResolvedValue(null);
    const result=await enrichContent(input);
    expect(result.skippedReason).toContain('usage');
    expect(result.evidence?.outcome).toBe('skipped');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it('returns successful content with a bounded provider timeout and no SDK retries', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ summary: 'Source summary', topics: [], dmca_risk: 'low' }) }], usage: {} });
    const result = await enrichContent(input);
    expect(result.summary).toBe('Source summary');
    expect(result.failureReason).toBeUndefined();
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 20_000, maxRetries: 0 }));
  });
});
