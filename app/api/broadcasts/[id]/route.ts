import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@/lib/background';
import { getApprovedSession, getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { broadcastChapterText, broadcastMarkdown, isBroadcastId, validateBroadcastPatch, type BroadcastDetail } from '@/lib/broadcast';
import { broadcastSessionChange } from '@/lib/realtime';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await context.params;
  if (!isBroadcastId(id)) return NextResponse.json({ error: 'show not found' }, { status: 404 });
  const { data, error } = await supabaseAdmin().rpc('read_broadcast', { p_stream_id: session.streamId, p_id: id });
  if (error) return NextResponse.json({ error: 'could not load show' }, { status: 500 });
  if (!data?.broadcast?.id) return NextResponse.json({ error: 'show not found' }, { status: 404 });
  const detail = data as BroadcastDetail;
  const format = req.nextUrl.searchParams.get('format');
  if (format === 'markdown' || format === 'chapters') {
    const markdown = format === 'markdown';
    return new NextResponse(markdown ? broadcastMarkdown(detail) : broadcastChapterText(detail), {
      headers: {
        'Content-Type': markdown ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="show-${id}.${markdown ? 'md' : 'txt'}"`,
      },
    });
  }
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, context: Context) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await context.params;
  if (!isBroadcastId(id)) return NextResponse.json({ error: 'show not found' }, { status: 404 });
  let patch;
  try { patch = validateBroadcastPatch(await req.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'invalid show settings' }, { status: 400 }); }
  const { data, error } = await supabaseAdmin().from('broadcast_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('stream_id', session.streamId).select().maybeSingle();
  if (error) return NextResponse.json({ error: 'could not save show settings' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'show not found' }, { status: 404 });
  waitUntil(broadcastSessionChange(session.streamId));
  return NextResponse.json({ broadcast: data });
}
