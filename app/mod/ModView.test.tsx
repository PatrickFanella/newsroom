vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Covers the two additions the mod-view review flagged as missing relative
// to the deck: an Undo toast on approve/reject (including the swipe path's
// only safety net against a mis-swipe), and keyboard triage (j/k to move the
// highlight, a/r to act on it). Unlike the deck's Undo (a delayed write that
// can be silently cancelled — see DeckView.test.tsx), this Undo is a second,
// immediate write back to 'pending': mod triage is shared and realtime-synced
// across every mod working the queue, so pretending an action hasn't
// happened yet would be actively wrong here. Real timers aren't needed as a
// result — there's no setTimeout in this path to race against.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ModView } from './ModView';

function makeSub(
  id: string,
  title: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    editorial_revision: 0,
    review_claim_actor_id: null,
    review_claim_display_name: null,
    review_claim_token: null,
    review_claim_expires_at: null,
    url: `https://example.com/${id}`,
    kind: 'article',
    status,
    title,
    thumbnail_url: null,
    publisher: 'Example',
    author: null,
    duration_seconds: null,
    published_at: null,
    description: null,
    summary: null,
    credibility_tag: null,
    topics: [],
    dmca_risk: null,
    content_warning: null,
    related_coverage: null,
    archive_url: null,
    mod_notes: null,
    prep_note: null,
    trigger_warning: null,
    segment_id: null,
    position: null,
    submitter_login: 'some_viewer',
    submitter_is_sub: false,
    submitter_is_mod: false,
    submitter_is_vip: false,
    created_at: '2026-07-08T00:00:00.000Z',
    // Only set when a mod (not the streamer) approved this — see
    // supabase/migrations/…_add_submission_approver.sql.
    approved_by_login: null,
    approved_by_display_name: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/** Mutable in-memory backend, filtered by ?status= like the real API. */
function installMockBackend(
  initial: ReturnType<typeof makeSub>[],
  segments: { id: string; name: string }[] = [],
) {
  const state = new Map(initial.map((s) => [s.id, { ...s }]));
  const patches: { id: string; status?: string; segment_id?: string | null }[] = [];

  const counts = () => {
    const c = { pending: 0, approved: 0, played: 0, rejected: 0, total: 0 };
    for (const item of state.values()) {
      c[item.status as 'pending' | 'approved' | 'played' | 'rejected']++;
      c.total++;
    }
    return c;
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (url.startsWith('/api/queue') && method === 'GET') {
        const params = new URL(url, 'http://localhost').searchParams;
        const status = params.get('status');
        const text = (params.get('q') ?? '').toLowerCase();
        const kind = params.get('kind');
        const matched = [...state.values()].filter((s) => (!status || s.status === status) && (!kind || s.kind === kind) && (!text || [s.title, s.url, s.publisher, s.submitter_login, ...s.topics].some(value => value?.toLowerCase().includes(text))));
        const start = params.get('before') ? matched.findIndex(s => s.id === params.get('before')) + 1 : 0;
        const submissions = matched.slice(start, start + 50);
        const nextCursor = start + 50 < matched.length ? submissions.at(-1)?.id : null;
        return jsonResponse({ submissions, nowPlaying: null, counts: counts(), matchedCount: matched.length, nextCursor });
      }
      if (url === '/api/queue' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body || '{}'));
        const item = state.get(body.id);
        if (item && body.expectedRevision !== undefined && body.expectedRevision !== item.editorial_revision) return jsonResponse({ error: 'stale', detail: 'This item changed elsewhere. Your action was not saved.' }, 409);
        const patch: { id: string; status?: string; segment_id?: string | null } = { id: body.id };
        if (item && typeof body.status === 'string') {
          item.status = body.status;
          patch.status = body.status;
        }
        if (item && 'segment_id' in body) {
          item.segment_id = body.segment_id;
          patch.segment_id = body.segment_id;
        }
        if (item) {
          for (const key of ['mod_notes', 'trigger_warning', 'prep_note']) {
            if (key in body) Object.assign(item, { [key]: body[key] });
          }
          item.editorial_revision++;
        }
        patches.push(patch);
        return jsonResponse({ submission: item ?? {} });
      }
      if (url.startsWith('/api/segments') && method === 'GET') {
        return jsonResponse({ segments, ungroupedPosition: 0 });
      }
      if (url.startsWith('/api/archive')) return jsonResponse({ ok: true });
      return jsonResponse({});
    }),
  );

  return { state, patches };
}

