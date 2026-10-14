import { redirect } from 'next/navigation';
import { getApprovedSession } from '@/lib/session';
import { StreamTheme } from '@/components/StreamTheme';
import { ModerationHistory } from './ModerationHistory';
export const dynamic='force-dynamic';
export default async function HistoryPage() {
 const session=await getApprovedSession(); if(!session) redirect('/login');
 return <><StreamTheme/><ModerationHistory displayName={session.displayName}/></>;
}
