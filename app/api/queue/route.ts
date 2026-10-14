import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession, sessionLogin } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { waitUntil } from '@vercel/functions';
import { processSubmissionEnrichment, recoverSubmissionEnrichment } from '@/lib/submission-enrichment';
import { normalizeTitleOverride } from '@/lib/title-override';
import { submitUrlToQueue } from '@/lib/submit-url';
import { broadcastQueueChange } from '@/lib/realtime';
import { parseQueueSearch } from '@/lib/queue-search';
import { expectedReviewRevision, reviewConflict, reviewConflictMessage } from '@/lib/review-coordination';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const result = await submitUrlToQueue({
    streamId: session.streamId,
    url,
    submitter: body.submitter || sessionLogin(session),
    isSub: !!body.isSub,
    isMod: !!body.isMod,
    isVip: !!body.isVip,
    message: body.message,
  });

  if (result.ignored) return NextResponse.json({ ignored: true });
  return NextResponse.json({ submission: result.submission });
}

type QueueOverviewRow = {
  pending: number;
  approved: number;
  played: number;
  rejected: number;
  total: number;
  now_playing: Record<string, unknown> | null;
};

// Old per-status fan-out (5 count queries + a sequential now-playing lookup)
// — kept only as the fallback below, for a database queue_overview() hasn't
// been created in yet (see supabase/migrations/…_add_queue_overview.sql and
// supabase/README.md for the one-time adoption step). Once that migration
// is applied, every request silently takes the single-RPC path instead;
// nothing here needs the code deploy and the migration to land in a
// specific order.
async function legacyOverview(
  sb: ReturnType<typeof supabaseAdmin>,
  streamId: string,
): Promise<QueueOverviewRow> {
  const [pending, approved, played, rejected, total] = await Promise.all([
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'pending'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'approved'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'played'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'rejected'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId),
  ]);

  let nowPlaying: Record<string, unknown> | null = null;
  const { data: streamRow, error: srErr } = await sb
    .from('streams')
    .select('now_playing_id')
    .eq('id', streamId)
    .maybeSingle();
  if (!srErr && streamRow?.now_playing_id) {
    const { data: np } = await sb
      .from('submissions')
      .select('*')
      .eq('id', streamRow.now_playing_id)
      .eq('stream_id', streamId)
      .maybeSingle();
    nowPlaying = np || null;
  }

  return {
    pending: pending.count ?? 0,
    approved: approved.count ?? 0,
    played: played.count ?? 0,
    rejected: rejected.count ?? 0,
    total: total.count ?? 0,
    now_playing: nowPlaying,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status'); // pending|approved|played|rejected|null
  const sb = supabaseAdmin();
  let search;
  try { search = parseQueueSearch(req.nextUrl.searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid search.' }, { status: 400 }); }

  // Paginated triage searches use their own newest-first ordering. Unpaged
  // deck reads keep their existing position order and response shape.
  const query = search
    ? sb.rpc('search_queue', {
      p_stream_id: session.streamId, p_status: search.status, p_query: search.query,
      p_kind: search.kind || null, p_before: search.before, p_before_id: search.beforeId,
    })
    : (() => {
      let q = sb.from('submissions').select('*').eq('stream_id', session.streamId)
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      return q;
    })();
  const [{ data, error }, ov] = await Promise.all([
    query,
    sb.rpc('queue_overview', { p_stream_id: session.streamId }).maybeSingle(),
  ]);
  if (error) {
    const missingSearch = search && ['42883', 'PGRST202'].includes(error.code);
    return NextResponse.json({ error: missingSearch ? 'Queue search is temporarily unavailable.' : 'Could not load the queue.' }, { status: missingSearch ? 503 : 500 });
  }

  const overview: QueueOverviewRow = !ov.error && ov.data
    ? (ov.data as QueueOverviewRow)
    : await legacyOverview(sb, session.streamId);

  waitUntil(recoverSubmissionEnrichment(session.streamId));

  return NextResponse.json({
    submissions: search ? data?.submissions ?? [] : data || [],
    ...(search ? { nextCursor: data?.next_cursor ?? null, matchedCount: data?.matched_count ?? 0 } : {}),
    nowPlaying: overview.now_playing,
    counts: {
      pending: overview.pending,
      approved: overview.approved,
      played: overview.played,
      rejected: overview.rejected,
      total: overview.total,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  let expectedRevision: number | null;
  try { expectedRevision = expectedReviewRevision(body); }
  catch { return NextResponse.json({ error: 'Invalid item revision.' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  if ('expectedStatus' in body && !['pending','approved','played','rejected'].includes(body.expectedStatus)) return NextResponse.json({ error: 'Invalid expected status.' }, { status: 400 });
  // Status/notes are mod triage; reassigning a segment or position is curation,
  // so gate those fields behind curate permission (the streamer always passes).
  const isCuration = 'segment_id' in body || typeof body.position === 'number';
  if (isCuration && !(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  // Fail before external work when the caller already has a stale snapshot.
  // The RPC repeats both checks while holding the row lock at commit time.
  const { data: current, error: readError } = await sb.from('submissions').select('*')
    .eq('id', id).eq('stream_id', session.streamId).maybeSingle();
  if (readError) return NextResponse.json({ error: 'Could not load the item.' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
  if (body.expectedStatus && current.status !== body.expectedStatus) return NextResponse.json({ error: 'Lead item changed. Refresh before approving.' }, { status: 409 });
  const conflict = reviewConflict(current, session.accountId, expectedRevision);
  if (conflict) return NextResponse.json({ error: conflict, detail: reviewConflictMessage(conflict) }, { status: 409 });

  if (body.status && !['pending', 'approved', 'played', 'rejected'].includes(body.status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.status) {
    patch.status = body.status;
    if (body.status === 'approved') {
      patch.approved_at = new Date().toISOString();
      // Only recorded for a mod's approval — the streamer approving their
      // own queue isn't "approved by a mod", so leave both null in that
      // case (the deck badge just won't render).
      patch.approved_by_login = session.role === 'mod' ? sessionLogin(session) : null;
      patch.approved_by_display_name = session.role === 'mod' ? session.displayName : null;
    } else if (body.status !== 'played') {
      // Leaving 'approved' for anything other than 'played' (unapprove back
      // to pending, or reject) means it's no longer a mod-approved deck item
      // — clear the attribution so a later re-approval by someone else (or
      // the streamer) doesn't inherit stale credit.
      patch.approved_by_login = null;
      patch.approved_by_display_name = null;
    }
  }
  if (typeof body.position === 'number') patch.position = body.position;
  if ('mod_notes' in body) patch.mod_notes = typeof body.mod_notes === 'string' ? body.mod_notes : null;
  // Unlike mod_notes, this one accepts an explicit null: a trigger warning is
  // published to chat and the on-air overlay, so taking one back off an item
  // has to be as possible as putting it on.
  if ('trigger_warning' in body) {
    const tw = typeof body.trigger_warning === 'string' ? body.trigger_warning.trim() : '';
    patch.trigger_warning = tw || null;
  }
  // The deck's takeaway box autosaves here as the streamer types (see
  // DeckView's savePrepNote) — so notes about what to watch for survive
  // switching to another item and back, instead of living only in that
  // component's local state until markPlayed finally persists them as the
  // show-notes takeaway. Accepts an explicit null, same reasoning as
  // trigger_warning: clearing a note has to be as possible as writing one.
  if ('prep_note' in body) {
    const pn = typeof body.prep_note === 'string' ? body.prep_note.trim() : '';
    patch.prep_note = pn || null;
  }
  // The database snapshots this takeaway into show_notes atomically with
  // the play transition. It also cancels that note when Played is undone.
  if (body.status === 'played' && 'takeaway' in body) {
    patch.prep_note = typeof body.takeaway === 'string' ? body.takeaway.trim() || null : null;
  }
  // Streamer's replacement for the title shown on the overlay and in the
  // "Watching:" chat post (the scraped title itself is left alone). Accepts
  // an explicit null/blank to clear it, same reasoning as trigger_warning —
  // and like it, not curation-gated: it annotates what viewers see rather
  // than reorganizing the deck.
  if ('title_override' in body) patch.title_override = normalizeTitleOverride(body.title_override);
  if (typeof body.duration_on_screen_s === 'number') patch.duration_on_screen_s = body.duration_on_screen_s;

  // Assign to a segment (or back to ungrouped). Append to the end of the
  // target group so it lands at the bottom of that segment.
  if ('segment_id' in body) {
    let targetSeg: string | null = body.segment_id || null;
    // Ignore a segment id that isn't a real segment on this stream — a
    // stale/foreign id falls back to ungrouped instead of being written
    // (same rule addToDeck applies for the quick-add path).
    if (targetSeg) {
      const { data: seg } = await sb
        .from('segments')
        .select('id')
        .eq('id', targetSeg)
        .eq('stream_id', session.streamId)
        .maybeSingle();
      targetSeg = seg?.id ?? null;
    }
    patch.segment_id = targetSeg;
    let posQ = sb
      .from('submissions')
      .select('position')
      .eq('stream_id', session.streamId)
      .eq('status', 'approved');
    posQ = targetSeg ? posQ.eq('segment_id', targetSeg) : posQ.is('segment_id', null);
    const { data: last } = await posQ
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    patch.position = (last?.position ?? 0) + 1;
  }

  // Keep duplicate checks on the approval path; paid enrichment and related
  // coverage run in the background after the approval has been saved.
  if (body.status === 'approved') {
    const sub = current;

    // The deck must never contain duplicates, regardless of the stream's
    // allow_duplicates setting (which only governs the overall queue). Block
    // approval if the same URL is already approved (i.e. already on the deck).
    if (sub) {
      const { data: dupe } = await sb
        .from('submissions')
        .select('id, segment:segments(name)')
        .eq('stream_id', session.streamId)
        .eq('status', 'approved')
        .eq('normalized_url', sub.normalized_url)
        .neq('id', id)
        .limit(1)
        .maybeSingle();
      if (dupe) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const segName = (dupe as any).segment?.name as string | undefined;
        const where = segName ? `segment “${segName}”` : 'the ungrouped list';
        return NextResponse.json(
          { error: 'duplicate', detail: `Already on the deck — in ${where}.`, segment: segName ?? null },
          { status: 409 },
        );
      }
    }
  }

  const { data: saved, error } = await sb.rpc('apply_submission_review', {
    p_stream_id: session.streamId, p_id: id, p_actor_id: session.accountId,
    p_patch: patch, p_expected_revision: expectedRevision, p_expected_status: body.expectedStatus ?? null,
  });
  if (error) return NextResponse.json({ error: 'Review coordination is temporarily unavailable.' }, { status: 503 });
  if (saved?.error) return NextResponse.json({ error: saved.error, detail: reviewConflictMessage(saved.error) }, { status: saved.error === 'not_found' ? 404 : 409 });
  const data = saved?.submission;
  if (!data) return NextResponse.json({ error: 'Could not save the item.' }, { status: 500 });

  // The trigger persists queued work atomically with approval. External
  // providers run after the response, under a database lease; queue reads
  // recover work left queued or interrupted by a function timeout.
  if (body.status === 'approved' && data) {
    waitUntil(processSubmissionEnrichment(id, session.streamId));
  }

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ submission: data });
}
