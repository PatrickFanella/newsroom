import {createHash}from 'node:crypto';
import {supabaseAdmin}from './supabase';
import {projectPublicEpisode,readPublicProjection,type EpisodeOptions,type PublicEpisode}from './public-episode';
import type {BroadcastDetail}from './broadcast';
export class EpisodeError extends Error{}
export const episodeFingerprint=(episode:PublicEpisode)=>createHash('sha256').update(JSON.stringify(episode)).digest('hex');
export async function episodePreview(streamId:string,id:string,options:EpisodeOptions) {
 const {data,error}=await supabaseAdmin().rpc('read_broadcast',{p_stream_id:streamId,p_id:id});
 if(error)throw new EpisodeError('Show is unavailable');if(!data)throw new EpisodeError('Show not found');
 const detail=data as BroadcastDetail;if(!detail.broadcast.ended_at)throw new EpisodeError('End the show before publishing');
 const episode=projectPublicEpisode(detail,options);
 const internal=detail.broadcast as typeof detail.broadcast & {public_token?:string|null;published_at?:string|null};
 return {episode,fingerprint:episodeFingerprint(episode),publication:{token:internal.public_token ?? null,publishedAt:internal.published_at ?? null}};
}
export async function readPublishedEpisode(token:string):Promise<{episode:PublicEpisode;publishedAt:string}|null> {
 const {data,error}=await supabaseAdmin().from('broadcast_sessions').select('public_episode,published_at').eq('public_token',token).maybeSingle();
 if(error)throw new EpisodeError('Episode is unavailable');if(!data?.public_episode)return null;
 const episode=readPublicProjection(data.public_episode);if(!episode)return null;
 return {episode,publishedAt:data.published_at};
}
