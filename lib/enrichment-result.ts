import type { EnrichmentResult } from './enrich';
import type { EnrichmentEvidence } from './enrichment-evidence';

export function parseEnrichmentResult(text: string, hostRisk: 'low' | 'medium' | 'high', evidence: EnrichmentEvidence): EnrichmentResult {
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.summary !== 'string' || !parsed.summary.trim()) throw new Error('Invalid enrichment result');
  const modelRisk = ['low', 'medium', 'high'].includes(String(parsed.dmca_risk)) ? parsed.dmca_risk as typeof hostRisk : 'low';
  const order = { low: 0, medium: 1, high: 2 };
  return {
    summary: parsed.summary,
    credibility: typeof parsed.credibility === 'string' ? parsed.credibility : null,
    topics: Array.isArray(parsed.topics) ? parsed.topics.filter((topic): topic is string => typeof topic === 'string').slice(0, 6) : [],
    dmcaRisk: order[modelRisk] > order[hostRisk] ? modelRisk : hostRisk,
    contentWarning: parsed.content_warning === true,
    evidence: { ...evidence, outcome: 'succeeded' },
  };
}
