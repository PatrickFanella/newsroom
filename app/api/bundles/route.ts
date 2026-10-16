import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getSession, getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { supabaseAdmin } from '@/lib/supabase';
import { isBroadcastId } from '@/lib/broadcast';
import { broadcastQueueChange } from '@/lib/realtime';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const cursor = req.nextUrl.searchParams.get('before');
  const [before, beforeId] = cursor?.split('|') ?? [];
  if (cursor && (!before || !Number.isFinite(Date.parse(before)) || !isBroadcastId(beforeId) || cursor.split('|').length !== 2)) return NextResponse.json({ error: 'Invalid bundle cursor.' }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc('list_story_bundles', { p_stream_id: session.streamId, p_before: before ?? null, p_before_id: beforeId ?? null });
  if (error) return NextResponse.json({ error: 'Could not load story bundles.' }, { status: 503 });
  return NextResponse.json(data);
}
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!isBroadcastId(body?.submissionId)) return NextResponse.json({ error: 'Invalid lead item.' }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc('create_story_bundle', { p_stream_id: session.streamId, p_lead_id: body.submissionId });
  if (error) return NextResponse.json({ error: 'Could not create story bundle.' }, { status: 503 });
  if (data?.error) return NextResponse.json({ error: data.error === 'not_found' ? 'Lead item not found.' : 'Choose a pending or approved lead item.' }, { status: data.error === 'not_found' ? 404 : 409 });
  if (!data?.bundle?.id) return NextResponse.json({ error: 'Could not create story bundle.' }, { status: 500 });
  waitUntil(broadcastQueueChange(session.streamId));
  return NextResponse.json(data);
}
