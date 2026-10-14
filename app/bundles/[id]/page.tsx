import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { isBroadcastId } from '@/lib/broadcast';
import { StreamTheme } from '@/components/StreamTheme';
import { BundleView } from '../BundleView';
export const dynamic = 'force-dynamic';
export default async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) redirect('/login');
  const { id } = await params; if (!isBroadcastId(id)) redirect('/bundles');
  return <><StreamTheme /><BundleView id={id} canManage={await sessionCanCurate(session)} /></>;
}
