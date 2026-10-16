import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { StreamTheme } from '@/components/StreamTheme';
import { BroadcastsView } from './BroadcastsView';

export const dynamic = 'force-dynamic';

export default async function BroadcastsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const { data: stream } = await supabaseAdmin().from('streams').select('approved').eq('id', session.streamId).maybeSingle();
  if (stream?.approved === false) redirect('/blocked');
  return <><StreamTheme /><BroadcastsView streamId={session.streamId} canManage={session.role === 'streamer'} displayName={session.displayName} /></>;
}
