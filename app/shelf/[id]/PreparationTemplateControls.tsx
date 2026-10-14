'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PREP_PROMPT_LIMIT } from '@/lib/preparation-templates';
import { toast } from 'sonner';

export function PreparationTemplateControls({ shelfId, name, isTemplate, prepPrompt, canCurate, onChanged }: {
  shelfId: string; name: string; isTemplate: boolean; prepPrompt: string;
  canCurate: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [copyName, setCopyName] = useState('');
  const [copy, setCopy] = useState<{ id: string; name: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/lists/${shelfId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_template: draftTemplate, prep_prompt: draftPrompt }),
      });
      if (!response.ok) throw new Error('Could not save preparation settings');
    },
    onSuccess: () => { setEditing(false); onChanged(); toast.success('Preparation settings saved'); },
    onError: (error) => toast.error(error.message),
  });
  const instantiate = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/lists/${shelfId}/instantiate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: copyName.trim() }),
      });
      if (!response.ok) throw new Error('Could not create the working shelf. Your template is unchanged.');
      const data = await response.json();
      return data.list as { id: string; name: string };
    },
    onSuccess: (created) => { setCopy(created); onChanged(); toast.success('Working shelf created'); },
    onError: (error) => toast.error(error.message),
  });

  return (
    <section aria-label="Show preparation" className="mb-6 border border-ink/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-lg font-bold">{isTemplate ? 'Preparation template' : 'Show preparation'}</h2>
        {canCurate && !editing && (
          <Button variant="outline" size="sm" onClick={() => {
            setDraftTemplate(isTemplate); setDraftPrompt(prepPrompt); setEditing(true); setCopy(null);
          }}>Edit preparation settings</Button>
        )}
      </div>
      {editing ? (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draftTemplate} onChange={(event) => setDraftTemplate(event.target.checked)} disabled={save.isPending} />
            Reuse this shelf as a preparation template
          </label>
          <label className="block text-sm">
            Prep prompts
            <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} maxLength={PREP_PROMPT_LIMIT}
              disabled={save.isPending} rows={4} className="mt-1 block w-full border border-ink/30 bg-transparent p-2"
              placeholder="What needs checking before this show? Add research questions or a prep checklist." />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save preparation settings'}</Button>
            <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          {prepPrompt && <p className="text-sm whitespace-pre-wrap break-words">{prepPrompt}</p>}
          {isTemplate && <p className="text-sm text-ink/60">Create a working shelf for each show. It copies every segment, including empty ones, links, item notes, and these prompts. Edit the copy, then send its rundown to the deck when ready.</p>}
          {!isTemplate && !prepPrompt && canCurate && <p className="text-sm text-ink/60">Add prep prompts, or make this shelf a reusable template for future shows.</p>}
          {isTemplate && canCurate && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
              event.preventDefault(); if (!instantiate.isPending && copyName.trim()) instantiate.mutate();
            }}>
              <label className="block flex-1 min-w-[12rem] text-sm">
                Working shelf name
                <Input value={copyName} maxLength={80} onChange={(event) => { setCopyName(event.target.value); setCopy(null); }}
                  placeholder={`${name.slice(0, 65)} — prep`} disabled={instantiate.isPending} className="mt-1 block w-full" required />
              </label>
              <Button type="submit" size="sm" disabled={instantiate.isPending || !copyName.trim()}>
                {instantiate.isPending ? 'Creating…' : 'Create working shelf'}
              </Button>
            </form>
          )}
          {copy && <p className="text-sm">Created “{copy.name}”. <Link className="underline hover:text-rust" href={`/shelf/${copy.id}`}>Open working shelf →</Link></p>}
        </>
      )}
    </section>
  );
}
