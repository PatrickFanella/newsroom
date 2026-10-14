import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { parseWorkingCopyName } from '@/lib/preparation-templates';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const name = parseWorkingCopyName(await req.json().catch(() => null));
  if (!name) return NextResponse.json({ error: 'Enter a working shelf name (1–80 characters)' }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc('instantiate_preparation_template', {
    p_stream_id: session.streamId, p_template_id: id, p_name: name,
  });
  if (error) return NextResponse.json({ error: 'Could not create the working shelf' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ list: data }, { status: 201 });
}
