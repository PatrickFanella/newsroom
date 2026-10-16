import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabaseAdmin: () => ({ rpc }) }));
import { reservePaidUsage } from './usage-budget';
import { parseUsageSettings, usageAlert, type UsageOverview } from './usage-policy';
const usage: UsageOverview = { month_start: '', month_end: '', summaries: 1, searches: 1, extractions: 1, estimated_usd: 0.8, monthly_budget_usd: 1, budget_warning_percent: 80, ai_enabled: true, coverage_enabled: true };
beforeEach(() => vi.resetAllMocks());
describe('usage policy', () => {
  it('allows unlimited, zero, and millidollar budgets', () => {
    expect(parseUsageSettings({ monthly_budget_usd: null })).toEqual({ monthly_budget_usd: null });
    expect(parseUsageSettings({ monthly_budget_usd: 0 })).toEqual({ monthly_budget_usd: 0 });
    expect(parseUsageSettings({ monthly_budget_usd: 0.003 })).toEqual({ monthly_budget_usd: 0.003 });
  });
  it.each([{ monthly_budget_usd: -1 }, { monthly_budget_usd: 10001 }, { monthly_budget_usd: '1' }, { monthly_budget_usd: NaN }, { monthly_budget_usd: 0.0001 }, { budget_warning_percent: 0 }, { budget_warning_percent: 80.5 }, { ai_enabled: 'true' }, null, []])('rejects invalid settings', (body) => expect(parseUsageSettings(body)).toBeNull());
  it('only maps allowed settings', () => expect(parseUsageSettings({ ai_enabled: false, coverage_enabled: true, stream_id: 'other' })).toEqual({ auto_summarize: false, coverage_search_enabled: true }));
  it('reports warning, limit, zero limit and unlimited accurately', () => {
    expect(usageAlert(usage)).toBe('warning');
    expect(usageAlert({ ...usage, estimated_usd: 1 })).toBe('limit');
    expect(usageAlert({ ...usage, estimated_usd: 0, monthly_budget_usd: 0 })).toBe('limit');
    expect(usageAlert({ ...usage, monthly_budget_usd: null })).toBeNull();
    expect(usageAlert({ ...usage, estimated_usd: 0.79 })).toBeNull();
  });
  it('reserves the actual targeted search request count', async () => {
    rpc.mockResolvedValue({ data: 'event-id', error: null });
    expect(await reservePaidUsage('owned-stream', 'coverage_search', 2)).toBe('event-id');
    expect(rpc).toHaveBeenCalledWith('reserve_paid_usage', expect.objectContaining({ p_stream_id: 'owned-stream', p_units: 2 }));
  });
  it('fails closed for missing ownership, RPC errors and exceptions', async () => {
    expect(await reservePaidUsage(null, 'ai_enrich')).toBeNull(); expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: 'failed' } });
    expect(await reservePaidUsage('s', 'ai_enrich')).toBeNull();
    rpc.mockRejectedValue(new Error('offline'));
    expect(await reservePaidUsage('s', 'ai_enrich')).toBeNull();
  });
});
