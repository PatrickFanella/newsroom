import { computePlayOrder } from './play-order';

export const MAX_VOD_OFFSET = 604800;
export const isBroadcastId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type BroadcastSummary = {
  id: string; title: string; started_at: string; ended_at: string | null;
  vod_url: string | null; vod_offset_seconds: number; note_count: number;
};
export type Broadcast = Omit<BroadcastSummary, 'note_count'> & {
  stream_id: string; updated_at: string;
  rundown: {
    ungrouped_position: number;
    segments: { id: string; name: string; position: number }[];
    items: { id: string; title: string | null; url: string; kind: string; segment_id: string | null; position: number | null; created_at: string }[];
  };
};
export function savedRundownOrder(broadcast: Broadcast) {
  const { items, segments, ungrouped_position } = broadcast.rundown;
  return computePlayOrder(items, segments, ungrouped_position);
}

export type BroadcastNote = {
  id: string; title: string | null; url: string; played_at: string;
  timestamp_offset_s: number | null; summary: string | null; takeaway: string | null; archive_url: string | null;
};
export type BroadcastDetail = { broadcast: Broadcast; notes: BroadcastNote[] };

export function normalizeVodUrl(raw: unknown): string | null {
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return null;
  if (typeof raw !== 'string') throw new Error('Enter a Twitch VOD or YouTube video URL.');
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Enter a valid VOD URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS video URL.');
  const host = url.hostname.toLowerCase();
  if (['twitch.tv', 'www.twitch.tv'].includes(host) && /^\/videos\/\d+\/?$/.test(url.pathname)) {
    return `https://www.twitch.tv${url.pathname.replace(/\/$/, '')}`;
  }
  let videoId: string | null = null;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host) && url.pathname === '/watch') videoId = url.searchParams.get('v');
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host) && /^\/live\/[\w-]{11}\/?$/.test(url.pathname)) videoId = url.pathname.split('/')[2];
  if (host === 'youtu.be') videoId = url.pathname.slice(1).replace(/\/$/, '');
  if (videoId && /^[\w-]{11}$/.test(videoId)) return `https://www.youtube.com/watch?v=${videoId}`;
  throw new Error('Use a Twitch /videos/ URL or a YouTube video URL.');
}

export function validateBroadcastPatch(body: unknown): { title?: string; vod_url?: string | null; vod_offset_seconds?: number } {
  if (!body || typeof body !== 'object') throw new Error('Invalid show settings.');
  const input = body as Record<string, unknown>;
  const patch: ReturnType<typeof validateBroadcastPatch> = {};
  if ('title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160) throw new Error('Use a show title between 1 and 160 characters.');
    patch.title = input.title.trim();
  }
  if ('vodUrl' in input) patch.vod_url = normalizeVodUrl(input.vodUrl);
  if ('vodOffsetSeconds' in input) {
    if (typeof input.vodOffsetSeconds !== 'number' || !Number.isInteger(input.vodOffsetSeconds) || input.vodOffsetSeconds < 0 || input.vodOffsetSeconds > MAX_VOD_OFFSET) throw new Error('Use a VOD offset from 0 to 604800 seconds.');
    patch.vod_offset_seconds = input.vodOffsetSeconds;
  }
  if (Object.keys(patch).length === 0) throw new Error('No show settings were supplied.');
  return patch;
}

export function chapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${String(minutes).padStart(2, '0')}:${secs}`;
}

export function vodChapterUrl(broadcast: Pick<Broadcast, 'vod_url' | 'vod_offset_seconds'>, offset: number | null): string | null {
  if (!broadcast.vod_url || offset === null || !Number.isFinite(offset)) return null;
  const seconds = Math.max(0, Math.floor(offset + broadcast.vod_offset_seconds));
  let normalized: string | null;
  try { normalized = normalizeVodUrl(broadcast.vod_url); } catch { return null; }
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.hostname === 'www.twitch.tv') {
    url.searchParams.set('t', `${Math.floor(seconds / 3600)}h${Math.floor(seconds % 3600 / 60)}m${seconds % 60}s`);
  } else url.searchParams.set('t', `${seconds}s`);
  return url.toString();
}

const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
const markdownText = (text: string) => oneLine(text).replace(/[\\[\]*_`]/g, '\\$&');

export function broadcastChapterText({ broadcast, notes }: BroadcastDetail): string {
  const chapters = new Map<number, string[]>();
  for (const note of notes) {
    if (note.timestamp_offset_s === null) continue;
    const seconds = Math.max(0, note.timestamp_offset_s + broadcast.vod_offset_seconds);
    const title = oneLine(note.title || note.url);
    // Several items can be marked played in one second. Preserve their titles
    // in one chapter instead of exporting duplicate timestamp lines.
    if (chapters.has(seconds)) chapters.get(seconds)!.push(title);
    else chapters.set(seconds, [title]);
  }
  if (!chapters.has(0)) chapters.set(0, [broadcast.vod_offset_seconds > 0 ? 'Recording begins' : oneLine(broadcast.title)]);
  if (broadcast.vod_offset_seconds > 0 && !chapters.has(broadcast.vod_offset_seconds)) chapters.set(broadcast.vod_offset_seconds, [oneLine(broadcast.title)]);
  return [...chapters.entries()].sort(([a], [b]) => a - b).map(([time, titles]) => `${chapterTime(time)} ${titles.join(' / ')}`).join('\n') + '\n';
}

export function broadcastMarkdown(detail: BroadcastDetail): string {
  const { broadcast, notes } = detail;
  const lines = [`# ${markdownText(broadcast.title)}`, '', `Started ${broadcast.started_at}`, broadcast.ended_at ? `Ended ${broadcast.ended_at}` : 'Show is still active', ''];
  if (broadcast.vod_url) lines.push(`[Watch the recording](${broadcast.vod_url})`, '');
  for (const note of notes) {
    const title = markdownText(note.title || note.url);
    const offset = note.timestamp_offset_s;
    const link = vodChapterUrl(broadcast, offset);
    const stamp = offset === null ? '' : `${chapterTime(offset + broadcast.vod_offset_seconds)} · `;
    lines.push(`## ${link ? `[${stamp}${title}](${link})` : stamp + title}`, '', `[Source](${note.url})`, '');
    if (note.archive_url) lines.push(`[Archived snapshot](${note.archive_url})`, '');
    if (note.summary) lines.push(note.summary, '');
    if (note.takeaway) lines.push(`> ${note.takeaway}`, '');
  }
  return lines.join('\n');
}
