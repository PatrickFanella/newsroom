'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { BroadcastControls } from '@/components/BroadcastControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadBroadcast, loadBroadcasts, saveBroadcast } from '@/lib/broadcast-client';
import { chapterTime, savedRundownOrder, vodChapterUrl, type Broadcast } from '@/lib/broadcast';
import { ShowDiscordExport } from './ShowDiscordExport';
import { queryKeys } from '@/lib/query-keys';
import { useRealtimeChannel } from '@/lib/use-realtime-channel';

function RecordingSettings({ broadcast, streamId }: { broadcast: Broadcast; streamId: string }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(broadcast.title);
  const [vod, setVod] = useState(broadcast.vod_url ?? '');
  const [offset, setOffset] = useState(String(broadcast.vod_offset_seconds));
  const mutation = useMutation({
    mutationFn: () => saveBroadcast(`/api/broadcasts/${broadcast.id}`, 'PATCH', { title, vodUrl: vod, vodOffsetSeconds: Number(offset) }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.broadcasts(streamId) });
      client.invalidateQueries({ queryKey: queryKeys.broadcast(streamId, broadcast.id) });
    },
  });
  return <form aria-label="Recording settings" className="border-y border-ink/20 py-4 my-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); }}>
    <label className="block text-sm">Show title<Input className="block w-full mt-1" value={title} maxLength={160} required onChange={(event) => { setTitle(event.target.value); mutation.reset(); }} /></label>
    <label className="block text-sm">Recording URL<Input type="url" className="block w-full mt-1" value={vod} placeholder="Twitch VOD or YouTube video URL" onChange={(event) => { setVod(event.target.value); mutation.reset(); }} /></label>
    <label className="block text-sm">VOD time when this show started (seconds)<Input type="number" min={0} max={604800} step={1} required className="block w-32 mt-1" value={offset} onChange={(event) => { setOffset(event.target.value); mutation.reset(); }} /></label>
    <p className="text-xs text-ink/60">Use 0 if you started the show at the beginning of the recording. Use 300 if the recording was already five minutes in.</p>
    <Button type="submit" size="sm" disabled={mutation.isPending}>Save recording settings</Button>
    {mutation.isError && <p role="alert" className="text-sm text-rust">{mutation.error.message}</p>}
    {mutation.isSuccess && <p role="status" className="text-sm text-moss">Recording settings saved.</p>}
  </form>;
}

