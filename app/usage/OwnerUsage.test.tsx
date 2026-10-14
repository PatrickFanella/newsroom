import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerUsage } from './OwnerUsage';
const usage = { month_start: '2026-10-01', month_end: '2026-11-01', summaries: 100, searches: 100, extractions: 200, estimated_usd: 0.8, monthly_budget_usd: 1, budget_warning_percent: 80, ai_enabled: true, coverage_enabled: true };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OwnerUsage displayName="Demo" /></QueryClientProvider>);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('owner usage controls', () => {
  it('shows a threshold alert based on metered activity', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage }),{ status: 200 }))); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('80% warning threshold'); expect(screen.getByText('$0.800')).toBeInTheDocument();
  });
  it('retains budget edits on failed save and permits an explicit unlimited allowance', async () => {
    const fetcher=vi.fn().mockImplementation((_url,init) => Promise.resolve(new Response(JSON.stringify(init?.method ? {} : { usage }),{ status: init?.method ? 503 : 200 }))); vi.stubGlobal('fetch',fetcher);
    mount(); const user=userEvent.setup(); await user.click(await screen.findByRole('button',{ name: 'Edit usage settings' }));
    const budget=screen.getByRole('spinbutton',{ name: /Monthly estimated allowance/ }); await user.clear(budget); await user.click(screen.getByRole('button',{ name: 'Save usage settings' }));
    await waitFor(() => expect(screen.getByText('Could not save usage settings')).toBeInTheDocument()); expect(budget).toHaveValue(null);
    expect(fetcher).toHaveBeenCalledWith('/api/usage',expect.objectContaining({ body: JSON.stringify({ monthly_budget_usd: null, budget_warning_percent: 80, ai_enabled: true, coverage_enabled: true }) }));
  });
});
