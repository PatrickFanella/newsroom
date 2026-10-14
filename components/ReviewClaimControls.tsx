'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { activeReviewClaim, type ReviewState } from '@/lib/review-coordination';

export function ReviewClaimControls({ item, actorId, canReleaseOthers, now, disabled, onChange, onRefresh }: {
  item: ReviewState & { id: string }; actorId: string; canReleaseOthers: boolean; now: number;
  disabled?: boolean; onRefresh?: () => void; onChange: (item: ReviewState & { id: string }) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = activeReviewClaim(item, now);
  const mine = item.review_claim_actor_id === actorId;
  const act = async (action: 'claim' | 'renew' | 'release', force = false) => {
    setPending(true); setError(null);
    try {
      const response = await fetch('/api/queue/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, action, ...(action !== 'claim' ? { token: item.review_claim_token } : {}), ...(force ? { force: true } : {}) }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) onRefresh?.();
        throw new Error(result.detail || result.error || 'Could not save the review claim.');
      }
      onChange(result.submission);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the review claim.'); }
    finally { setPending(false); }
  };
  if (item.editorial_revision === undefined) return <p className="text-xs font-mono text-ink/50 w-full">Review coordination unavailable.</p>;
  return <div className="w-full border-y border-ink/20 py-2 mb-1 space-y-2">
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      {active ? <>
        <span className="break-words min-w-0">{mine ? 'You are reviewing' : `${item.review_claim_display_name || 'Another reviewer'} is reviewing`} · until {new Date(item.review_claim_expires_at!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        {mine && <Button size="xs" variant="outline" disabled={pending || disabled} onClick={() => act('renew')}>Extend review</Button>}
        {(mine || canReleaseOthers) && <Button size="xs" variant="outline" disabled={pending || disabled} onClick={() => act('release', !mine)}>{mine ? 'Release review' : 'Release reviewer’s claim'}</Button>}
      </> : <><span className="text-ink/60">Available to review</span><Button size="xs" variant="outline" disabled={pending || disabled} onClick={() => act('claim')}>Start review</Button></>}
    </div>
    {error && <p role="alert" className="font-mono text-xs text-rust">{error}</p>}
  </div>;
}
