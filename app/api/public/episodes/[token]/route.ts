import {NextResponse}from 'next/server';
import {isBroadcastId}from '@/lib/broadcast';
import {readPublishedEpisode}from '@/lib/episode-publication';
import {checkRateLimit,hashKey}from '@/lib/ratelimit';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{token:string}>}) {
 const {token}=await params;if(!isBroadcastId(token))return NextResponse.json({error:'not found'},{status:404});
 const limited=await checkRateLimit('read',hashKey(token));if(!limited.ok)return NextResponse.json({error:'rate limited'},{status:429,headers:{'Retry-After':String(limited.retryAfterSeconds)}});
 try{const data=await readPublishedEpisode(token);if(!data)return NextResponse.json({error:'not found'},{status:404});return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Episode is unavailable'},{status:503});}
}
