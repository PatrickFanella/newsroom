import { describe, expect, it } from 'vitest';
import { evidenceLabel, inputEvidence, observedPageFetch } from './enrichment-evidence';
describe('observable enrichment inputs', () => {
  it('bounds supplied text counts without retaining the content', () => {
    const evidence = inputEvidence('transcript', 'x'.repeat(9000));
    expect(evidence.input_characters).toBe(5500); expect(evidence).not.toHaveProperty('text');
  });
  it('does not infer successful fetching from a model’s own text or a tool request', () => {
    expect(observedPageFetch([{ type: 'text', text: 'I read the full article.' }, { type: 'server_tool_use', name: 'web_fetch' }])).toEqual({ retrieval: 'not_observed' });
  });
  it('records actual successful tool results and retrieval time', () => {
    expect(observedPageFetch([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://example.com/article', retrieved_at: '2026-10-14T00:00:00Z' } }])).toEqual({ retrieval: 'retrieved', retrieved_url: 'https://example.com/article', retrieved_at: '2026-10-14T00:00:00Z' });
  });
  it('distinguishes failed fetches from unobserved ones', () => {
    expect(observedPageFetch([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } }])).toEqual({ retrieval: 'failed' });
  });
  it.each(['javascript:alert(1)', 'https://user:secret@example.com/article'])('does not expose unsafe provider URLs: %s', (url) => {
    expect(observedPageFetch([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url } }])).toEqual({ retrieval: 'not_observed' });
  });
  it('labels server-extracted page text separately from provider browsing', () => {
    expect(evidenceLabel({...inputEvidence('page_text','Page text'),retrieval:'retrieved'})).toBe('Page text retrieved by server');
    expect(evidenceLabel({...inputEvidence('page_metadata','Description'),retrieval:'retrieved'})).toBe('Page retrieved by provider');
  });
  it('keeps historical unknown provenance separate from observed metadata', () => {
    expect(evidenceLabel(null)).toBe('Input not recorded');
    expect(evidenceLabel(inputEvidence('page_metadata', 'Description'))).toBe('Page metadata only');
  });
});
