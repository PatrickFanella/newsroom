import { NextRequest, NextResponse } from 'next/server';
import { getApprovedSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { parseUsageSettings } from '@/lib/usage-policy';
export const dynamic = 'force-dynamic';
export async function GET() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { data, error } = await supabaseAdmin().rpc('owner_usage_overview', { p_stream_id: session.streamId });
  if (error || !data) return NextResponse.json({ error: 'Usage is unavailable' }, { status: 503 });
  return NextResponse.json({ usage: data });
}
export async function PATCH(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const patch = parseUsageSettings(await req.json().catch(() => null));
  if (!patch) return NextResponse.json({ error: 'Invalid usage settings' }, { status: 400 });
  const { data, error } = await supabaseAdmin().from('streams').update(patch).eq('id', session.streamId).select('id').maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Could not save usage settings' }, { status: 503 });
  return NextResponse.json({ ok: true });
}
