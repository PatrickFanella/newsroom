'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from './ui/button';
import { bundleRoleLabel, type BundleSnapshot, type BundleDetail } from '@/lib/story-bundles';

export async function loadStoryBundle(id: string): Promise<BundleDetail> {
  const response = await fetch(`/api/bundles/${id}`);
  if (!response.ok) throw new Error(response.status === 404 ? 'Story bundle not found.' : 'Could not load story bundle.');
  return response.json();
}
export function BundleContext({ bundle }: { bundle: BundleSnapshot }) {
  return <div className="border-l-2 border-ochre pl-3 space-y-2 text-sm my-3 min-w-0">
    <p className="font-display font-bold break-words">Story bundle: {bundle.title}</p>
    {bundle.prep_note && <p className="whitespace-pre-line break-words">{bundle.prep_note}</p>}
    {bundle.sources.length > 0 && <ul className="space-y-1">{bundle.sources.map(source => <li key={source.url}><span className="text-ink/60">{bundleRoleLabel(source.role)} · </span><a className="underline break-words" href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>}
  </div>;
}
export function StoryBundleLink({ submissionId, bundleId, canManage }: { submissionId: string; bundleId?: string | null; canManage: boolean }) {
  const router = useRouter(); const [pending,setPending] = useState(false); const [error,setError] = useState<string | null>(null);
  const create = async () => {
    setPending(true);setError(null);
    try {
      const response = await fetch('/api/bundles', { method: 'POST', headers: { 'Content-Type':'application/json' }, body:JSON.stringify({ submissionId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not create story bundle.');
      router.push(`/bundles/${data.bundle.id}`);
    } catch(error) { setError(error instanceof Error ? error.message : 'Could not create story bundle.'); }
    finally { setPending(false); }
  };
  if (bundleId) return <Link className="underline font-mono text-xs" href={`/bundles/${bundleId}`}>Open story bundle →</Link>;
  if (!canManage) return null;
  return <><Button size="xs" variant="outline" disabled={pending} onClick={create}>{pending ? 'Creating bundle…' : 'Bundle story'}</Button>{error && <p role="alert" className="text-xs text-rust">{error}</p>}</>;
}
export function LiveStoryBundle({ submissionId, bundleId }: { submissionId: string; bundleId?: string | null }) {
  const query = useQuery({ queryKey:['story-bundle',bundleId],queryFn:()=>loadStoryBundle(bundleId!),enabled:!!bundleId,refetchInterval:30000 });
  return <div className="mb-4">
    {query.data && <BundleContext bundle={query.data.bundle} />}
    {query.isError && <p role="alert" className="text-sm text-rust">{query.error.message}</p>}
    <StoryBundleLink submissionId={submissionId} bundleId={bundleId} canManage />
  </div>;
}
