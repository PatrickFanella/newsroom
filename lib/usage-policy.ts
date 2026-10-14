export type UsageOverview = {
  month_start: string; month_end: string; summaries: number; searches: number; extractions: number;
  estimated_usd: number; monthly_budget_usd: number | null; budget_warning_percent: number;
  ai_enabled: boolean; coverage_enabled: boolean;
};
export function usageAlert(usage: UsageOverview): 'limit' | 'warning' | null {
  const budget = usage.monthly_budget_usd;
  if (budget === null) return null;
  if (usage.estimated_usd >= budget) return 'limit';
  return usage.estimated_usd >= budget * usage.budget_warning_percent / 100 ? 'warning' : null;
}
export function parseUsageSettings(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ('monthly_budget_usd' in value) {
    const budget = value.monthly_budget_usd;
    if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0 || budget > 10000 || Math.abs(budget * 1000 - Math.round(budget * 1000)) > 0.000001)) return null;
    patch.monthly_budget_usd = budget;
  }
  if ('budget_warning_percent' in value) {
    const percent = value.budget_warning_percent;
    if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 100) return null;
    patch.budget_warning_percent = percent;
  }
  for (const [key, column] of [['ai_enabled','auto_summarize'], ['coverage_enabled','coverage_search_enabled']]) {
    if (key in value) {
      if (typeof value[key] !== 'boolean') return null;
      patch[column] = value[key];
    }
  }
  return Object.keys(patch).length ? patch : null;
}

