import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BroadcastControls } from './BroadcastControls';
vi.mock('@/lib/use-realtime-channel', () => ({ useRealtimeChannel: vi.fn() }));
const active = { id: 'show-1', title: 'Evening desk' };
function setup(canManage = true, shows: unknown[] = [], fail = false) {
  const calls: unknown[] = [];
  let current = shows;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string); calls.push(body);
      if (fail) return Response.json({ error: 'A show is already active. Refresh to continue.' }, { status: 409 });
      current = body.action === 'start' ? [active] : [];
      return Response.json({ broadcast: active });
    }
    return Response.json({ broadcasts: current, nextCursor: null });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><BroadcastControls streamId="stream-1" canManage={canManage} /></QueryClientProvider>);
  return calls;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('show controls', () => {
  it('starts then ends a show and refreshes the active state', async () => {
    const calls = setup(); const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New show title'), 'Evening desk');
    await user.click(screen.getByRole('button', { name: 'Start show' }));
    await user.click(await screen.findByRole('button', { name: 'End show' }));
    await screen.findByLabelText('New show title');
    expect(calls).toEqual([{ action: 'start', title: 'Evening desk' }, { action: 'end', id: 'show-1' }]);
  });
  it('lets moderators see the active show without mutation controls', async () => {
    setup(false, [active]);
    expect(await screen.findByRole('link', { name: 'Evening desk' })).toHaveAttribute('href', '/broadcasts/show-1');
    expect(screen.queryByRole('button', { name: 'End show' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New show title')).not.toBeInTheDocument();
  });
  it('preserves the title and shows the server error after a failed start', async () => {
    setup(true, [], true); const user = userEvent.setup();
    const input = await screen.findByLabelText('New show title');
    await user.type(input, 'My unsaved title');
    await user.click(screen.getByRole('button', { name: 'Start show' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A show is already active'));
    expect(input).toHaveValue('My unsaved title');
  });
});