function renderModView(overrides: { isMod?: boolean; canCurate?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ModView
          channel="somechannel"
          displayName="Some Mod"
          streamDisplayName="Some Streamer"
          submitCommand={null}
          streamId="mock-stream"
          actorId="mod-1"
          isMod={overrides.isMod ?? true}
          canCurate={overrides.canCurate ?? false}
        />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.unstubAllGlobals();
});

describe('ModView — undo on approve/reject', () => {
  it('approving removes the item and offers Undo, which writes it back to pending', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(screen.queryByText('Item A')).not.toBeInTheDocument());
    expect(backend.patches).toContainEqual({ id: 'a', status: 'approved' });

    await user.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'pending' }));
    expect(await screen.findByText('Item A')).toBeInTheDocument();
  });

  it('rejecting (the swipe path\'s only safety net) also offers Undo', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /^reject$/i }));

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'rejected' }));
    expect(screen.queryByText('Item A')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'pending' }));
    expect(await screen.findByText('Item A')).toBeInTheDocument();
  });
});

describe('ModView — keyboard triage', () => {
  it('approves the first item on "a" with no navigation needed', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    renderModView();

    await screen.findByText('Item A');
    await userEvent.keyboard('a');

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'approved' }));
  });

  it('moves the highlight with j/k before acting on the newly-highlighted item', async () => {
    const backend = installMockBackend([
      makeSub('a', 'Item A', 'pending'),
      makeSub('b', 'Item B', 'pending'),
    ]);
    renderModView();

    await screen.findByText('Item A');
    await screen.findByText('Item B');

    // Highlight starts on the first item; move it down one to Item B, then reject.
    await userEvent.keyboard('j');
    await userEvent.keyboard('r');

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'b', status: 'rejected' }));
    expect(backend.patches).not.toContainEqual({ id: 'a', status: 'rejected' });
  });

  it('does not fire shortcuts while typing in the note field', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByPlaceholderText(/skip to/i), 'a whole sentence about a video');

    expect(backend.patches).toHaveLength(0);
  });

  it('opens the shortcuts modal on "?"', async () => {
    installMockBackend([makeSub('a', 'Item A', 'pending')]);
    renderModView();

    await screen.findByText('Item A');
    await userEvent.keyboard('?');

    expect(await screen.findByText(/keyboard shortcuts/i)).toBeInTheDocument();
  });
});

