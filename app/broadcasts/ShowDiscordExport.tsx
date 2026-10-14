'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
type Preview={messages:string[];count:number;fingerprint:string;nextMessage:number;saved:boolean};
export function ShowDiscordExport({id}:{id:string}) {
 const [preview,setPreview]=useState<Preview|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');
 const load=async()=>{setBusy(true);setError('');setStatus('');try{const r=await fetch(`/api/broadcasts/${id}/discord`);const body=await r.json();if(!r.ok)throw new Error(body.error);setPreview(body);}catch(error){setError(error instanceof Error ? error.message : 'Could not preview export');}finally{setBusy(false);}};
 const post=async()=>{if(!preview)return;setBusy(true);setError('');setStatus('');try{const r=await fetch(`/api/broadcasts/${id}/discord`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint:preview.fingerprint})});const result=await r.json();if(!r.ok)throw new Error(result.error);setPreview({...preview,nextMessage:result.nextMessage});setStatus(result.complete ? result.alreadyPosted ? 'This version was already posted.' : 'Show export completed.' : 'Saved progress. Resume to send the remaining messages.');}catch(error){setError(error instanceof Error ? error.message : 'Delivery failed');setPreview(null);}finally{setBusy(false);}};
 return <section aria-label="Show Discord export" className="border border-ink/20 p-4 my-4 space-y-3"><h3 className="font-display text-lg font-bold">Discord export for this show</h3><p className="text-xs text-ink/60">Preview the exact messages before posting to your configured webhook. Interrupted exports resume the saved version. An ambiguous delivery may duplicate the last chunk when retried.</p><Button size="sm" variant="outline" onClick={load} disabled={busy}>Preview show export</Button>
  {preview && <><p className="text-sm">{preview.count} stories · {preview.messages.length} messages · {preview.nextMessage} acknowledged{preview.saved && ' · saved export'}</p>{preview.messages.map((message,index)=><pre key={index} className="text-xs whitespace-pre-wrap break-words border border-ink/10 p-2">{message}</pre>)}<Button size="sm" onClick={post} disabled={busy || !preview.messages.length}>{busy ? 'Posting…' : preview.nextMessage>0 ? 'Resume saved export' : 'Post this show to Discord'}</Button></>}
  {error && <p role="alert" className="text-sm text-rust">{error}</p>}{status && <p role="status" className="text-sm">{status}</p>}
 </section>;
}
