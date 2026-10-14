'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { loadBroadcasts, saveBroadcast } from '@/lib/broadcast-client';
import { queryKeys } from '@/lib/query-keys';
import { useRealtimeChannel } from '@/lib/use-realtime-channel';

export function BroadcastControls({ streamId, canManage, listen = true }: { streamId: string; canManage: boolean; listen?: boolean }) {
  const client = useQueryClient();
  const key = [...queryKeys.broadcasts(streamId), 'active'];
  const [title, setTitle] = useState('');
  const query = useQuery({ queryKey: key, queryFn: () => loadBroadcasts(null, true), refetchInterval: 30_000 });
  const active = query.data?.broadcasts[0];
  useRealtimeChannel(listen ? `broadcasts:${streamId}` : null, () => client.invalidateQueries({ queryKey: queryKeys.broadcasts(streamId) }));
  const mutation = useMutation({
    mutationFn: (body: unknown) => saveBroadcast('/api/broadcasts', 'POST', body),
    onSuccess: () => setTitle(''),
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.broadcasts(streamId) });
      client.invalidateQueries({ queryKey: ['broadcast', streamId] });
    },
  });

  return (
    <section aria-label="Broadcast session" className="border-b border-ink/20 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">Show</span>
        {query.isPending ? <span className="text-sm text-ink/50">Loading show status…</span>
          : query.isError ? <><span role="alert" className="text-sm text-rust">Could not load show status.</span><Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button></>
          : active ? <>
            <Link href={`/broadcasts/${active.id}`} className="font-display font-bold underline min-w-0 break-words">{active.title}</Link>
            <span className="font-mono text-xs text-moss">Active</span>
            {canManage && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'end', id: active.id })}>End show</Button>}
          </> : canManage ? (
            <form className="flex flex-wrap items-center gap-2 min-w-0" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending && title.trim()) mutation.mutate({ action: 'start', title: title.trim() }); }}>
              <Input aria-label="New show title" value={title} maxLength={160} placeholder="Evening news…" onChange={(event) => setTitle(event.target.value)} disabled={mutation.isPending} className="w-52 max-w-full" />
              <Button type="submit" size="sm" disabled={mutation.isPending || !title.trim()}>Start show</Button>
            </form>
          ) : <span className="text-sm text-ink/50">No active show</span>}
        <Link href="/broadcasts" className="ml-auto font-mono text-xs underline hover:text-rust">Show history</Link>
      </div>
      {mutation.isError && <p role="alert" className="text-sm text-rust mt-2">{mutation.error.message}</p>}
    </section>
  );
}