// Sending an approved item straight into a segment — driven by the same
// canCurate boolean for both a curate-authorized mod and the streamer (see
// sessionCanCurate/ModView's canCurate prop), never by role directly.
describe('ModView — approve into a segment', () => {
  it('is unavailable without canCurate, even for a mod', async () => {
    installMockBackend([makeSub('a', 'Item A', 'pending')], [{ id: 'seg-1', name: 'Politics' }]);
    renderModView({ isMod: true, canCurate: false });

    await screen.findByText('Item A');
    expect(screen.queryByRole('button', { name: /approve into a segment/i })).not.toBeInTheDocument();
  });

  it('lets a curate-authorized mod approve into a chosen segment', async () => {
    const backend = installMockBackend(
      [makeSub('a', 'Item A', 'pending')],
      [{ id: 'seg-1', name: 'Politics' }],
    );
    const user = userEvent.setup();
    renderModView({ isMod: true, canCurate: true });

    await screen.findByText('Item A');
    await user.click(await screen.findByRole('button', { name: /approve into a segment/i }));
    await user.click(await screen.findByText('Politics'));

    await waitFor(() =>
      expect(backend.patches).toContainEqual({ id: 'a', status: 'approved', segment_id: 'seg-1' }),
    );
  });

  it('lets the streamer (isMod false, canCurate true) approve into a segment too', async () => {
    const backend = installMockBackend(
      [makeSub('a', 'Item A', 'pending')],
      [{ id: 'seg-1', name: 'Politics' }],
    );
    const user = userEvent.setup();
    renderModView({ isMod: false, canCurate: true });

    await screen.findByText('Item A');
    await user.click(await screen.findByRole('button', { name: /approve into a segment/i }));
    await user.click(await screen.findByText('Politics'));

    await waitFor(() =>
      expect(backend.patches).toContainEqual({ id: 'a', status: 'approved', segment_id: 'seg-1' }),
    );
  });

  it('routes the focused item into the Nth segment on a number-key shortcut', async () => {
    const backend = installMockBackend(
      [makeSub('a', 'Item A', 'pending')],
      [{ id: 'seg-1', name: 'Politics' }, { id: 'seg-2', name: 'Tech' }],
    );
    renderModView({ isMod: true, canCurate: true });

    await screen.findByText('Item A');
    // Segments load asynchronously; wait for the picker to confirm they're in.
    await screen.findByRole('button', { name: /approve into a segment/i });
    await userEvent.keyboard('2');

    await waitFor(() =>
      expect(backend.patches).toContainEqual({ id: 'a', status: 'approved', segment_id: 'seg-2' }),
    );
  });

  it('shows which mod approved an already-approved item, on the Approved tab', async () => {
    installMockBackend([
      makeSub('a', 'Item A', 'approved', { approved_by_login: 'somemod', approved_by_display_name: 'SomeMod' }),
    ]);
    const user = userEvent.setup();
    renderModView({ isMod: true, canCurate: true });

    await user.click(await screen.findByText(/approved \(1\)/i));

    expect(await screen.findByText(/by SomeMod/)).toBeInTheDocument();
  });

  it('shows no approver marker on the Approved tab when the streamer approved it themselves', async () => {
    installMockBackend([makeSub('a', 'Item A', 'approved')]);
    const user = userEvent.setup();
    renderModView({ isMod: false, canCurate: true });

    await user.click(await screen.findByText(/approved \(1\)/i));

    // "· by <name>" (the approver marker) is distinct from "submitted by
    // <login>" (SubmissionCard's own, unrelated line) — this only checks
    // for the former, since makeSub's default submitter_login always
    // renders the latter.
    await screen.findByText('Item A');
    expect(screen.queryByText(/·\s*by\s/)).not.toBeInTheDocument();
  });

  it('clears the segment on Undo so a later plain approve does not inherit it', async () => {
    const backend = installMockBackend(
      [makeSub('a', 'Item A', 'pending')],
      [{ id: 'seg-1', name: 'Politics' }],
    );
    const user = userEvent.setup();
    renderModView({ isMod: true, canCurate: true });

    await screen.findByText('Item A');
    await user.click(await screen.findByRole('button', { name: /approve into a segment/i }));
    await user.click(await screen.findByText('Politics'));
    await waitFor(() =>
      expect(backend.patches).toContainEqual({ id: 'a', status: 'approved', segment_id: 'seg-1' }),
    );

    await user.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() =>
      expect(backend.patches).toContainEqual({ id: 'a', status: 'pending', segment_id: null }),
    );
  });
});

