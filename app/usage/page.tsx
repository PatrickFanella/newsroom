import { redirect } from 'next/navigation';
import { getApprovedSession } from '@/lib/session';
import { StreamTheme } from '@/components/StreamTheme';
import { OwnerUsage } from './OwnerUsage';
export const dynamic = 'force-dynamic';
export default async function UsagePage() {
  const session = await getApprovedSession();
  if (!session) redirect('/login');
  if (session.role !== 'streamer') redirect('/preferences');
  return <><StreamTheme /><OwnerUsage displayName={session.displayName} /></>;
}
