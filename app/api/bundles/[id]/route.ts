import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getSession, getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { supabaseAdmin } from '@/lib/supabase';
import { isBroadcastId } from '@/lib/broadcast';
import { validateBundleSettings } from '@/lib/story-bundles';
import { broadcastQueueChange } from '@/lib/realtime';
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, context: Context) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await context.params;
  if (!isBroadcastId(id)) return NextResponse.json({ error: 'Bundle not found.' }, { status: 404 });
  const { data, error } = await supabaseAdmin().rpc('read_story_bundle', { p_stream_id: session.streamId, p_id: id });
  if (error) return NextResponse.json({ error: 'Could not load story bundle.' }, { status: 503 });
  if (!data?.bundle) return NextResponse.json({ error: 'Bundle not found.' }, { status: 404 });
  return NextResponse.json(data);
}
export async function PATCH(req: NextRequest, context: Context) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await context.params;
  if (!isBroadcastId(id)) return NextResponse.json({ error: 'Bundle not found.' }, { status: 404 });
  let settings;
  try { settings = validateBundleSettings(await req.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid bundle settings.' }, { status: 400 }); }
  const { data, error } = await supabaseAdmin().rpc('update_story_bundle', { p_stream_id: session.streamId, p_id: id, p_revision: settings.revision, p_title: settings.title, p_prep_note: settings.prep_note, p_sources: settings.sources });
  if (error) return NextResponse.json({ error: 'Could not save story bundle.' }, { status: 503 });
  if (data?.error) return NextResponse.json({ error: data.error === 'not_found' ? 'Bundle not found.' : 'This bundle changed elsewhere. Your draft is kept; load the latest version before saving.' }, { status: data.error === 'not_found' ? 404 : 409 });
  waitUntil(broadcastQueueChange(session.streamId));
  return NextResponse.json(data);
}
