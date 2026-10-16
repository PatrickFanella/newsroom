import {notFound}from 'next/navigation';
import Link from 'next/link';
import {isBroadcastId}from '@/lib/broadcast';
import {readPublishedEpisode}from '@/lib/episode-publication';
import {EpisodeContent}from '../EpisodeContent';
export const dynamic='force-dynamic';
export default async function EpisodePage({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;if(!isBroadcastId(token))notFound();const published=await readPublishedEpisode(token);if(!published)notFound();
 return <main className="max-w-3xl mx-auto px-6 py-8 space-y-6"><Link href="/" className="font-display text-lg font-bold">The Broadside</Link><EpisodeContent episode={published.episode}/><p className="text-xs text-ink/50">Published {new Date(published.publishedAt).toLocaleString()}</p></main>;
}
