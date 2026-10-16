'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MODERATION_ACTIONS, type ModerationAction } from '@/lib/moderation-history';
export function ModerationHistory({ displayName }: { displayName:string }) {
 const [draft,setDraft]=useState(''); const [query,setQuery]=useState(''); const [action,setAction]=useState('');
 const history=useInfiniteQuery({ queryKey:['moderation-history',query,action],initialPageParam:null as string | null,
  queryFn:async({pageParam}):Promise<{actions:ModerationAction[];nextCursor:string|null}>=>{const params=new URLSearchParams({q:query,action});if(pageParam)params.set('cursor',pageParam);const r=await fetch('/api/moderation-history?'+params);if(!r.ok)throw new Error('History could not be loaded');return r.json();},
  getNextPageParam:page=>page.nextCursor ?? undefined });
 const rows=Array.from(new Map((history.data?.pages.flatMap(p=>p.actions) || []).map(a=>[a.id,a])).values());
 return <div className="min-h-screen"><AppHeader section="moderation history" className="border-b-2 border-ink px-6 py-3 gap-4" right={<><Link href="/mod" className="underline">Mod View</Link><Link href="/shelf" className="underline">Shelf</Link><span>{displayName}</span></>}/>
  <main className="max-w-4xl mx-auto px-6 py-8 space-y-5"><h1 className="font-display text-3xl font-bold">Moderator activity</h1>
   <p className="text-sm text-ink/60">Approvals, edits, and review claims recorded from feature activation onward. Queue cleanup retains these records. Changes without an authenticated actor are labeled explicitly.</p>
   <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setQuery(draft.trim());}}><Input className="flex-1 min-w-0" aria-label="Search activity" placeholder="Story, URL, or moderator…" value={draft} maxLength={200} onChange={e=>setDraft(e.target.value)}/><Button type="submit">Search</Button><label className="text-sm">Action <select aria-label="Activity action" className="border border-ink/30 bg-transparent p-2" value={action} onChange={e=>setAction(e.target.value)}><option value="">All actions</option>{MODERATION_ACTIONS.map(a=><option key={a} value={a}>{a.replaceAll('_',' ')}</option>)}</select></label></form>
   <Button variant="outline" size="sm" onClick={()=>history.refetch()} disabled={history.isFetching}>Refresh history</Button>
   {history.isPending && <p role="status">Loading activity…</p>}{history.isError && <p role="alert">History could not be loaded. Refresh to retry.</p>}
   {!history.isPending && !history.isError && rows.length===0 && <p>No activity matches these filters.</p>}
   <ol className="space-y-3">{rows.map(row=><li key={row.id} className="border border-ink/20 p-4 space-y-1"><p className="font-mono text-xs">{row.actor_name} · {row.action.replaceAll('_',' ')} · {new Date(row.created_at).toLocaleString()}</p><p className="font-display text-lg font-bold break-words">{row.title || row.url || 'Removed story'}</p>{row.previous_status !== row.next_status && <p className="text-sm">{row.previous_status} → {row.next_status || 'removed'}</p>}{row.changed_fields.length>0 && <p className="text-xs text-ink/60">Changed: {row.changed_fields.join(', ')}</p>}</li>)}</ol>
   {history.hasNextPage && <Button onClick={()=>history.fetchNextPage()} disabled={history.isFetchingNextPage}>Load older activity</Button>}
  </main></div>;
}
