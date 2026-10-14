import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getApprovedSession, getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isBroadcastId, validateBroadcastPatch, type Broadcast } from '@/lib/broadcast';
import { broadcastSessionChange } from '@/lib/realtime';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const cursor = req.nextUrl.searchParams.get('before');
  const active = req.nextUrl.searchParams.get('active') === '1';
  const [before, beforeId] = cursor?.split('|') ?? [];
  if (cursor && (active || !before || !Number.isFinite(Date.parse(before)) || !isBroadcastId(beforeId) || cursor.split('|').length !== 2)) {
    return NextResponse.json({ error: 'invalid history cursor' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().rpc('list_broadcasts', {
    p_stream_id: session.streamId, p_before: before ?? null, p_before_id: beforeId ?? null, p_active: active,
  });
  if (error) return NextResponse.json({ error: 'could not load shows' }, { status: 500 });
  const broadcasts = data ?? [];
  const last = broadcasts.at(-1);
  return NextResponse.json({ broadcasts, nextCursor: !active && broadcasts.length === 50 ? `${last.started_at}|${last.id}` : null });
}

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const sb = supabaseAdmin();
  let result;
  if (body?.action === 'start') {
    let title: string;
    try {
      title = validateBroadcastPatch({ title: body.title }).title!;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'invalid title' }, { status: 400 });
    }
    result = await sb.rpc('start_broadcast', { p_stream_id: session.streamId, p_title: title }).single<Broadcast>();
  } else if (body?.action === 'end' && isBroadcastId(body.id)) {
    result = await sb.rpc('end_broadcast', { p_stream_id: session.streamId, p_id: body.id }).maybeSingle<Broadcast>();
  } else return NextResponse.json({ error: 'invalid show action' }, { status: 400 });
  if (result.error) {
    const status = result.error.code === '23505' ? 409 : result.error.code === '42501' ? 403 : 500;
    return NextResponse.json({ error: status === 409 ? 'A show is already active. Refresh to continue.' : 'could not save show' }, { status });
  }
  if (!result.data?.id) return NextResponse.json({ error: 'show not found' }, { status: 404 });
  waitUntil(broadcastSessionChange(session.streamId));
  return NextResponse.json({ broadcast: result.data });
}
