import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { StreamTheme } from '@/components/StreamTheme';
import { isBroadcastId } from '@/lib/broadcast';
import { BroadcastsView } from '../BroadcastsView';

export const dynamic = 'force-dynamic';

export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  if (!isBroadcastId(id)) redirect('/broadcasts');
  const { data: stream } = await supabaseAdmin().from('streams').select('approved').eq('id', session.streamId).maybeSingle();
  if (stream?.approved === false) redirect('/blocked');
  return <><StreamTheme /><BroadcastsView key={id} broadcastId={id} streamId={session.streamId} canManage={session.role === 'streamer'} displayName={session.displayName} /></>;
}
