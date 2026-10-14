import type { BroadcastFilters } from './broadcast-search';
import type { BroadcastDetail, BroadcastSummary } from './broadcast';

export type BroadcastPage = { broadcasts: BroadcastSummary[]; nextCursor: string | null };

export async function loadBroadcasts(cursor: string | null = null, active = false, filters: BroadcastFilters = {}): Promise<BroadcastPage> {
  const params = new URLSearchParams();
  if (cursor) params.set('before', cursor);
  if (active) params.set('active', '1');
  for (const [key,value] of Object.entries(filters)) if (value) params.set(key,value);
  const response = await fetch(`/api/broadcasts?${params}`);
  if (!response.ok) throw new Error('Could not load shows.');
  const data = await response.json();
  return { broadcasts: data.broadcasts ?? [], nextCursor: data.nextCursor ?? null };
}

export async function loadBroadcast(id: string): Promise<BroadcastDetail> {
  const response = await fetch(`/api/broadcasts/${id}`);
  if (!response.ok) throw new Error(response.status === 404 ? 'Show not found.' : 'Could not load this show.');
  return response.json();
}

export async function saveBroadcast(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<void> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Could not save the show.');
  }
}
