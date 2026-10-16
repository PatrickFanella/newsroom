'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usageAlert, type UsageOverview } from '@/lib/usage-policy';

export function OwnerUsage({ displayName }: { displayName: string }) {
  const client = useQueryClient();
  const key = ['owner-usage'];
  const query = useQuery({ queryKey: key, queryFn: async (): Promise<UsageOverview> => {
    const r = await fetch('/api/usage'); if (!r.ok) throw new Error('Usage could not be loaded');
    return (await r.json()).usage;
  }, refetchInterval: 30000 });
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState('');
  const [warning, setWarning] = useState('80');
  const [ai, setAi] = useState(true);
  const [coverage, setCoverage] = useState(true);
  const save = useMutation({ mutationFn: async () => {
    const r = await fetch('/api/usage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      monthly_budget_usd: budget.trim() ? Number(budget) : null, budget_warning_percent: Number(warning), ai_enabled: ai, coverage_enabled: coverage,
    }) });
    if (!r.ok) throw new Error('Could not save usage settings');
  }, onSuccess: () => { setEditing(false); void client.invalidateQueries({ queryKey: key }); } });
  const usage = query.data;
  const alert = usage && usageAlert(usage);
  return <div className="min-h-screen">
    <AppHeader section="usage" className="border-b-2 border-ink px-6 py-3 gap-4" right={<><Link href="/setup" className="underline">Settings</Link><Link href="/deck" className="underline">Deck</Link><span>{displayName}</span></>} />
    <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <h1 className="font-display text-3xl font-bold">Usage and allowance</h1>
      <p className="text-sm text-ink/60">Activity for the current UTC calendar month. Estimates use $0.003 per admitted AI request and $0.005 per admitted search request. These are application estimates, not provider invoices. Failed attempts remain counted because the provider may have billed them.</p>
      {query.isPending && <p role="status">Loading usage…</p>}
      {query.isError && <div role="alert"><p>Usage is unavailable.</p><Button onClick={() => query.refetch()}>Retry</Button></div>}
      {usage && <>
        <p className="text-sm">Period: {usage.month_start.slice(0,10)} through {usage.month_end.slice(0,10)} (exclusive, UTC).</p>
        <dl className="grid grid-cols-2 gap-4 border border-ink/20 p-4">
          <div><dt>Estimated usage</dt><dd className="font-display text-2xl">${Number(usage.estimated_usd).toFixed(3)}</dd></div>
          <div><dt>Monthly allowance</dt><dd className="font-display text-2xl">{usage.monthly_budget_usd === null ? 'Unlimited' : `$${Number(usage.monthly_budget_usd).toFixed(3)}`}</dd></div>
          <div><dt>AI requests</dt><dd>{usage.summaries}</dd></div><div><dt>Search requests</dt><dd>{usage.searches}</dd></div>
          <div><dt>Metadata extractions</dt><dd>{usage.extractions}</dd></div>
        </dl>
        {alert && <p role="alert" className="border border-rust p-3">{alert === 'limit' ? 'The monthly estimated allowance has been reached. Further paid requests are paused until next month or you raise the allowance.' : `Estimated usage has reached your ${usage.budget_warning_percent}% warning threshold.`}</p>}
        <p className="text-sm">AI summaries: {usage.ai_enabled ? 'enabled' : 'paused'} · Related-coverage searches: {usage.coverage_enabled ? 'enabled' : 'paused'}</p>
        <p className="text-sm text-ink/60">Each paid operation must fit the remaining allowance before it starts. Basic metadata extraction, approval, and playback continue when paid requests are paused.</p>
        {!editing && <Button variant="outline" onClick={() => {
          setBudget(usage.monthly_budget_usd === null ? '' : String(usage.monthly_budget_usd)); setWarning(String(usage.budget_warning_percent)); setAi(usage.ai_enabled); setCoverage(usage.coverage_enabled); save.reset(); setEditing(true);
        }}>Edit usage settings</Button>}
      </>}
      {editing && <form className="space-y-4 border border-ink/20 p-4" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
        <label className="block text-sm">Monthly estimated allowance (USD; blank means unlimited)
          <Input className="block w-full mt-1" type="number" min="0" max="10000" step="0.001" value={budget} onChange={(e) => setBudget(e.target.value)} disabled={save.isPending} />
        </label>
        <label className="block text-sm">Warn at percentage
          <Input className="block w-full mt-1" type="number" min="1" max="100" step="1" value={warning} onChange={(e) => setWarning(e.target.value)} disabled={save.isPending} required />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} disabled={save.isPending} />Enable AI summaries</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={coverage} onChange={(e) => setCoverage(e.target.checked)} disabled={save.isPending} />Enable related-coverage searches</label>
        {save.isError && <p role="alert">{save.error.message}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save usage settings'}</Button><Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button></div>
      </form>}
    </main>
  </div>;
}
