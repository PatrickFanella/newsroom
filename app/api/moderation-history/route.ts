import { NextRequest, NextResponse } from 'next/server';
import { getApprovedSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { historyCursor, parseHistoryCursor, MODERATION_ACTIONS, type ModerationAction } from '@/lib/moderation-history';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const session=await getApprovedSession();
  if(!session) return NextResponse.json({ error:'unauthenticated' },{ status:401 });
  const query=(req.nextUrl.searchParams.get('q') || '').trim();
  const action=req.nextUrl.searchParams.get('action') || null;
  if(query.length>200 || (action && !MODERATION_ACTIONS.some(a=>a===action))) return NextResponse.json({ error:'Invalid filters' },{ status:400 });
  let cursor;
  try { cursor=parseHistoryCursor(req.nextUrl.searchParams.get('cursor')); } catch { return NextResponse.json({ error:'Invalid cursor' },{ status:400 }); }
  const { data,error }=await supabaseAdmin().rpc('moderation_history_page',{ p_stream_id:session.streamId,p_query:query,p_action:action,p_before_at:cursor?.at ?? null,p_before_id:cursor?.id ?? null,p_limit:51 });
  if(error) return NextResponse.json({ error:'History is unavailable' },{ status:503 });
  const rows=(data || []) as ModerationAction[];
  const page=rows.slice(0,50);
  return NextResponse.json({ actions:page,nextCursor:rows.length>50 ? historyCursor(page[page.length-1]) : null });
}
