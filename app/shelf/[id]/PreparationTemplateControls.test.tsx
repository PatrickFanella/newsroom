import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreparationTemplateControls } from './PreparationTemplateControls';

function setup(canCurate = true, isTemplate = true) {
  const changed = vi.fn();
  const props = { shelfId: 'template', name: 'Weekly', isTemplate, prepPrompt: 'Check sources', canCurate, onChanged: changed };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrap = (overrides = {}) => <QueryClientProvider client={client}><PreparationTemplateControls {...props} {...overrides} /></QueryClientProvider>;
  return { ...render(wrap()), changed, wrap };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('preparation template controls', () => {
  it('creates a named copy and links the returned shelf', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ list: { id: 'new-shelf', name: 'Tuesday' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const { changed } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Working shelf name' }), 'Tuesday');
    await user.click(screen.getByRole('button', { name: 'Create working shelf' }));
    expect(await screen.findByRole('link', { name: 'Open working shelf →' })).toHaveAttribute('href', '/shelf/new-shelf');
    expect(fetcher).toHaveBeenCalledWith('/api/lists/template/instantiate', expect.objectContaining({ body: JSON.stringify({ name: 'Tuesday' }) }));
    expect(changed).toHaveBeenCalledOnce();
  });
  it('keeps the name available after a failed copy and shows no false success link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Working shelf name' }), 'Tuesday');
    await user.click(screen.getByRole('button', { name: 'Create working shelf' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create working shelf' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Working shelf name' })).toHaveValue('Tuesday');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('retains an in-progress prompt through a background refetch and failed save', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender, wrap, changed } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit preparation settings' }));
    const prompt = screen.getByRole('textbox', { name: 'Prep prompts' });
    await user.clear(prompt); await user.type(prompt, 'My draft');
    rerender(wrap({ prepPrompt: 'Changed elsewhere' }));
    expect(prompt).toHaveValue('My draft');
    expect(screen.queryByRole('button', { name: 'Create working shelf' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save preparation settings' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save preparation settings' })).toBeEnabled());
    expect(prompt).toHaveValue('My draft');
    expect(changed).not.toHaveBeenCalled();
  });
  it('saves template status and prompts explicitly', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    const { changed } = setup(true, false);
    await user.click(screen.getByRole('button', { name: 'Edit preparation settings' }));
    await user.click(screen.getByRole('checkbox', { name: 'Reuse this shelf as a preparation template' }));
    await user.click(screen.getByRole('button', { name: 'Save preparation settings' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith('/api/lists/template', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ is_template: true, prep_prompt: 'Check sources' }),
    }));
  });
  it('lets a viewer read prompts without exposing mutations', () => {
    setup(false);
    expect(screen.getByText('Check sources')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
