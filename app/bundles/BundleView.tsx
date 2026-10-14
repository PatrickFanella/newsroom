'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { BundleContext, loadStoryBundle } from '@/components/StoryBundle';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { BUNDLE_SOURCE_ROLES, bundleRoleLabel, relatedBundleSources, type BundleDetail, type BundleSource } from '@/lib/story-bundles';

function BundleEditor({ detail, onSaved }: { detail: BundleDetail; onSaved: ()=>void }) {
  const [title,setTitle]=useState(detail.bundle.title); const [prepNote,setPrepNote]=useState(detail.bundle.prep_note); const [sources,setSources]=useState<BundleSource[]>(detail.bundle.sources);
  const [revision,setRevision]=useState(detail.bundle.revision);
  const reset=(fresh:BundleDetail)=>{setTitle(fresh.bundle.title);setPrepNote(fresh.bundle.prep_note);setSources(fresh.bundle.sources);setRevision(fresh.bundle.revision);save.reset();};
  const save=useMutation({mutationFn:async()=>{
    const response=await fetch(`/api/bundles/${detail.bundle.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,prepNote,sources,revision})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save bundle.');setRevision(result.bundle.revision);setTitle(result.bundle.title);setPrepNote(result.bundle.prep_note);setSources(result.bundle.sources);
  },onSuccess:onSaved,onError:onSaved});
  const reload=useMutation({mutationFn:()=>loadStoryBundle(detail.bundle.id),onSuccess:fresh=>{reset(fresh);onSaved();}});
  const approve=useMutation({mutationFn:async()=>{
    const response=await fetch('/api/queue',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:detail.lead?.id,status:'approved',expectedStatus:detail.lead?.status})});
    const result=await response.json();if(!response.ok)throw new Error(result.detail||result.error||'Could not approve the lead story.');
  },onSuccess:onSaved});
  const dirty=title!==detail.bundle.title||prepNote!==detail.bundle.prep_note||JSON.stringify(sources)!==JSON.stringify(detail.bundle.sources);
  const patchSource=(index:number,patch:Partial<BundleSource>)=>setSources(prev=>prev.map((source,i)=>i===index?{...source,...patch}:source));
  return <>
    <form className="my-6" onSubmit={event=>{event.preventDefault();if(!save.isPending)save.mutate();}}><fieldset disabled={save.isPending||approve.isPending||reload.isPending} className="space-y-4">
      <label className="block text-sm">Story title<Input className="block w-full mt-1" value={title} maxLength={160} required onChange={event=>setTitle(event.target.value)} /></label>
      <label className="block text-sm">Shared prep notes<Textarea className="block w-full mt-1" value={prepNote} maxLength={10000} rows={4} onChange={event=>setPrepNote(event.target.value)} /></label>
      <fieldset className="space-y-3"><legend className="font-display text-xl font-bold mb-3">Supporting sources</legend>
        {sources.map((source,index)=><div key={index} className="border border-ink/20 p-3 space-y-2">
          <label className="block text-sm">Source {index+1} title<Input className="block w-full mt-1" value={source.title} maxLength={200} required onChange={event=>patchSource(index,{title:event.target.value})} /></label>
          <label className="block text-sm">Source {index+1} URL<Input type="url" className="block w-full mt-1" value={source.url} required onChange={event=>patchSource(index,{url:event.target.value})} /></label>
          <label className="block text-sm">Source {index+1} role<select className="block border border-ink/20 bg-paper px-2 py-1 mt-1" value={source.role} onChange={event=>patchSource(index,{role:event.target.value as BundleSource['role']})}>{BUNDLE_SOURCE_ROLES.map(role=><option key={role} value={role}>{bundleRoleLabel(role)}</option>)}</select></label>
          <Button type="button" size="xs" variant="outline" onClick={()=>setSources(prev=>prev.filter((_,i)=>i!==index))}>Remove source {index+1}</Button>
        </div>)}
        <Button type="button" size="sm" variant="outline" disabled={sources.length>=12} onClick={()=>setSources(prev=>[...prev,{title:'',url:'',role:'coverage'}])}>Add supporting source</Button>
        {detail.lead?.related_coverage?.length ? <Button type="button" size="sm" variant="outline" disabled={sources.length>=12} onClick={()=>setSources(prev=>relatedBundleSources(detail.lead?.related_coverage,prev))}>Add related coverage</Button> : null}
      </fieldset>
      {detail.bundle.revision>revision&&<p role="status" className="text-sm text-rust">A newer bundle version is available. Your draft is kept.</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={save.isPending}>Save bundle</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={()=>reload.mutate()}>Load latest bundle</Button></div>
      {reload.isError&&<p role="alert" className="text-sm text-rust">{reload.error.message}</p>}
      {save.isError&&<p role="alert" className="text-sm text-rust">{save.error.message}</p>}{save.isSuccess&&!dirty&&<p role="status" className="text-sm text-moss">Bundle saved.</p>}
    </fieldset></form>
    {detail.lead&&['pending','rejected'].includes(detail.lead.status)&&<div className="border-t border-ink/20 pt-4"><Button disabled={dirty||save.isPending||approve.isPending} onClick={()=>approve.mutate()}>Approve lead onto deck</Button>{dirty&&<p className="text-xs text-ink/60 mt-2">Save the bundle before approving its lead.</p>}{approve.isError&&<p role="alert" className="text-sm text-rust">{approve.error.message}</p>}</div>}
  </>;
}
export function BundleView({ id,canManage }: { id:string;canManage:boolean }) {
  const client=useQueryClient();const query=useQuery({queryKey:['story-bundle',id],queryFn:()=>loadStoryBundle(id),refetchInterval:30000});
  const detail=query.data;const saved=()=>{client.invalidateQueries({queryKey:['story-bundle',id]});client.invalidateQueries({queryKey:['bundles']});client.invalidateQueries({queryKey:['queue']});};
  return <div className="min-h-screen"><AppHeader section="story bundle" className="border-b-2 border-ink px-4 sm:px-6 py-3 gap-4 [&>div]:flex-wrap [&>div]:max-w-full" right={<><Link className="underline" href="/bundles">Bundles</Link><Link className="underline" href="/deck">Deck</Link><Link className="underline" href="/broadcasts">Shows</Link></>} />
    <main className="max-w-3xl mx-auto p-4 sm:p-6">
      {query.isPending?<p>Loading story bundle…</p>:query.isError&&!detail?<div role="alert"><p>{query.error.message}</p><Button size="sm" variant="outline" onClick={()=>query.refetch()}>Retry bundle</Button></div>:detail?<>
        <h1 className="font-display text-3xl font-bold break-words">{detail.bundle.title}</h1><p className="font-mono text-xs text-ink/60 mt-2">{detail.lead?`Lead is ${detail.lead.status}`:'Lead item cleared · bundle retained for reference'}</p>
        <a className="underline block mt-3 break-words" href={detail.lead?.url??detail.bundle.lead_source.url} target="_blank" rel="noreferrer">Lead source: {detail.lead?.title||detail.bundle.lead_source.title||detail.bundle.lead_source.url} ↗</a>
        {canManage?<BundleEditor key={id} detail={detail} onSaved={saved}/>:<BundleContext bundle={detail.bundle}/>}<p className="text-xs text-ink/60 mt-6">Supporting sources stay in this bundle; approving it puts one lead item on the deck. Shows retain their own saved versions of this context.</p>
      </>:null}
    </main></div>;
}
