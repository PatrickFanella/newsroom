'use client';
import {useState}from 'react';
import Link from 'next/link';
import {Button}from '@/components/ui/button';
import {Input}from '@/components/ui/input';
import type {PublicEpisode}from '@/lib/public-episode';
import {EpisodeContent}from '@/app/episodes/EpisodeContent';
export function PublishEpisode({id,title,initialToken}:{id:string;title:string;initialToken?:string|null}) {
 const [publicTitle,setTitle]=useState(title);const [summaries,setSummaries]=useState(false);const [takeaways,setTakeaways]=useState(false);const [token,setToken]=useState(initialToken ?? null);const [preview,setPreview]=useState<{episode:PublicEpisode;fingerprint:string}|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');
 const options={title:publicTitle,includeSummaries:summaries,includeTakeaways:takeaways};
 const run=async(action:'preview'|'publish'|'revoke')=>{setBusy(true);setError('');setStatus('');try{
  const params=new URLSearchParams({title:publicTitle,includeSummaries:summaries ? '1':'0',includeTakeaways:takeaways ? '1':'0'});
  const response=await fetch(`/api/broadcasts/${id}/publish${action==='preview' ? '?'+params : ''}`,action==='preview' ? undefined : {method:action==='publish' ? 'POST':'DELETE',headers:{'Content-Type':'application/json'},...(action==='publish' ? {body:JSON.stringify({...options,fingerprint:preview?.fingerprint})} : {})});
  const data=await response.json();if(!response.ok)throw new Error(data.error);
  if(action==='preview'){setPreview(data);setToken(data.publication.token);}else if(action==='publish'){setToken(data.token);setStatus('Public episode published.');}else{setToken(null);setStatus('Public episode revoked.');}
 }catch(error){setError(error instanceof Error ? error.message : 'Publishing failed');}finally{setBusy(false);}};
 return <section aria-label="Public episode publishing" className="border border-ink/20 p-4 my-4 space-y-3"><h3 className="font-display text-lg font-bold">Public episode page</h3><p className="text-xs text-ink/60">Publish only the previewed title, covered-story links, recording chapters, and text you choose below. The saved public version changes when you republish.</p>
  <label className="block text-sm">Public episode title<Input className="block w-full mt-1" maxLength={160} value={publicTitle} onChange={e=>{setTitle(e.target.value);setPreview(null);}} disabled={busy}/></label>
  <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={summaries} onChange={e=>{setSummaries(e.target.checked);setPreview(null);}} disabled={busy}/>Include summaries</label>
  <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={takeaways} onChange={e=>{setTakeaways(e.target.checked);setPreview(null);}} disabled={busy}/>Include my takeaways</label>
  <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>run('preview')} disabled={busy || !publicTitle.trim()}>Preview public episode</Button>{token && <><Link className="text-sm underline self-center" href={`/episodes/${token}`} target="_blank">Open public episode →</Link><Button size="sm" variant="outlineDestructive" onClick={()=>run('revoke')} disabled={busy}>Revoke public episode</Button></>}</div>
  {preview && <div className="space-y-3 border-t border-ink/20 pt-4"><EpisodeContent episode={preview.episode}/><Button size="sm" onClick={()=>run('publish')} disabled={busy}>{token ? 'Republish this preview' : 'Publish this preview'}</Button></div>}
  {error && <p role="alert" className="text-sm text-rust">{error}</p>}{status && <p role="status" className="text-sm">{status}</p>}
 </section>;
}
