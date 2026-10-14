import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewClaimControls } from './ReviewClaimControls';
const now = Date.parse('2026-10-14T00:00:00Z');
const item = { id: 'item', editorial_revision: 0, review_claim_actor_id: 'mod-a', review_claim_display_name: 'Alice', review_claim_expires_at: '2026-10-14T00:10:00Z', review_claim_token: 'token-a' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('review controls', () => {
  it('offers Start review for expired claims without silently renewing them', async () => {
    const onChange = vi.fn(); const fetcher = vi.fn().mockResolvedValue(Response.json({ submission: item })); vi.stubGlobal('fetch', fetcher);
    render(<ReviewClaimControls item={item} actorId="mod-b" canReleaseOthers={false} now={now + 600000} onChange={onChange} />);
    expect(fetcher).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Start review' }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ id: 'item', action: 'claim' }); expect(onChange).toHaveBeenCalledWith(item);
  });
  it('allows only the current reviewer to extend or release through a mod UI', () => {
    render(<ReviewClaimControls item={item} actorId="mod-b" canReleaseOthers={false} now={now} onChange={vi.fn()} />);
    expect(screen.getByText(/Alice is reviewing/)).toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('sends the current lease token for explicit extension', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ submission: item })); vi.stubGlobal('fetch', fetcher);
    render(<ReviewClaimControls item={item} actorId="mod-a" canReleaseOthers={false} now={now} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Extend review' }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ id: 'item', action: 'renew', token: 'token-a' });
  });
  it('offers the owner an explicit fenced release of another reviewer’s claim', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ submission: { ...item, review_claim_token: null } })); vi.stubGlobal('fetch', fetcher);
    render(<ReviewClaimControls item={item} actorId="owner" canReleaseOthers now={now} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Release reviewer’s claim' }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ id: 'item', action: 'release', token: 'token-a', force: true });
  });
  it('reports a lost lease and keeps the current claim visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'This review claim changed.' }, { status: 409 })));
    render(<ReviewClaimControls item={item} actorId="mod-a" canReleaseOthers={false} now={now} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Release review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('claim changed'); expect(screen.getByText(/You are reviewing/)).toBeInTheDocument();
  });
});