// Some mods' browsers won't let them right-click → copy link address on the
// card (extension/lockdown quirks) — see ModView.tsx's Copy link button.
describe('ModView — copy link', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // jsdom's navigator.clipboard is a getter-only own property — delete
    // the per-test override rather than leaving it to leak into other files.
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('copies the item URL to the clipboard, on every status tab', async () => {
    installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    // userEvent.setup() installs its own virtual clipboard — define the mock
    // after it, or this override gets silently clobbered.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith('https://example.com/a');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });
});


describe('ModView — queue discovery', () => {
  it('loads beyond the first page and can triage an item from that page', async () => {
    const backend = installMockBackend(Array.from({ length: 55 }, (_, i) => makeSub(`story-${i}`, `Story ${i}`, 'pending')));
    const user = userEvent.setup(); renderModView();
    await screen.findByText('Story 0');
    expect(screen.queryByText('Story 54')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('50 of 55 pending items');
    await user.click(screen.getByRole('button', { name: 'Load more items' }));
    const later = await screen.findByText('Story 54');
    const card = later.closest('.card-paper')!;
    await user.click(within(card as HTMLElement).getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'story-54', status: 'approved' }));
    await waitFor(() => expect(screen.queryByText('Story 54')).not.toBeInTheDocument());
  });
  it('searches on the server after typing and preserves global tab counts', async () => {
    installMockBackend([makeSub('a', 'Budget news', 'pending'), makeSub('b', 'Other news', 'pending')]);
    const user = userEvent.setup(); renderModView();
    await screen.findByText('Other news');
    await user.type(screen.getByLabelText('Search queue'), 'budget');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 of 1 matching pending items'));
    expect(screen.queryByText('Other news')).not.toBeInTheDocument();
    expect(screen.getByText('pending (2)')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => new URL(String(url), 'http://localhost').searchParams.get('q') === 'budget')).toBe(true);
  });
  it('combines media and text filters and recovers from an empty result', async () => {
    installMockBackend([makeSub('a', 'Budget article', 'pending'), makeSub('b', 'Budget clip', 'pending', { kind: 'twitch_clip' })]);
    const user = userEvent.setup(); renderModView();
    await screen.findByText('Budget article');
    await user.selectOptions(screen.getByLabelText('Media type'), 'twitch_clip');
    await screen.findByText('Budget clip');
    expect(screen.queryByText('Budget article')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search queue'), 'absent');
    await screen.findByText('No matching items.');
    await user.click(screen.getByRole('button', { name: 'Clear search filters' }));
    expect(await screen.findByText('Budget article')).toBeInTheDocument();
    expect(screen.getByLabelText('Media type')).toHaveValue('');
  });
  it('resets pagination when filters change instead of retaining later-page rows', async () => {
    installMockBackend(Array.from({ length: 55 }, (_, i) => makeSub(`story-${i}`, `Story ${i}`, 'pending')));
    const user = userEvent.setup(); renderModView();
    await user.click(await screen.findByRole('button', { name: 'Load more items' }));
    await screen.findByText('Story 54');
    await user.type(screen.getByLabelText('Search queue'), 'Story 0');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 of 1 matching'));
    expect(screen.queryByText('Story 54')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more items' })).not.toBeInTheDocument();
  });
  it('does not approve the old result while a new search is debouncing', async () => {
    const backend = installMockBackend([makeSub('a', 'Old story', 'pending')]);
    const user = userEvent.setup(); renderModView();
    await screen.findByText('Old story');
    await user.type(screen.getByLabelText('Search queue'), 'new');
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    await user.click(document.body);
    await userEvent.keyboard('a');
    expect(backend.patches).toHaveLength(0);
  });
  it('shows an initial error with retry, then loads the recovered queue', async () => {
    installMockBackend([makeSub('a', 'Recovered story', 'pending')]);
    const goodFetch = fetch; let failing = true;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith('/api/queue') && failing ? jsonResponse({ error: 'Queue search unavailable' }, 503) : goodFetch(input, init)));
    const user = userEvent.setup(); renderModView();
    await screen.findByText('Queue search unavailable'); failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry queue' }));
    expect(await screen.findByText('Recovered story')).toBeInTheDocument();
  });
  it('keeps the current page visible when loading more fails and supports retry', async () => {
    installMockBackend(Array.from({ length: 51 }, (_, i) => makeSub(`story-${i}`, `Story ${i}`, 'pending')));
    const goodFetch = fetch; let failing = true;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('before=') && failing ? jsonResponse({ error: 'Try loading more again' }, 500) : goodFetch(input, init)));
    const user = userEvent.setup(); renderModView();
    await user.click(await screen.findByRole('button', { name: 'Load more items' }));
    await screen.findByText('Try loading more again');
    expect(screen.getByText('Story 0')).toBeInTheDocument(); failing = false;
    await user.click(screen.getByRole('button', { name: 'Load more items' }));
    expect(await screen.findByText('Story 50')).toBeInTheDocument();
  });
});

