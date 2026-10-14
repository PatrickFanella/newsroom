export const QUEUE_STATUSES = ['pending', 'approved', 'played', 'rejected'] as const;
export const QUEUE_MEDIA_KINDS = [
  ['article', 'Article'], ['youtube', 'YouTube video'], ['youtube_short', 'YouTube short'],
  ['youtube_playlist', 'YouTube playlist'], ['twitch_clip', 'Twitch clip'], ['twitch_vod', 'Twitch VOD'],
  ['twitter', 'Twitter / X'], ['tiktok', 'TikTok'], ['unknown', 'Other'],
] as const;
export type QueueMediaKind = typeof QUEUE_MEDIA_KINDS[number][0];
export type QueueSearch = { status: typeof QUEUE_STATUSES[number]; query: string; kind: QueueMediaKind | ''; before: string | null; beforeId: string | null };

/** Only moderator pagination opts into this contract; deck reads keep their ordering. */
export function parseQueueSearch(params: URLSearchParams): QueueSearch | null {
  if (!params.has('page')) return null;
  if (params.get('page') !== '1') throw new Error('Invalid queue page.');
  const status = params.get('status') ?? 'pending';
  if (!(QUEUE_STATUSES as readonly string[]).includes(status)) throw new Error('Invalid queue status.');
  const query = (params.get('q') ?? '').trim();
  if (query.length > 200) throw new Error('Search must be 200 characters or fewer.');
  const kind = params.get('kind') ?? '';
  if (kind && !QUEUE_MEDIA_KINDS.some(([value]) => value === kind)) throw new Error('Invalid media type.');
  const cursor = params.get('before');
  const [before, beforeId] = cursor?.split('|') ?? [];
  if (cursor !== null && (!before || !Number.isFinite(Date.parse(before)) || !/^\d{4}-\d{2}-\d{2}T/.test(before) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId ?? '') || cursor.split('|').length !== 2)) throw new Error('Invalid queue cursor.');
  return { status: status as QueueSearch['status'], query, kind: kind as QueueSearch['kind'], before: before ?? null, beforeId: beforeId ?? null };
}

export function queueSearchUrl(status: string, query: string, kind: string, cursor: string | null) {
  const params = new URLSearchParams({ page: '1', status });
  if (query) params.set('q', query);
  if (kind) params.set('kind', kind);
  if (cursor) params.set('before', cursor);
  return `/api/queue?${params}`;
}
