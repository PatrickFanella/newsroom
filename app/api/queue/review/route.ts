import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getApprovedSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { broadcastQueueChange } from '@/lib/realtime';
import { parseReviewAction, reviewConflictMessage } from '@/lib/review-coordination';

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let action;
  try { action = parseReviewAction(await req.json()); }
  catch { return NextResponse.json({ error: 'Invalid review action.' }, { status: 400 }); }
  if (action.force && session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { data, error } = await supabaseAdmin().rpc('set_submission_review_claim', {
    p_stream_id: session.streamId, p_id: action.id, p_actor_id: session.accountId,
    p_display_name: session.displayName, p_action: action.action, p_token: action.token,
    p_force: action.force && session.role === 'streamer',
  });
  if (error) return NextResponse.json({ error: 'Review coordination is temporarily unavailable.' }, { status: 503 });
  if (data?.error) return NextResponse.json({ error: data.error, detail: reviewConflictMessage(data.error) }, { status: data.error === 'not_found' ? 404 : 409 });
  if (!data?.submission) return NextResponse.json({ error: 'Could not save the review claim.' }, { status: 500 });
  waitUntil(broadcastQueueChange(session.streamId));
  return NextResponse.json(data);
}