describe('ModView — coordination and stale drafts', () => {
  it('disables another reviewer’s claimed item for clicks and keyboard triage', async () => {
    const backend = installMockBackend([makeSub('a', 'Claimed story', 'pending', { review_claim_actor_id: 'mod-2', review_claim_display_name: 'Other Mod', review_claim_token: 'other-token', review_claim_expires_at: '2099-01-01T00:00:00Z' })]);
    renderModView(); await screen.findByText('Claimed story');
    expect(screen.getByText(/Other Mod is reviewing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeDisabled();
    await userEvent.keyboard('ar1'); expect(backend.patches).toHaveLength(0);
  });
  it('uses the committed revision for Undo instead of the old pending snapshot', async () => {
    const backend = installMockBackend([makeSub('a', 'Story', 'pending')]);
    const user = userEvent.setup(); renderModView(); await screen.findByText('Story');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    await user.click(await screen.findByRole('button', { name: /undo/i }));
    expect(await screen.findByText('Story')).toBeInTheDocument();
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init?.body)));
    expect(writes.map(body => body.expectedRevision)).toEqual([0, 1]);
    expect(backend.state.get('a')?.status).toBe('pending');
  });
  it('does not Undo an approval after newer editorial work', async () => {
    const backend = installMockBackend([makeSub('a', 'Story', 'pending')]);
    const user = userEvent.setup(); renderModView(); await screen.findByText('Story');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    await screen.findByRole('button', { name: /undo/i });
    backend.state.get('a')!.editorial_revision++;
    await user.click(screen.getByRole('button', { name: /undo/i }));
    await screen.findAllByText(/Your action was not saved/);
    expect(backend.state.get('a')?.status).toBe('approved');
    expect(backend.patches).not.toContainEqual({ id: 'a', status: 'pending' });
  });
  it('keeps an older warning draft through conflict/refetch until the user reconciles it', async () => {
    const backend = installMockBackend([makeSub('a', 'Story', 'pending')]);
    const user = userEvent.setup(); renderModView(); await screen.findByText('Story');
    await user.click(screen.getByRole('button', { name: /add trigger warning/i }));
    const input = screen.getByPlaceholderText(/graphic footage/i); await user.type(input, 'My draft warning');
    Object.assign(backend.state.get('a')!, { trigger_warning: 'Newer saved warning', editorial_revision: 1 });
    await user.click(screen.getByRole('button', { name: 'Save warning' }));
    await screen.findByText('Latest saved warning: Newer saved warning');
    expect(input).toHaveValue('My draft warning'); expect(backend.state.get('a')?.trigger_warning).toBe('Newer saved warning');
    await user.click(screen.getByRole('button', { name: 'Use draft with latest item' }));
    await user.click(screen.getByRole('button', { name: 'Save warning' }));
    await waitFor(() => expect(backend.state.get('a')?.trigger_warning).toBe('My draft warning'));
  });
  it('keeps a moderator note tied to the revision when its editor opened', async () => {
    const backend = installMockBackend([makeSub('a', 'Story', 'pending')]);
    const user = userEvent.setup(); renderModView(); await screen.findByText('Story');
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByPlaceholderText(/skip to/i), 'My note');
    Object.assign(backend.state.get('a')!, { mod_notes: 'Other note', editorial_revision: 1 });
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    await screen.findByText(/Review the updated card before using your note/);
    expect(backend.state.get('a')?.status).toBe('pending'); expect(screen.getByPlaceholderText(/skip to/i)).toHaveValue('My note');
    await user.click(screen.getByRole('button', { name: 'Use note with latest item' }));
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(backend.state.get('a')?.status).toBe('approved'));
    expect(backend.state.get('a')?.mod_notes).toBe('My note');
  });
});
