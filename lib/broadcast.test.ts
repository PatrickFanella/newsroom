import { describe, expect, it } from 'vitest';
import { broadcastChapterText, broadcastMarkdown, chapterTime, savedRundownOrder, normalizeVodUrl, validateBroadcastPatch, vodChapterUrl, type BroadcastDetail } from './broadcast';

const detail: BroadcastDetail = {
  broadcast: { id: 'show-1', stream_id: 'stream-1', title: 'Evening desk', started_at: '2026-10-14T00:00:00Z', ended_at: '2026-10-14T01:00:00Z', vod_url: 'https://www.twitch.tv/videos/123456789', vod_offset_seconds: 300, updated_at: '2026-10-14T01:00:00Z', rundown: { segments: [], items: [], ungrouped_position: 0 } },
  notes: [{ id: 'note-1', title: 'Budget vote', url: 'https://example.com/budget', played_at: '2026-10-14T00:01:30Z', timestamp_offset_s: 90, summary: 'A summary', takeaway: 'A takeaway', archive_url: null }],
};

describe('broadcast settings and VOD links', () => {
  it.each([
    ['https://twitch.tv/videos/123456789?t=2h&foo=bar', 'https://www.twitch.tv/videos/123456789'],
    ['https://youtu.be/abcdefghijk?si=tracking&t=10', 'https://www.youtube.com/watch?v=abcdefghijk'],
    ['https://www.youtube.com/watch?v=abcdefghijk&list=playlist&t=30', 'https://www.youtube.com/watch?v=abcdefghijk'],
    ['https://www.youtube.com/live/abcdefghijk?feature=share', 'https://www.youtube.com/watch?v=abcdefghijk'],
  ])('normalizes %s to the recording without inherited playback context', (input, output) => {
    expect(normalizeVodUrl(input)).toBe(output);
  });

  it.each(['http://twitch.tv/videos/123', 'https://twitch.tv/channel', 'https://twitch.tv.evil.example/videos/123', 'https://user:password@twitch.tv/videos/123', 'https://youtube.com:8443/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://youtube.com/watch?v=short'])('rejects unsupported or unsafe recording URL %s', (url) => {
    expect(() => normalizeVodUrl(url)).toThrow();
  });

  it('allows clearing a recording URL', () => {
    expect(normalizeVodUrl(' ')).toBeNull();
    expect(validateBroadcastPatch({ vodUrl: null })).toEqual({ vod_url: null });
  });

  it('validates editable fields without accepting channel ownership or rundown changes', () => {
    expect(validateBroadcastPatch({ title: '  Evening desk  ', vodOffsetSeconds: 300, stream_id: 'foreign', rundown: {} })).toEqual({ title: 'Evening desk', vod_offset_seconds: 300 });
  });

  it.each([{ title: '' }, { title: 'x'.repeat(161) }, { vodOffsetSeconds: -1 }, { vodOffsetSeconds: 1.5 }, { vodOffsetSeconds: '30' }, { vodOffsetSeconds: 604801 }, {}])('rejects invalid metadata %j', (input) => {
    expect(() => validateBroadcastPatch(input)).toThrow();
  });

  it('adds the configured VOD origin to the recorded play offset', () => {
    expect(vodChapterUrl(detail.broadcast, 90)).toBe('https://www.twitch.tv/videos/123456789?t=0h6m30s');
    expect(vodChapterUrl({ vod_url: 'https://youtu.be/abcdefghijk', vod_offset_seconds: 300 }, 90)).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=390s');
  });

  it('does not invent a chapter link when timing or a recording is unavailable', () => {
    expect(vodChapterUrl(detail.broadcast, null)).toBeNull();
    expect(vodChapterUrl({ vod_url: null, vod_offset_seconds: 0 }, 90)).toBeNull();
  });

  it.each([[0, '00:00'], [90, '01:30'], [3661, '1:01:01']])('formats %i seconds', (seconds, expected) => {
    expect(chapterTime(seconds as number)).toBe(expected);
  });

  it('exports ordered, unique chapter timestamps and retains stories played in the same second', () => {
    const second = { ...detail.notes[0], id: 'note-2', title: 'Another story\nwith a newline' };
    const chapters = broadcastChapterText({ ...detail, notes: [detail.notes[0], second] });
    expect(chapters).toBe('00:00 Recording begins\n05:00 Evening desk\n06:30 Budget vote / Another story with a newline\n');
  });

  it('preserves a real story whose title matches the show title at the opening timestamp', () => {
    const broadcast = { ...detail.broadcast, vod_offset_seconds: 0 };
    const notes = [{ ...detail.notes[0], title: broadcast.title, timestamp_offset_s: 0 }, { ...detail.notes[0], id: 'note-2', title: 'Another story', timestamp_offset_s: 0 }];
    expect(broadcastChapterText({ broadcast, notes })).toBe('00:00 Evening desk / Another story\n');
  });

  it('exports this show’s source, summary, takeaway, and recording chapter', () => {
    const markdown = broadcastMarkdown(detail);
    expect(markdown).toContain('[06:30 · Budget vote](https://www.twitch.tv/videos/123456789?t=0h6m30s)');
    expect(markdown).toContain('[Source](https://example.com/budget)');
    expect(markdown).toContain('A summary');
    expect(markdown).toContain('> A takeaway');
  });
});


describe('saved rundown order', () => {
  it('retains deck block order, including ungrouped items and newest-first ties', () => {
    const item = (id: string, segment_id: string | null, position: number | null, created_at = '2026-10-14T00:00:00Z') => ({ id, title: id, url: 'https://example.com', kind: 'article', segment_id, position, created_at });
    const broadcast = { ...detail.broadcast, rundown: { ungrouped_position: 1, segments: [{ id: 'later', name: 'Later', position: 2 }, { id: 'first', name: 'First', position: 0 }], items: [item('later-item', 'later', 0), item('first-item', 'first', null), item('older', null, 0), item('newer', null, 0, '2026-10-14T01:00:00Z'), item('orphan', 'deleted', 1)] } };
    expect(savedRundownOrder(broadcast).map(item => item.id)).toEqual(['first-item', 'newer', 'older', 'orphan', 'later-item']);
    expect(broadcast.rundown.items[0].id).toBe('later-item');
  });
});
