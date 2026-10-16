'use client';
import {useState}from 'react';
import Link from 'next/link';
import {Button}from '@/components/ui/button';
import {Input}from '@/components/ui/input';
import {unusedBroadcastItems}from '@/lib/broadcast-carry';
import type {BroadcastDetail}from '@/lib/broadcast';
export function CarryForward({detail}:{detail:BroadcastDetail}) {
 const [name,setName]=useState(detail.broadcast.title.slice(0,60)+' — next show');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [result,setResult]=useState<{listId:string;count:number;existing:boolean}|null>(null);
 const unused=unusedBroadcastItems(detail);
 return <section aria-label="Carry unused stories forward" className="border border-ink/20 p-4 my-4 space-y-3"><h3 className="font-display text-lg font-bold">Carry unused stories forward</h3><p className="text-sm text-ink/60">{unused.length} saved rundown items have no recorded play in this show. Create an independent working shelf with the saved segment structure. This keeps the live deck and historical show intact.</p>
  <form className="flex flex-wrap items-end gap-2" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const r=await fetch(`/api/broadcasts/${detail.broadcast.id}/carry-forward`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});const data=await r.json();if(!r.ok)throw new Error(data.error);setResult(data);}catch(error){setError(error instanceof Error ? error.message : 'Could not carry stories forward');}finally{setBusy(false);}}}>
   <label className="flex-1 min-w-[12rem] text-sm">Working shelf name<Input className="block w-full mt-1" value={name} maxLength={80} onChange={e=>setName(e.target.value)} disabled={busy} required/></label><Button size="sm" type="submit" disabled={busy || !name.trim()}>{busy ? 'Preparing…' : 'Prepare next show shelf'}</Button>
  </form>
  {error && <p role="alert" className="text-sm text-rust">{error.replaceAll('_',' ')}</p>}{result && <p role="status" className="text-sm">{result.existing ? 'Previously prepared' : 'Prepared'} {result.count} items. <Link href={`/shelf/${result.listId}`} className="underline">Open working shelf →</Link></p>}
 </section>;
}
