import { describe, expect, it } from 'vitest';
import { parseQueueSearch, queueSearchUrl } from './queue-search';
const params = (query: string) => new URLSearchParams(query);
describe('queue search contract', () => {
  it('leaves existing unpaged deck requests alone', () => {
    expect(parseQueueSearch(params('status=approved'))).toBeNull();
  });
  it('defaults paged reads to pending and trims literal search text', () => {
    expect(parseQueueSearch(params('page=1&q=++100%25_under%5C++'))).toEqual({ status: 'pending', query: '100%_under\\', kind: '', before: null, beforeId: null });
  });
  it('accepts a microsecond cursor without rounding it through a JS Date', () => {
    const before = '2026-10-14T00:00:00.123456Z'; const beforeId = '00000000-0000-4000-8000-000000000001';
    expect(parseQueueSearch(params(`page=1&status=played&kind=article&before=${before}%7C${beforeId}`))).toEqual({ status: 'played', query: '', kind: 'article', before, beforeId });
  });
  it.each(['page=2', 'page=1&status=foreign', 'page=1&kind=video', `page=1&q=${'x'.repeat(201)}`, 'page=1&before=', 'page=1&before=invalid', 'page=1&before=2026-10-14T00:00:00Z%7Cbad', 'page=1&before=2026-10-14T00:00:00Z%7C00000000-0000-4000-8000-000000000001%7Cextra'])('rejects malformed filters/cursors: %s', (query) => {
    expect(() => parseQueueSearch(params(query))).toThrow();
  });
  it('encodes filters and cursors without treating them as query syntax', () => {
    const url = new URL(queueSearchUrl('pending', 'budget & news + 100%', 'article', 'timestamp|id'), 'http://localhost');
    expect(url.searchParams.get('q')).toBe('budget & news + 100%');
    expect(url.searchParams.get('kind')).toBe('article'); expect(url.searchParams.get('before')).toBe('timestamp|id');
  });
});
