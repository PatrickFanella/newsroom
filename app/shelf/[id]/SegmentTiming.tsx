'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function SegmentTiming({ name, minutes, canCurate, onSave }: { name: string; minutes: number | null; canCurate: boolean; onSave: (minutes: number | null) => Promise<void> }) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  return <div className="px-2 mb-2 text-xs text-ink/60">
    {editing ? <form className="flex flex-wrap items-end gap-2" onSubmit={async(e) => {
      e.preventDefault(); if(saving) return; setSaving(true); setError('');
      try { await onSave(draft === '' ? null : Number(draft)); setEditing(false); }
      catch { setError('Could not save timing target'); } finally { setSaving(false); }
    }}>
      <label>Target minutes for {name}<Input className="block w-32 mt-1" type="number" min="1" max="1440" step="1" value={draft} onChange={e=>setDraft(e.target.value)} disabled={saving}/></label>
      <Button size="xs" type="submit" disabled={saving}>Save target</Button><Button size="xs" type="button" variant="outline" onClick={()=>setEditing(false)} disabled={saving}>Cancel</Button>
      {error && <p role="alert">{error}</p>}
    </form> : <div className="flex flex-wrap items-center gap-2"><span>{minutes == null ? 'No timing target' : `Target: ${minutes} min`}</span>{canCurate && <Button size="xs" variant="outline" onClick={()=>{setDraft(minutes == null ? '' : String(minutes));setEditing(true);setError('');}}>Set target for {name}</Button>}</div>}
  </div>;
}
