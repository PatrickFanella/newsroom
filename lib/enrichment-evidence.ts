export type EvidenceSource = 'page_metadata' | 'transcript' | 'description' | 'post_text' | 'unavailable';
export type EnrichmentEvidence = {
  version: 1; checked_at: string; source: EvidenceSource; input_characters: number;
  outcome: 'metadata_only' | 'succeeded' | 'skipped' | 'failed' | 'refused' | 'invalid_response';
  model?: string; retrieval?: 'retrieved' | 'failed' | 'not_observed';
  retrieved_url?: string; retrieved_at?: string;
};
export function inputEvidence(source: EvidenceSource, text: string | null | undefined, outcome: EnrichmentEvidence['outcome'] = 'metadata_only'): EnrichmentEvidence {
  return { version: 1, checked_at: new Date().toISOString(), source, input_characters: Math.min(text?.length ?? 0, 5500), outcome };
}
export function observedPageFetch(blocks: unknown[]): Pick<EnrichmentEvidence, 'retrieval' | 'retrieved_url' | 'retrieved_at'> {
  let failed = false;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const value = block as { type?: string; content?: { type?: string; url?: unknown; retrieved_at?: unknown } };
    if (value.type !== 'web_fetch_tool_result') continue;
    if (value.content?.type === 'web_fetch_tool_result_error') failed = true;
    if (value.content?.type === 'web_fetch_result') {
      let url: URL;
      try { url = new URL(String(value.content.url)); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      return { retrieval: 'retrieved', retrieved_url: url.toString(), ...(typeof value.content.retrieved_at === 'string' && Number.isFinite(Date.parse(value.content.retrieved_at)) ? { retrieved_at: value.content.retrieved_at } : {}) };
    }
  }
  return { retrieval: failed ? 'failed' : 'not_observed' };
}
export function evidenceLabel(evidence: EnrichmentEvidence | null | undefined): string {
  if (!evidence || evidence.version !== 1) return 'Input not recorded';
  if (evidence.retrieval === 'retrieved') return 'Page retrieved by provider';
  return { page_metadata: 'Page metadata only', transcript: 'Video transcript and metadata', description: 'Description or caption only', post_text: 'Post text', unavailable: 'Content unavailable' }[evidence.source] ?? 'Input not recorded';
}