export function BroadcastsView({ streamId, canManage, displayName, broadcastId }: { streamId: string; canManage: boolean; displayName: string; broadcastId?: string }) {
  const client = useQueryClient();
  const [search,setSearch]=useState('');
  const [filters,setFilters]=useState({ q:'',state:'all',from:'',until:'' });
  const history = useInfiniteQuery({
    queryKey: [...queryKeys.broadcasts(streamId), 'history',filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => loadBroadcasts(pageParam,false,filters),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const detail = useQuery({ queryKey: queryKeys.broadcast(streamId, broadcastId ?? ''), queryFn: () => loadBroadcast(broadcastId!), enabled: !!broadcastId, refetchInterval: 30_000 });
  useRealtimeChannel(`broadcasts:${streamId}`, () => {
    client.invalidateQueries({ queryKey: queryKeys.broadcasts(streamId) });
    client.invalidateQueries({ queryKey: ['broadcast', streamId] });
  });
  const shows = history.data?.pages.flatMap((page) => page.broadcasts) ?? [];
  const broadcast = detail.data?.broadcast;
  const notes = detail.data?.notes ?? [];

  return <div className="min-h-screen flex flex-col">
    <AppHeader section="shows" className="border-b-2 border-ink px-4 sm:px-6 py-3 gap-4" right={<><Link href="/deck" className="underline hover:text-rust">Deck</Link><Link href="/shelf" className="underline hover:text-rust">Shelf</Link><span>{displayName}</span></>} />
    <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <BroadcastControls streamId={streamId} canManage={canManage} listen={false} />
      <div className="grid lg:grid-cols-[18rem_1fr] gap-8">
        <section aria-label="Show history" className={broadcastId ? "order-2 lg:order-1" : "order-1"}>
          {broadcastId ? <h2 className="font-display text-2xl font-bold mb-3">Show history</h2> : <h1 className="font-display text-2xl font-bold mb-3">Show history</h1>}
          <form className="space-y-2 mb-4" onSubmit={event=>{event.preventDefault();setFilters({...filters,q:search.trim()});}}>
            <Input className="block w-full" aria-label="Search shows and stories" placeholder="Show title, covered story, or URL…" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/>
            <label className="block text-xs">Show status <select className="border border-ink/20 bg-transparent p-1" value={filters.state} onChange={event=>setFilters({...filters,state:event.target.value})}><option value="all">All shows</option><option value="ended">Ended</option><option value="active">Active</option></select></label>
            <div className="flex flex-wrap gap-2 text-xs"><label>From (UTC)<Input className="block w-32" type="date" value={filters.from} onChange={event=>setFilters({...filters,from:event.target.value})}/></label><label>Through (UTC)<Input className="block w-32" type="date" value={filters.until} onChange={event=>setFilters({...filters,until:event.target.value})}/></label></div>
            <Button size="sm" type="submit">Search shows</Button>
          </form>
          {history.isPending ? <p className="text-sm text-ink/60">Loading shows…</p> : history.isError ? <><p role="alert" className="text-rust text-sm">Could not load show history.</p><Button size="sm" variant="outline" onClick={() => history.refetch()}>Retry history</Button></> : shows.length === 0 ? <p className="text-sm text-ink/60">No shows match these filters. Start a show to begin recording history.</p> : <ul className="divide-y divide-ink/20 border-y border-ink/20">
            {shows.map((show) => <li key={show.id} className="py-3"><Link href={`/broadcasts/${show.id}`} aria-current={show.id === broadcastId ? 'page' : undefined} className="block hover:text-rust break-words"><span className="font-display font-bold">{show.title}</span><span className="block font-mono text-xs text-ink/60 mt-1">{new Date(show.started_at).toLocaleString()} · {show.note_count} covered{!show.ended_at && ' · Active'}</span></Link></li>)}
          </ul>}
          {history.hasNextPage && <Button size="sm" variant="outline" className="mt-3" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load older shows</Button>}
        </section>
        <section aria-label="Show detail" className={broadcastId ? "min-w-0 order-1 lg:order-2" : "min-w-0 order-2"}>
          {!broadcastId ? <p className="text-ink/60 text-sm py-8">Choose a show to see its covered stories, recording links, and saved rundown.</p> : detail.isPending ? <p className="text-sm text-ink/60">Loading show…</p> : detail.isError ? <><p role="alert" className="text-sm text-rust">{detail.error.message}</p><Button size="sm" variant="outline" onClick={() => detail.refetch()}>Retry show</Button></> : broadcast ? <>
            <h1 className="font-display text-3xl font-black leading-tight break-words">{broadcast.title}</h1>
            <p className="font-mono text-xs text-ink/60 mt-2">Started {new Date(broadcast.started_at).toLocaleString()} · {broadcast.ended_at ? `Ended ${new Date(broadcast.ended_at).toLocaleString()}` : 'Active show'}</p>
            {canManage && <RecordingSettings key={broadcast.id} broadcast={broadcast} streamId={streamId} />}
            <div className="flex flex-wrap gap-4 my-4 text-sm underline">
              <a href={`/api/broadcasts/${broadcast.id}?format=markdown`}>Download show notes</a>
              <a href={`/api/broadcasts/${broadcast.id}?format=chapters`}>Download chapter timestamps</a>
              {broadcast.vod_url && <a href={broadcast.vod_url} target="_blank" rel="noreferrer">Watch recording ↗</a>}
            </div>
            {canManage && broadcast.ended_at && <ShowDiscordExport key={broadcast.id} id={broadcast.id}/>}
            <h3 className="font-display text-xl font-bold mt-6 mb-3">Covered stories</h3>
            {notes.length === 0 ? <p className="text-sm text-ink/60">No items marked played in this show yet.</p> : <ol className="space-y-5">
              {notes.map((note) => {
                const chapter = vodChapterUrl(broadcast, note.timestamp_offset_s);
                const stamp = note.timestamp_offset_s === null ? null : chapterTime(note.timestamp_offset_s + (chapter ? broadcast.vod_offset_seconds : 0));
                return <li key={note.id} className="border-l-2 border-ink/20 pl-4">
                  <h4 className="font-display text-lg font-bold break-words">{note.title || note.url}</h4>
                  <div className="flex flex-wrap gap-3 font-mono text-xs my-1">
                    {chapter ? <a className="underline" href={chapter} target="_blank" rel="noreferrer">{stamp} in recording ↗</a> : stamp && <span>{stamp} from show start</span>}
                    <a className="underline" href={note.url} target="_blank" rel="noreferrer">Source ↗</a>
                    {note.archive_url && <a className="underline" href={note.archive_url} target="_blank" rel="noreferrer">Archived snapshot ↗</a>}
                  </div>
                  {note.summary && <p className="text-sm whitespace-pre-line mt-2">{note.summary}</p>}
                  {note.takeaway && <blockquote className="text-sm text-ink/70 whitespace-pre-line mt-2">{note.takeaway}</blockquote>}
                </li>;
              })}
            </ol>}
            <details className="border-t border-ink/20 mt-8 pt-4"><summary className="cursor-pointer font-display text-lg font-bold">Rundown saved at show start · {broadcast.rundown.items.length} items</summary>
              <ul className="space-y-2 mt-3 text-sm">{savedRundownOrder(broadcast).map((item) => <li key={item.id}><a className="underline break-words" href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a><span className="text-ink/50"> · {broadcast.rundown.segments.find((segment) => segment.id === item.segment_id)?.name || 'Ungrouped'}</span></li>)}</ul>
              {broadcast.rundown.items.length === 0 && <p className="text-sm text-ink/60 mt-2">The deck was empty when this show started.</p>}
            </details>
          </> : null}
        </section>
      </div>
    </main>
  </div>;
}
