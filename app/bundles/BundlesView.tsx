'use client';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
type Page = { bundles: { id: string; title: string; created_at: string; lead_submission_id: string | null }[]; nextCursor: string | null };
export function BundlesView({ streamId }: { streamId: string }) {
  const query = useInfiniteQuery({ queryKey:['bundles',streamId],initialPageParam:null as string | null,queryFn:async({pageParam}):Promise<Page>=>{
    const response=await fetch('/api/bundles'+(pageParam?'?before='+encodeURIComponent(pageParam):''));if(!response.ok)throw new Error('Could not load story bundles.');return response.json();
  },getNextPageParam:page=>page.nextCursor??undefined });
  const bundles=query.data?.pages.flatMap(page=>page.bundles)??[];
  return <div className="min-h-screen"><AppHeader section="story bundles" className="border-b-2 border-ink px-4 sm:px-6 py-3 gap-4 [&>div]:flex-wrap [&>div]:max-w-full" right={<><Link className="underline" href="/deck">Deck</Link><Link className="underline" href="/broadcasts">Shows</Link></>} />
    <main className="max-w-4xl mx-auto p-4 sm:p-6"><h1 className="font-display text-3xl font-bold mb-3">Story bundles</h1><p className="text-sm text-ink/60 mb-6">Create a bundle from a pending moderator card or an approved deck item. Supporting links stay together with the lead story.</p>
      {query.isPending?<p>Loading bundles…</p>:query.isError?<div role="alert"><p>{query.error.message}</p><Button size="sm" variant="outline" onClick={()=>query.refetch()}>Retry bundles</Button></div>:bundles.length===0?<p>No story bundles yet.</p>:<ul className="divide-y divide-ink/20">{bundles.map(bundle=><li key={bundle.id} className="py-3"><Link className="font-display text-xl font-bold underline break-words" href={`/bundles/${bundle.id}`}>{bundle.title}</Link><p className="font-mono text-xs text-ink/60 mt-1">{new Date(bundle.created_at).toLocaleString()}{!bundle.lead_submission_id&&' · Lead item cleared'}</p></li>)}</ul>}
      {query.hasNextPage&&<Button className="mt-4" variant="outline" disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>Load older bundles</Button>}
    </main></div>;
}
