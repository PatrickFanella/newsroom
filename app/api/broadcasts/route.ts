import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@/lib/background';
import { getApprovedSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isBroadcastId, validateBroadcastPatch, type Broadcast } from '@/lib/broadcast';
import { broadcastSearch } from '@/lib/broadcast-search';
import { broadcastSessionChange } from '@/lib/realtime';

export async function GET(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const cursor = req.nextUrl.searchParams.get('before');
  const active = req.nextUrl.searchParams.get('active') === '1';
  const [before, beforeId] = cursor?.split('|') ?? [];
  if (cursor && (active || !before || !Number.isFinite(Date.parse(before)) || !isBroadcastId(beforeId) || cursor.split('|').length !== 2)) {
    return NextResponse.json({ error: 'invalid history cursor' }, { status: 400 });
  }
  let filters;
  try { filters=broadcastSearch(Object.fromEntries(req.nextUrl.searchParams)); }
  catch(error) { return NextResponse.json({ error:error instanceof Error ? error.message : 'Invalid filters' },{ status:400 }); }
  const rpc = active ? supabaseAdmin().rpc('list_broadcasts', {
    p_stream_id:session.streamId,p_before:null,p_before_id:null,p_active:true,
  }) : supabaseAdmin().rpc('search_broadcast_history', {
    p_stream_id:session.streamId,p_query:filters.query,p_state:filters.state,p_from:filters.from,p_until:filters.until,p_before:before ?? null,p_before_id:beforeId ?? null,
  });
  const { data,error }=await rpc;
  if(error) return NextResponse.json({ error:'could not load shows' },{ status:500 });
  const rows=data ?? [];
  const broadcasts=active ? rows : rows.slice(0,50);
  const last=broadcasts.at(-1);
  return NextResponse.json({ broadcasts,nextCursor:!active && rows.length>50 ? `${last.started_at}|${last.id}` : null });
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
