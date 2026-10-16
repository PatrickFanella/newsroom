import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { StreamTheme } from '@/components/StreamTheme';
import { BundlesView } from './BundlesView';
export const dynamic = 'force-dynamic';
export default async function BundlesPage() {
  const session = await getSession(); if (!session) redirect('/login');
  return <><StreamTheme /><BundlesView streamId={session.streamId} /></>;
}
